// 1 本の木（1 つの問題）のリレー進行。Durable Object「Tree」の中身。
// 保存先は SQLite（Durable Object の ctx.storage.sql）。テストでは Node の SQLite を差し込む。
// 処理はすべて同期で、Durable Object の中では 1 件ずつ順番に進むので、二重回答・二重射撃は起きない。

import { radiusFor } from "../src/game/power";
import { displayAnswer, findQuestion } from "../src/game/questions";
import { isCorrect } from "../src/game/normalize";
import type { Shot } from "../src/game/types";
import {
  ANSWER_LIMIT_MS,
  ROOT_NODE,
  isFailure,
  type AttemptState,
  type AttemptStatus,
  type NodeView,
  type TreeErrorCode,
} from "../src/online/protocol";

export type SqlValue = string | number | null | ArrayBuffer;
type Row = Record<string, SqlValue>;

/** ctx.storage.sql と同じ形 */
export interface SqlRunner {
  exec(query: string, ...bindings: SqlValue[]): { toArray(): Row[] };
}

export interface RelayDeps {
  readonly sql: SqlRunner;
  readonly now: () => number;
  /** 子ノードの ID を作る */
  readonly nodeId: () => string;
  /** 挑戦の ID を作る */
  readonly attemptId: () => string;
}

/** 通信の遅れは許し、時間のごまかしは防ぐ：サーバーで計った時間よりこれ以上短い申告は認めない */
export const CLOCK_TOLERANCE_MS = 3_000;
/**
 * 問題を受け取ってから画面に出すまで（フォントの読み込み・画像の描画）にかかった時間。
 * 遅い端末で、見る前に時間が減らないよう差し引く。ただしこの長さまで。
 */
export const RENDER_ALLOWANCE_MS = 5_000;
/** 1 本の木に作れるノードの数 */
export const MAX_NODES = 2_000;
/** 子ノードの ID が重なったときに作り直す回数 */
const ID_RETRIES = 5;

export class TreeError extends Error {
  constructor(readonly code: TreeErrorCode) {
    super(`tree: ${code}`);
    this.name = "TreeError";
  }
}

const SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS tree (
    id TEXT PRIMARY KEY,
    question_key TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS node (
    id TEXT PRIMARY KEY,
    parent_id TEXT REFERENCES node(id),
    depth INTEGER NOT NULL,
    x REAL, y REAL, radius REAL,
    buzz_ms INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS attempt (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL REFERENCES node(id),
    device_hash TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at INTEGER, buzzed_at INTEGER, buzz_ms INTEGER,
    answer TEXT,
    child_node_id TEXT REFERENCES node(id),
    created_at INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS attempt_device ON attempt(device_hash)",
  "CREATE INDEX IF NOT EXISTS node_parent ON node(parent_id)",
];

const ATTEMPT_STATUSES: readonly AttemptStatus[] = ["claimed", "started", "buzzed", "correct", "shot", "wrong", "give-up", "expired"];

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new TypeError(`column ${key} is not text`);
  return value;
}

function num(row: Row, key: string): number {
  const value = row[key];
  if (typeof value !== "number") throw new TypeError(`column ${key} is not a number`);
  return value;
}

function optionalNum(row: Row, key: string): number | null {
  return row[key] === null ? null : num(row, key);
}

function optionalText(row: Row, key: string): string | null {
  return row[key] === null ? null : text(row, key);
}

function status(row: Row): AttemptStatus {
  const value = text(row, "status");
  const found = ATTEMPT_STATUSES.find((candidate) => candidate === value);
  if (!found) throw new TypeError(`unknown status ${value}`);
  return found;
}

interface AttemptRow {
  readonly id: string;
  readonly nodeId: string;
  readonly tokenHash: string;
  readonly status: AttemptStatus;
  readonly startedAt: number | null;
  readonly buzzMs: number | null;
  readonly answer: string | null;
  readonly childNodeId: string | null;
}

function toAttempt(row: Row): AttemptRow {
  return {
    id: text(row, "id"),
    nodeId: text(row, "node_id"),
    tokenHash: text(row, "token_hash"),
    status: status(row),
    startedAt: optionalNum(row, "started_at"),
    buzzMs: optionalNum(row, "buzz_ms"),
    answer: optionalText(row, "answer"),
    childNodeId: optionalText(row, "child_node_id"),
  };
}

function inUnitRange(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export class TreeRelay {
  constructor(private readonly deps: RelayDeps) {
    SCHEMA.forEach((statement) => deps.sql.exec(statement));
  }

  private rows(query: string, ...bindings: SqlValue[]): Row[] {
    return this.deps.sql.exec(query, ...bindings).toArray();
  }

  /** 木を作る。根のノードも作る。 */
  create(treeId: string, questionKey: string): void {
    if (!findQuestion(questionKey)) throw new TreeError("bad-request");
    if (this.rows("SELECT id FROM tree").length) throw new TreeError("bad-request");
    const now = this.deps.now();
    this.rows("INSERT INTO tree (id, question_key, created_at) VALUES (?, ?, ?)", treeId, questionKey, now);
    this.rows("INSERT INTO node (id, parent_id, depth, created_at) VALUES (?, NULL, 0, ?)", ROOT_NODE, now);
  }

  private tree(): { readonly id: string; readonly questionKey: string } {
    const row = this.rows("SELECT id, question_key FROM tree")[0];
    if (!row) throw new TreeError("tree-not-found");
    return { id: text(row, "id"), questionKey: text(row, "question_key") };
  }

  private depthOf(nodeId: string): number {
    const row = this.rows("SELECT depth FROM node WHERE id = ?", nodeId)[0];
    if (!row) throw new TreeError("node-not-found");
    return num(row, "depth");
  }

  /** 根からこのノードまでの射撃（古い順） */
  path(nodeId: string): Shot[] {
    const { id: treeId } = this.tree();
    this.depthOf(nodeId);
    const rows = this.rows(
      `WITH RECURSIVE chain(id, parent_id, depth, x, y, radius, created_at) AS (
         SELECT id, parent_id, depth, x, y, radius, created_at FROM node WHERE id = ?
         UNION ALL
         SELECT node.id, node.parent_id, node.depth, node.x, node.y, node.radius, node.created_at
         FROM node JOIN chain ON node.id = chain.parent_id
       )
       SELECT depth, x, y, radius, created_at FROM chain WHERE parent_id IS NOT NULL ORDER BY depth`,
      nodeId,
    );
    return rows.map((row) => ({
      chainId: treeId,
      turnNumber: num(row, "depth"),
      x: num(row, "x"),
      y: num(row, "y"),
      radius: num(row, "radius"),
      createdAt: num(row, "created_at"),
    }));
  }

  nodeView(nodeId: string, deviceHash: string | null): NodeView {
    const { id: treeId } = this.tree();
    const depth = this.depthOf(nodeId);
    const mine = deviceHash ? this.playedBy(deviceHash) : null;
    return { treeId, nodeId, depth, myAttempt: mine ? { attemptId: mine.id, nodeId: mine.nodeId, status: mine.status } : null };
  }

  /** この端末がこの木で始めた挑戦（参加権を取っただけのものは数えない） */
  private playedBy(deviceHash: string): AttemptRow | null {
    const row = this.rows("SELECT * FROM attempt WHERE device_hash = ? AND status != 'claimed' ORDER BY created_at LIMIT 1", deviceHash)[0];
    return row ? this.expireIfLate(toAttempt(row)) : null;
  }

  /** 参加権を取る。時計はまだ動かさない。READY? を押す前なら何度取り直してもよい。 */
  claim(nodeId: string, deviceHash: string, tokenHash: string): AttemptState {
    this.depthOf(nodeId);
    if (this.playedBy(deviceHash)) throw new TreeError("already-played");
    this.rows("DELETE FROM attempt WHERE device_hash = ? AND status = 'claimed'", deviceHash);
    const id = this.deps.attemptId();
    this.rows(
      "INSERT INTO attempt (id, node_id, device_hash, token_hash, status, created_at) VALUES (?, ?, ?, ?, 'claimed', ?)",
      id,
      nodeId,
      deviceHash,
      tokenHash,
      this.deps.now(),
    );
    return this.state(id, tokenHash);
  }

  private attempt(attemptId: string, tokenHash: string): AttemptRow {
    const row = this.rows("SELECT * FROM attempt WHERE id = ?", attemptId)[0];
    if (!row) throw new TreeError("attempt-not-found");
    const attempt = toAttempt(row);
    if (attempt.tokenHash !== tokenHash) throw new TreeError("invalid-token");
    return this.expireIfLate(attempt);
  }

  /** 制限時間を過ぎた回答待ちの挑戦は、読んだ時点で時間切れにする */
  private expireIfLate(attempt: AttemptRow): AttemptRow {
    const waiting = attempt.status === "started" || attempt.status === "buzzed";
    if (!waiting || attempt.startedAt === null || this.deps.now() - attempt.startedAt <= ANSWER_LIMIT_MS) return attempt;
    this.rows("UPDATE attempt SET status = 'expired' WHERE id = ?", attempt.id);
    return { ...attempt, status: "expired" };
  }

  private setStatus(attemptId: string, next: AttemptStatus): void {
    this.rows("UPDATE attempt SET status = ? WHERE id = ?", next, attemptId);
  }

  private require(attempt: AttemptRow, allowed: readonly AttemptStatus[]): void {
    if (attempt.status === "expired") throw new TreeError("expired");
    if (!allowed.includes(attempt.status)) throw new TreeError("bad-state");
  }

  /** READY? を押した：時計を動かし、問題を渡す */
  start(attemptId: string, tokenHash: string): AttemptState {
    const attempt = this.attempt(attemptId, tokenHash);
    this.require(attempt, ["claimed"]);
    this.rows("UPDATE attempt SET status = 'started', started_at = ? WHERE id = ?", this.deps.now(), attemptId);
    return this.state(attemptId, tokenHash);
  }

  /**
   * わかった！：経過時間で弾の大きさが決まる。
   * clientMs は画面に問題が出てからの時間、renderMs は問題を受け取ってから画面に出すまでの時間（どちらも端末で計る）。
   * サーバーの時計は問題を渡したときに動き出しているので、描画にかかった分は差し引く。
   */
  buzz(attemptId: string, tokenHash: string, clientMs: number, renderMs: number): AttemptState {
    const attempt = this.attempt(attemptId, tokenHash);
    this.require(attempt, ["started"]);
    if (!Number.isFinite(clientMs) || !Number.isFinite(renderMs) || attempt.startedAt === null) throw new TreeError("bad-request");
    const now = this.deps.now();
    const serverMs = now - attempt.startedAt;
    const render = Math.min(RENDER_ALLOWANCE_MS, Math.max(0, renderMs));
    const buzzMs = Math.round(Math.min(serverMs, Math.max(clientMs, serverMs - render - CLOCK_TOLERANCE_MS, 0)));
    this.rows("UPDATE attempt SET status = 'buzzed', buzzed_at = ?, buzz_ms = ? WHERE id = ?", now, buzzMs, attemptId);
    return this.state(attemptId, tokenHash);
  }

  answer(attemptId: string, tokenHash: string, input: string): AttemptState {
    const attempt = this.attempt(attemptId, tokenHash);
    this.require(attempt, ["buzzed"]);
    const question = findQuestion(this.tree().questionKey);
    if (!question) throw new TreeError("tree-not-found");
    const correct = isCorrect(input, question.answer, question.acceptedAnswers);
    this.rows("UPDATE attempt SET status = ?, answer = ? WHERE id = ?", correct ? "correct" : "wrong", input, attemptId);
    return this.state(attemptId, tokenHash);
  }

  giveUp(attemptId: string, tokenHash: string): AttemptState {
    const attempt = this.attempt(attemptId, tokenHash);
    this.require(attempt, ["claimed", "started", "buzzed"]);
    this.setStatus(attemptId, "give-up");
    return this.state(attemptId, tokenHash);
  }

  /** 撃つ：子ノードを作る。弾の大きさはサーバーが決めた値を使う。 */
  shoot(attemptId: string, tokenHash: string, x: number, y: number): AttemptState {
    const attempt = this.attempt(attemptId, tokenHash);
    this.require(attempt, ["correct"]);
    if (!inUnitRange(x) || !inUnitRange(y) || attempt.buzzMs === null) throw new TreeError("out-of-bounds");
    const count = num(this.rows("SELECT COUNT(*) AS count FROM node")[0] ?? { count: 0 }, "count");
    if (count >= MAX_NODES) throw new TreeError("tree-full");
    const childId = this.freshNodeId(ID_RETRIES);
    const now = this.deps.now();
    this.rows(
      "INSERT INTO node (id, parent_id, depth, x, y, radius, buzz_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      childId,
      attempt.nodeId,
      this.depthOf(attempt.nodeId) + 1,
      x,
      y,
      radiusFor(attempt.buzzMs),
      attempt.buzzMs,
      now,
    );
    this.rows("UPDATE attempt SET status = 'shot', child_node_id = ? WHERE id = ?", childId, attemptId);
    return this.state(attemptId, tokenHash);
  }

  private freshNodeId(retries: number): string {
    const id = this.deps.nodeId();
    if (!this.rows("SELECT id FROM node WHERE id = ?", id).length) return id;
    if (retries <= 0) throw new TreeError("tree-full");
    return this.freshNodeId(retries - 1);
  }

  /** 挑戦の今の状態。問題・射撃・答えは、見せてよい段階になってから入れる。 */
  state(attemptId: string, tokenHash: string): AttemptState {
    const attempt = this.attempt(attemptId, tokenHash);
    const tree = this.tree();
    const depth = this.depthOf(attempt.nodeId);
    const started = attempt.status !== "claimed";
    const question = findQuestion(tree.questionKey);
    const child = attempt.childNodeId ? this.path(attempt.childNodeId) : [];
    return {
      treeId: tree.id,
      attemptId: attempt.id,
      nodeId: attempt.nodeId,
      turnNumber: depth + 1,
      status: attempt.status,
      questionKey: started ? tree.questionKey : null,
      shots: started ? this.path(attempt.nodeId) : [],
      elapsedMs: attempt.startedAt === null ? null : this.deps.now() - attempt.startedAt,
      buzzMs: attempt.buzzMs,
      radius: attempt.buzzMs === null ? null : radiusFor(attempt.buzzMs),
      shot: child[child.length - 1] ?? null,
      childNodeId: attempt.childNodeId,
      answer: isFailure(attempt.status) && question ? displayAnswer(question) : null,
      submittedAnswer: attempt.answer,
    };
  }

  /** リンクカード用：何発目かと穴の位置だけ */
  card(nodeId: string): { readonly depth: number; readonly shots: readonly Shot[] } {
    return { depth: this.depthOf(nodeId), shots: this.path(nodeId) };
  }
}
