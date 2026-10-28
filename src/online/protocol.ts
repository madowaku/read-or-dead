// オンライン（URL リレー）のブラウザとサーバーの取り決め。両方から読み込む。
// 木（tree）：1 つの問題。ノード（node）：根からの射撃の並び。挑戦（attempt）：1 人の 1 回の挑戦。

import type { Shot } from "../game/types";

/** まだ誰も撃っていない状態のノード */
export const ROOT_NODE = "0";
export const TREE_ID_LENGTH = 10;
export const NODE_ID_LENGTH = 6;
export const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/** READY? のあと、この時間内に回答しないと時間切れ */
export const ANSWER_LIMIT_MS = 90_000;
/** 回答の長さの上限 */
export const MAX_ANSWER_LENGTH = 100;
/** 端末を見分ける ID を送るヘッダー */
export const DEVICE_HEADER = "X-Device-Id";

export type OnlinePool = "kanji" | "word" | "silhouette" | "all";

export type AttemptStatus = "claimed" | "started" | "buzzed" | "correct" | "shot" | "wrong" | "give-up" | "expired";

export type TreeErrorCode =
  | "tree-not-found"
  | "node-not-found"
  | "already-played"
  | "tree-full"
  | "attempt-not-found"
  | "invalid-token"
  | "bad-state"
  | "expired"
  | "out-of-bounds"
  | "bad-request"
  | "rate-limited";

/** 挑戦ページを開いたときに見せてよい情報。問題の中身は入れない。 */
export interface NodeView {
  readonly treeId: string;
  readonly nodeId: string;
  /** このノードまでに撃たれた数 */
  readonly depth: number;
  /** この端末がこの木で始めた挑戦（なければ null） */
  readonly myAttempt: { readonly attemptId: string; readonly nodeId: string; readonly status: AttemptStatus } | null;
}

/** 挑戦の状態。どの API もこれを返し、ブラウザはこれだけで画面を作り直せる。 */
export interface AttemptState {
  readonly treeId: string;
  readonly attemptId: string;
  readonly nodeId: string;
  /** 何人目の挑戦か（撃たれた数 + 1） */
  readonly turnNumber: number;
  readonly status: AttemptStatus;
  /** READY? を押したあとだけ入る */
  readonly questionKey: string | null;
  /** READY? を押したあとだけ入る。根からこのノードまでの射撃 */
  readonly shots: readonly Shot[];
  /** READY? を押してからの経過時間（サーバーで計った、応答した時点の値） */
  readonly elapsedMs: number | null;
  readonly buzzMs: number | null;
  readonly radius: number | null;
  /** 撃ったあとだけ入る */
  readonly shot: Shot | null;
  readonly childNodeId: string | null;
  /** 失敗で終わったあとだけ入る（表示用の答え） */
  readonly answer: string | null;
  readonly submittedAnswer: string | null;
}

/** 挑戦の参加権。token は挑戦を始めた端末だけが持つ。 */
export interface ClaimResult {
  readonly token: string;
  readonly state: AttemptState;
}

export interface CreatedTree {
  readonly treeId: string;
  readonly nodeId: string;
}

export interface ApiError {
  readonly error: TreeErrorCode;
}

export function isBase62(text: string, length: number): boolean {
  return text.length === length && Array.from(text).every((ch) => BASE62.includes(ch));
}

export function isNodeId(text: string): boolean {
  return text === ROOT_NODE || isBase62(text, NODE_ID_LENGTH);
}

export function challengePath(treeId: string, nodeId: string): string {
  return `/r/${treeId}/${nodeId}`;
}

export function isFinished(status: AttemptStatus): boolean {
  return status === "shot" || status === "wrong" || status === "give-up" || status === "expired";
}

export function isFailure(status: AttemptStatus): boolean {
  return status === "wrong" || status === "give-up" || status === "expired";
}
