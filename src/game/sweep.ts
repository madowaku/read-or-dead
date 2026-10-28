// 横→縦の 2 回タップ照準の動き。純粋関数のみ（画面は ui/aim.ts）。
// 照準の線は画像の端で跳ね返りながら一定の速さで往復する。大きい弾ほど速く動いて当てにくい。

import fx from "../fx/fx.json";
import { MAX_RADIUS, MIN_RADIUS } from "./power";

const TUNING = fx.sweep;
/** 1 往復は片道 2 回分 */
const LEGS_PER_CYCLE = 2;

/** 画像の端から端まで動く時間（ミリ秒）。最小の弾で遅く、最大の弾で速い。 */
export function traverseMsFor(radius: number): number {
  const level = Math.min(1, Math.max(0, (radius - MIN_RADIUS) / (MAX_RADIUS - MIN_RADIUS)));
  return TUNING.traverseMsWeak + (TUNING.traverseMsPower - TUNING.traverseMsWeak) * level;
}

/**
 * elapsedMs 時点の線の位置（0〜1）。端で跳ね返る三角波。
 * startAt は動き出す位置（0〜1）で、最初は 0→1 の向きに進む。
 */
export function sweepPosition(elapsedMs: number, traverseMs: number, startAt = 0): number {
  const cycle = traverseMs * LEGS_PER_CYCLE;
  const phase = (((elapsedMs + startAt * traverseMs) % cycle) + cycle) % cycle;
  return phase <= traverseMs ? phase / traverseMs : LEGS_PER_CYCLE - phase / traverseMs;
}

/** 1 回目のタップの直後に 2 回目が誤って入らないよう、この時間は受け付けない */
export const LOCK_GUARD_MS = TUNING.lockGuardMs;
