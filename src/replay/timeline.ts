// 逆再生リプレイの時間割。完成時点の画像から始め、最後の 1 発から順に穴を塞いでいく。
// 純粋関数のみ。描画は compose.ts が担う。

import type { Shot } from "../game/types";
import type { SoundCue } from "./clip";

export const HOLD_START_MS = 1400;
export const STEP_MS = 650;
/** 穴を塞ぐ時間の上限。発数が多くても全体を 8〜12 秒程度に収める。 */
export const RESTORE_BUDGET_MS = 6000;
export const HOLD_ORIGINAL_MS = 1200;
export const QUESTION_CARD_MS = 2600;

export type ReplayPhase = "damaged" | "restoring" | "original" | "question";

export interface ReplayFrame {
  readonly phase: ReplayPhase;
  /** この瞬間に描く穴（塞ぎかけの穴は半径を縮めて含む） */
  readonly shots: readonly Shot[];
  /** 画面に出す「残り何発」。塞ぎ終わった穴は数えない。 */
  readonly remaining: number;
}

/** 1 発を塞ぐ時間。発数が多いほど速くなる。 */
export function stepMs(shotCount: number): number {
  return shotCount ? Math.min(STEP_MS, RESTORE_BUDGET_MS / shotCount) : STEP_MS;
}

export function replayDuration(shotCount: number): number {
  return HOLD_START_MS + shotCount * stepMs(shotCount) + HOLD_ORIGINAL_MS + QUESTION_CARD_MS;
}

/** 0→1 を滑らかに。穴が塞がる動きに使う。 */
function easeInOut(t: number): number {
  const HALF = 0.5;
  const QUAD = 2;
  return t < HALF ? QUAD * t * t : 1 - (-QUAD * t + QUAD) ** QUAD / QUAD;
}

export function frameAt(shots: readonly Shot[], elapsedMs: number): ReplayFrame {
  const total = shots.length;
  if (elapsedMs < HOLD_START_MS) return { phase: "damaged", shots, remaining: total };

  const step = stepMs(total);
  const restoring = elapsedMs - HOLD_START_MS;
  if (restoring < total * step) {
    const undone = Math.floor(restoring / step);
    const progress = easeInOut((restoring - undone * step) / step);
    const keep = total - undone - 1;
    const closing = shots[keep];
    const kept = shots.slice(0, keep);
    const frameShots = closing ? [...kept, { ...closing, radius: closing.radius * (1 - progress) }] : kept;
    return { phase: "restoring", shots: frameShots, remaining: keep + 1 };
  }

  const afterRestore = restoring - total * step;
  if (afterRestore < HOLD_ORIGINAL_MS) return { phase: "original", shots: [], remaining: 0 };
  return { phase: "question", shots: [], remaining: 0 };
}

/** 逆再生の効果音：穴が塞がり始めるたびに巻き戻し音、問いかけで締め */
export function replaySoundCues(shotCount: number): readonly SoundCue[] {
  const step = stepMs(shotCount);
  const rewinds = Array.from({ length: shotCount }, (_, index): SoundCue => ({ kind: "rewind", atMs: HOLD_START_MS + index * step, power: 0 }));
  return [...rewinds, { kind: "finale", atMs: HOLD_START_MS + shotCount * step + HOLD_ORIGINAL_MS, power: 0 }];
}
