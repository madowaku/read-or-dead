// 早く読めた人ほど大きな弾を撃てる。
// 「わかった！」を押すまでの時間で半径が決まる。日本語入力の速さで不利にならないよう、入力時間は数えない。

/** 0 秒で押したときの半径（画像の幅に対する比率） */
export const MAX_RADIUS = 0.12;
/** SLOW_LIMIT_MS 以降に押したときの半径 */
export const MIN_RADIUS = 0.06;
/** これより遅いと最小の弾になる。回答そのものに制限時間はない。 */
export const SLOW_LIMIT_MS = 15_000;

export type PowerRank = "power" | "normal" | "weak";

/** 弾の格付けの境目（半径） */
const POWER_THRESHOLD = 0.1;
const WEAK_THRESHOLD = 0.075;

export function radiusFor(elapsedMs: number): number {
  const progress = Math.min(1, Math.max(0, elapsedMs / SLOW_LIMIT_MS));
  return MAX_RADIUS - (MAX_RADIUS - MIN_RADIUS) * progress;
}

export function rankOf(radius: number): PowerRank {
  if (radius >= POWER_THRESHOLD) return "power";
  if (radius > WEAK_THRESHOLD) return "normal";
  return "weak";
}
