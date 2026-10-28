import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MAX_RADIUS, MIN_RADIUS } from "../src/game/power";
import { KANJI_QUESTIONS } from "../src/game/questions";
import { ANSWER_LIMIT_MS, ROOT_NODE } from "../src/online/protocol";
import { CLOCK_TOLERANCE_MS, RENDER_ALLOWANCE_MS, TreeError, TreeRelay, type SqlRunner, type SqlValue } from "./relay";

const TREE = "AbCdEfGhIj";
const DEVICE_A = "device-a";
const DEVICE_B = "device-b";
const TOKEN = "token-hash";
const START_AT = 1_000;
const QUICK_MS = 2_000;
const SLOW_MS = 10_000;
const LAG_SERVER_MS = 1_500;
const LAG_CLIENT_MS = 1_200;
const NODE_DIGITS = 5;
const CENTER = 0.5;
const LEFT = 0.25;
const FAR_LEFT = 0.2;
const FAR_RIGHT = 0.8;
const OUTSIDE = 1.5;
const SECOND_TURN = 2;
const NO_RENDER = 0;
const SLOW_RENDER_MS = 2_500;
const READ_MS = 1_000;
const question = KANJI_QUESTIONS[0];
if (!question) throw new Error("no question");

/** Durable Object の ctx.storage.sql の代わりに Node の SQLite を使う */
function memorySql(): SqlRunner {
  const db = new DatabaseSync(":memory:");
  return {
    exec: (query: string, ...bindings: SqlValue[]) => {
      const params = bindings.map((value): SQLInputValue => (value instanceof ArrayBuffer ? new Uint8Array(value) : value));
      const rows = db.prepare(query).all(...params);
      return { toArray: (): Record<string, SqlValue>[] => rows.map((row): Record<string, SqlValue> => ({ ...row }) as Record<string, SqlValue>) };
    },
  };
}

interface Clock {
  readonly now: () => number;
  readonly advance: (ms: number) => void;
}

function setup(): { readonly relay: TreeRelay; readonly clock: Clock } {
  const time = { now: START_AT };
  const counter = { node: 0, attempt: 0 };
  const clock: Clock = {
    now: () => time.now,
    advance: (ms) => {
      time.now += ms;
    },
  };
  const relay = new TreeRelay({
    sql: memorySql(),
    now: clock.now,
    nodeId: () => `n${String(++counter.node).padStart(NODE_DIGITS, "0")}`,
    attemptId: () => `a${++counter.attempt}`,
  });
  relay.create(TREE, question.key);
  return { relay, clock };
}

function code(action: () => unknown): string {
  try {
    action();
  } catch (err) {
    if (err instanceof TreeError) return err.code;
    throw err;
  }
  return "no-error";
}

/** 挑戦して正解し、撃つまで。できた子ノードを返す */
function playAndShoot(relay: TreeRelay, clock: Clock, device: string, nodeId: string, x: number): string {
  const claimed = relay.claim(nodeId, device, TOKEN);
  relay.start(claimed.attemptId, TOKEN);
  clock.advance(QUICK_MS);
  relay.buzz(claimed.attemptId, TOKEN, QUICK_MS, NO_RENDER);
  relay.answer(claimed.attemptId, TOKEN, question.answer);
  const shot = relay.shoot(claimed.attemptId, TOKEN, x, CENTER);
  if (!shot.childNodeId) throw new Error("no child");
  return shot.childNodeId;
}

