// リンクカード（1200×630）の配置と色。テンプレートを作る道具（tools/card-template）と Worker の両方から読む。
// テンプレートは「パレット番号の並び」を deflate で縮めたもの。Worker は穴と数字だけを描き足して PNG にする。

import layout from "./card-layout.json";

export const CARD_WIDTH = layout.width;
export const CARD_HEIGHT = layout.height;
/** 穴を描く紙の正方形 */
export const PAPER = layout.paper;
/** 「TURN 004」の数字を置く場所。1 桁ずつ DIGIT の大きさの枠に入れる */
export const DIGIT = layout.digit;
export const DIGIT_SLOT = layout.digitSlot;
export const DIGIT_COUNT = layout.digitCount;
export const HOLE = layout.hole;

export type Rgb = readonly [number, number, number];

const COLORS = layout.colors;
const RAMP_STEPS = layout.rampSteps;

function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), layout.hexRadix);
  const BYTE = 0xff;
  const GREEN_SHIFT = 8;
  const RED_SHIFT = 16;
  return [(value >> RED_SHIFT) & BYTE, (value >> GREEN_SHIFT) & BYTE, value & BYTE];
}

function ramp(from: string, to: string): Rgb[] {
  const [r1, g1, b1] = hexToRgb(from);
  const [r2, g2, b2] = hexToRgb(to);
  const mix = (a: number, b: number, t: number): number => Math.round(a + (b - a) * t);
  return Array.from({ length: RAMP_STEPS }, (_, step): Rgb => {
    const t = step / (RAMP_STEPS - 1);
    return [mix(r1, r2, t), mix(g1, g2, t), mix(b1, b2, t)];
  });
}

/**
 * パレット。文字のふちのなめらかさを残すため、背景と文字色のあいだを段階に分けて持つ。
 * 先頭が背景（コバルト）、各段階の最後がその色そのもの。
 */
export const PALETTE: readonly Rgb[] = [
  ...ramp(COLORS.cobalt, COLORS.paper),
  ...ramp(COLORS.cobalt, COLORS.pink),
  ...ramp(COLORS.cobalt, COLORS.mist),
  ...ramp(COLORS.paper, COLORS.ink),
  ...ramp(COLORS.paper, COLORS.mist),
  hexToRgb(COLORS.checkerLight),
  hexToRgb(COLORS.checkerDark),
];

/** 背景（コバルト） */
export const INDEX_COBALT = 0;
/** 紙の白（紙とインクの段階の先頭） */
export const INDEX_PAPER = RAMP_STEPS * layout.paperRampIndex;
/** インクの黒（紙とインクの段階の最後） */
export const INDEX_INK = INDEX_PAPER + RAMP_STEPS - 1;
export const INDEX_CHECKER_LIGHT = PALETTE.length - layout.checkerFromEnd.light;
export const INDEX_CHECKER_DARK = PALETTE.length - layout.checkerFromEnd.dark;
