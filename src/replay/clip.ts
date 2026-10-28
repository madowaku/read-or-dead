// 毎ターン共有する 1 発クリップの時間割。純粋関数のみ（描画は compose.ts、音は fx/synth.ts）。
//
// 共有動画は次の挑戦者が見る可能性があるので、どのフレームでも「撃った後」の画像だけを使う。
// 穴が広がる演出はせず、着弾はフラッシュで見せる。射撃前の無傷の部分は一瞬も映さない。

import type { Shot } from "../game/types";

export const SHOT_CLIP_MS = 5200;
/** 照準が中央から着弾点へ動く時間 */
export const AIM_MS = 1000;
export const IMPACT_AT = AIM_MS;
/** 画像全体を覆う着弾フラッシュ */
export const FLASH_MS = 220;
export const STAMP_MS = 900;
export const SHAKE_MS = 500;
export const CARD_AT = 2100;
const CARD_FADE_MS = 300;
const HALF = 0.5;
const SHAKE_FREQUENCY = 0.09;
/** 揺れ幅（画像の幅に対する比率）を弾の半径から決める係数 */
const SHAKE_PER_RADIUS = 0.25;
/** 着弾音は発砲音の少し後 */
const IMPACT_SOUND_DELAY_MS = 70;

export interface Reticle {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface ClipFrame {
  /** 描く弾痕。常に「撃った後」の全弾痕（最後の 1 発も最初から最大の半径） */
  readonly shots: readonly Shot[];
  /** 照準（着弾前のみ）。正規化座標 */
  readonly reticle: Reticle | null;
  /** 着弾からの経過ミリ秒（着弾前は null） */
  readonly sinceImpact: number | null;
  /** 画像全体を覆う白いフラッシュの濃さ（0〜1） */
  readonly flash: number;
  /** BANG! の文字の進み具合（0〜1、出ていなければ null） */
  readonly stamp: number | null;
  /** 画像の揺れ（画像の幅に対する比率） */
  readonly shake: number;
  /** 締めのカードの濃さ（0〜1） */
  readonly card: number;
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function clipFrameAt(before: readonly Shot[], shot: Shot, elapsedMs: number): ClipFrame {
  const shots = [...before, shot];
  const sinceImpact = elapsedMs - IMPACT_AT;
  if (sinceImpact < 0) {
    const t = easeOut(clamp01(elapsedMs / AIM_MS));
    return {
      shots,
      reticle: { x: HALF + (shot.x - HALF) * t, y: HALF + (shot.y - HALF) * t, radius: shot.radius },
      sinceImpact: null,
      flash: 0,
      stamp: null,
      shake: 0,
      card: 0,
    };
  }
  const shaking = sinceImpact < SHAKE_MS;
  return {
    shots,
    reticle: null,
    sinceImpact,
    flash: sinceImpact < FLASH_MS ? 1 - sinceImpact / FLASH_MS : 0,
    stamp: sinceImpact <= STAMP_MS ? sinceImpact / STAMP_MS : null,
    shake: shaking ? Math.sin(sinceImpact * SHAKE_FREQUENCY) * (1 - sinceImpact / SHAKE_MS) * shot.radius * SHAKE_PER_RADIUS : 0,
    card: elapsedMs >= CARD_AT ? clamp01((elapsedMs - CARD_AT) / CARD_FADE_MS) : 0,
  };
}

export type SoundKind = "shot" | "impact" | "finale" | "rewind";

export interface SoundCue {
  readonly kind: SoundKind;
  /** 動画の先頭からのミリ秒 */
  readonly atMs: number;
  /** 0（最小の弾）〜 1（最大の弾） */
  readonly power: number;
}

/** 1 発クリップの効果音：発砲 → 着弾 → 締め */
export function clipSoundCues(power: number): readonly SoundCue[] {
  return [
    { kind: "shot", atMs: IMPACT_AT, power },
    { kind: "impact", atMs: IMPACT_AT + IMPACT_SOUND_DELAY_MS, power },
    { kind: "finale", atMs: CARD_AT, power },
  ];
}