describe("TreeRelay", () => {
  it("READY? を押すまで問題も射撃も渡さない", () => {
    const { relay } = setup();
    const claimed = relay.claim(ROOT_NODE, DEVICE_A, TOKEN);
    expect(claimed.status).toBe("claimed");
    expect(claimed.questionKey).toBeNull();
    expect(claimed.turnNumber).toBe(1);
    const started = relay.start(claimed.attemptId, TOKEN);
    expect(started.questionKey).toBe(question.key);
    expect(started.answer).toBeNull();
  });

  it("正解して撃つと子ノードができ、その下の人には射撃の並びが渡る", () => {
    const { relay, clock } = setup();
    const child = playAndShoot(relay, clock, DEVICE_A, ROOT_NODE, LEFT);
    const view = relay.nodeView(child, DEVICE_B);
    expect(view.depth).toBe(1);
    expect(view.myAttempt).toBeNull();
    const next = relay.claim(child, DEVICE_B, TOKEN);
    expect(next.turnNumber).toBe(SECOND_TURN);
    const started = relay.start(next.attemptId, TOKEN);
    expect(started.shots).toHaveLength(1);
    expect(started.shots[0]?.x).toBe(LEFT);
    expect(started.shots[0]?.turnNumber).toBe(1);
  });

  it("同じノードから何人でも枝を伸ばせる", () => {
    const { relay, clock } = setup();
    const first = playAndShoot(relay, clock, DEVICE_A, ROOT_NODE, FAR_LEFT);
    const second = playAndShoot(relay, clock, DEVICE_B, ROOT_NODE, FAR_RIGHT);
    expect(first).not.toBe(second);
    expect(relay.path(first)[0]?.x).toBe(FAR_LEFT);
    expect(relay.path(second)[0]?.x).toBe(FAR_RIGHT);
  });

  it("同じ木には端末ごとに 1 回だけ。READY? の前なら取り直せる", () => {
    const { relay } = setup();
    relay.claim(ROOT_NODE, DEVICE_A, TOKEN);
    const again = relay.claim(ROOT_NODE, DEVICE_A, TOKEN);
    relay.start(again.attemptId, TOKEN);
    expect(code(() => relay.claim(ROOT_NODE, DEVICE_A, TOKEN))).toBe("already-played");
    expect(relay.nodeView(ROOT_NODE, DEVICE_A).myAttempt?.attemptId).toBe(again.attemptId);
  });

  it("早押しの時間はサーバーの時計で上下を抑える", () => {
    const { relay, clock } = setup();
    const claimed = relay.claim(ROOT_NODE, DEVICE_A, TOKEN);
    relay.start(claimed.attemptId, TOKEN);
    clock.advance(SLOW_MS);
    // 0 秒と申告しても、サーバーで計った時間から許容幅を引いた分までしか縮まない
    const buzzed = relay.buzz(claimed.attemptId, TOKEN, 0, NO_RENDER);
    expect(buzzed.buzzMs).toBe(SLOW_MS - CLOCK_TOLERANCE_MS);
    expect(buzzed.radius).toBeLessThan(MAX_RADIUS);
    expect(buzzed.radius).toBeGreaterThan(MIN_RADIUS);
  });

  it("問題を描くのに時間がかかった端末では、その分を差し引く", () => {
    const { relay, clock } = setup();
    const claimed = relay.claim(ROOT_NODE, DEVICE_A, TOKEN);
    relay.start(claimed.attemptId, TOKEN);
    // 描画に 2.5 秒、画面に出てから 1 秒で押した。サーバーでは 3.5 秒＋通信の遅れ
    clock.advance(SLOW_RENDER_MS + READ_MS + CLOCK_TOLERANCE_MS);
    expect(relay.buzz(claimed.attemptId, TOKEN, READ_MS, SLOW_RENDER_MS).buzzMs).toBe(READ_MS);
  });

  it("描画の時間として差し引くのは上限まで", () => {
    const { relay, clock } = setup();
    const claimed = relay.claim(ROOT_NODE, DEVICE_A, TOKEN);
    relay.start(claimed.attemptId, TOKEN);
    clock.advance(SLOW_MS + RENDER_ALLOWANCE_MS + CLOCK_TOLERANCE_MS);
    // 描画にとても長くかかったと申告しても、差し引くのは上限まで
    expect(relay.buzz(claimed.attemptId, TOKEN, 0, SLOW_MS * SLOW_MS).buzzMs).toBe(SLOW_MS);
  });

  it("通信の遅れの分だけ短い申告は、そのまま認める", () => {
    const { relay, clock } = setup();
    const claimed = relay.claim(ROOT_NODE, DEVICE_A, TOKEN);
    relay.start(claimed.attemptId, TOKEN);
    clock.advance(LAG_SERVER_MS);
    expect(relay.buzz(claimed.attemptId, TOKEN, LAG_CLIENT_MS, NO_RENDER).buzzMs).toBe(LAG_CLIENT_MS);
  });

  it("不正解なら答えを返し、撃てない", () => {
    const { relay } = setup();
    const claimed = relay.claim(ROOT_NODE, DEVICE_A, TOKEN);
    relay.start(claimed.attemptId, TOKEN);
    relay.buzz(claimed.attemptId, TOKEN, 0, NO_RENDER);
    const wrong = relay.answer(claimed.attemptId, TOKEN, "ぜったいちがう");
    expect(wrong.status).toBe("wrong");
    expect(wrong.answer).toBeTruthy();
    expect(wrong.submittedAnswer).toBe("ぜったいちがう");
    expect(code(() => relay.shoot(claimed.attemptId, TOKEN, CENTER, CENTER))).toBe("bad-state");
  });

  it("制限時間を過ぎたら時間切れ", () => {
    const { relay, clock } = setup();
    const claimed = relay.claim(ROOT_NODE, DEVICE_A, TOKEN);
    relay.start(claimed.attemptId, TOKEN);
    relay.buzz(claimed.attemptId, TOKEN, 0, NO_RENDER);
    clock.advance(ANSWER_LIMIT_MS + 1);
    expect(code(() => relay.answer(claimed.attemptId, TOKEN, question.answer))).toBe("expired");
    expect(relay.state(claimed.attemptId, TOKEN).status).toBe("expired");
  });

  it("二重射撃・間違ったトークン・範囲外の座標を断る", () => {
    const { relay, clock } = setup();
    const claimed = relay.claim(ROOT_NODE, DEVICE_A, TOKEN);
    relay.start(claimed.attemptId, TOKEN);
    clock.advance(QUICK_MS);
    relay.buzz(claimed.attemptId, TOKEN, QUICK_MS, NO_RENDER);
    expect(code(() => relay.answer(claimed.attemptId, "other", question.answer))).toBe("invalid-token");
    relay.answer(claimed.attemptId, TOKEN, question.answer);
    expect(code(() => relay.shoot(claimed.attemptId, TOKEN, OUTSIDE, CENTER))).toBe("out-of-bounds");
    const shot = relay.shoot(claimed.attemptId, TOKEN, CENTER, CENTER);
    expect(shot.shot?.radius).toBeCloseTo(shot.radius ?? 0);
    expect(code(() => relay.shoot(claimed.attemptId, TOKEN, CENTER, CENTER))).toBe("bad-state");
  });

  it("存在しないノードと、木の作り直しを断る", () => {
    const { relay } = setup();
    expect(code(() => relay.nodeView("zzzzzz", null))).toBe("node-not-found");
    expect(code(() => relay.create(TREE, question.key))).toBe("bad-request");
  });
});
