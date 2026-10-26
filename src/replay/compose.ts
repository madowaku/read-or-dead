// 9:16 の共有用フレームを描く。動画の各フレームと、保存用の 1 枚画像の両方に使う。
// 座標は 1080×1920 の論理座標で書き、出力は X 向けに軽い 720×1280 に縮める。

import { BURST_MS, createBurst, drawBurst, type Burst } from "../fx/burst";
import fx from "../fx/fx.json";
import { seedFrom } from "../fx/random";
import { SOURCE_SIZE, drawDamaged } from "../game/render";
import type { Shot } from "../game/types";
import { COLOR, FONT } from "../theme";
import type { ReplayFrame } from "./timeline";

/** 出力解像度 */
export const OUTPUT_WIDTH = 720;
export const OUTPUT_HEIGHT = 1280;
/** 論理座標 */
const FRAME_WIDTH = 1080;
const FRAME_HEIGHT = 1920;
const OUTPUT_SCALE = OUTPUT_WIDTH / FRAME_WIDTH;

const MARGIN = 60;
const IMAGE_SIZE = FRAME_WIDTH - MARGIN - MARGIN;
const IMAGE_TOP = 360;
const CHECKER_CELL = 40;
const TITLE_BASELINE = 170;
const TITLE_SIZE = 76;
const STATS_BASELINE = 260;
const STATS_SIZE = 40;
const COUNTER_BASELINE = 1530;
const COUNTER_SIZE = 150;
const COUNTER_LABEL_SIZE = 56;
const QUESTION_SIZE = 116;
const QUESTION_LINE = 140;
const QUESTION_BASELINE = 1620;
const ANSWER_BASELINE = 1800;
const ANSWER_SIZE = 56;
const POSTER_THUMB = 400;
const POSTER_ROW_TOP = IMAGE_TOP + IMAGE_SIZE + MARGIN;
const POSTER_TEXT_SIZE = 64;
const POSTER_LABEL_SIZE = 40;
const LABEL_GAP = 16;
const EVEN = 2;
const HALF = 0.5;
const FULL_TURN = Math.PI + Math.PI;
const SHOT_NUMBER_DIGITS = 3;

// ---- 毎ターン共有するクリップの時間割（ミリ秒） ----
export const SHOT_CLIP_MS = 5200;
const AIM_MS = 1000;
const IMPACT_AT = AIM_MS;
const STAMP_MS = 900;
const CARD_AT = 2100;
const CARD_FADE_MS = 300;
const SHAKE_PER_RADIUS = 4;
const SHAKE_FREQUENCY = 0.09;
const SHAKE_MS = 500;
const RETICLE_LINE = 8;
const RETICLE_CROSS = 1.6;
const STAMP_SIZE = 190;
const STAMP_START_SCALE = 1.8;
const STAMP_TILT = -0.12;
const STAMP_OFFSET = 200;
const STAMP_BASELINE = IMAGE_TOP + STAMP_OFFSET;
const STAMP_STROKE = 14;
const CARD_SHOTS_BASELINE = 1530;
const CARD_SHOTS_SIZE = 150;
const CARD_QUESTION_BASELINE = 1660;
const CARD_QUESTION_SIZE = 84;
const CARD_NEXT_BASELINE = 1790;
const CARD_NEXT_SIZE = 52;

export interface ReplayMeta {
  readonly answer: string;
  readonly shotCount: number;
  readonly survivors: number;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas is not supported");
  return ctx;
}

export function createFrameCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_WIDTH;
  canvas.height = OUTPUT_HEIGHT;
  return canvas;
}

function createImageCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SOURCE_SIZE;
  canvas.height = SOURCE_SIZE;
  return canvas;
}

/** 論理座標で描けるよう縮小をかけ、背景を塗る */
function beginFrame(canvas: HTMLCanvasElement): void {
  const ctx = context2d(canvas);
  ctx.setTransform(OUTPUT_SCALE, 0, 0, OUTPUT_SCALE, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = COLOR.cobalt;
  ctx.fillRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
}

/** 穴の向こうに見える市松模様 */
function drawChecker(canvas: HTMLCanvasElement, x: number, y: number, size: number): void {
  const ctx = context2d(canvas);
  const cells = Math.ceil(size / CHECKER_CELL);
  ctx.fillStyle = COLOR.checkerLight;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = COLOR.checkerDark;
  Array.from({ length: cells * cells }, (_, index) => index)
    .filter((index) => (Math.floor(index / cells) + (index % cells)) % EVEN === 0)
    .forEach((index) => {
      const cx = x + (index % cells) * CHECKER_CELL;
      const cy = y + Math.floor(index / cells) * CHECKER_CELL;
      ctx.fillRect(cx, cy, Math.min(CHECKER_CELL, x + size - cx), Math.min(CHECKER_CELL, y + size - cy));
    });
}

/** maxWidth に収まるまで文字を縮めて描く */
function fillFitted(canvas: HTMLCanvasElement, text: string, x: number, y: number, size: number, maxWidth: number): void {
  const ctx = context2d(canvas);
  ctx.font = `${size}px ${FONT.display}`;
  const width = ctx.measureText(text).width;
  const fitted = width > maxWidth ? Math.floor((size * maxWidth) / width) : size;
  ctx.font = `${fitted}px ${FONT.display}`;
  ctx.fillText(text, x, y);
}

function drawHeader(canvas: HTMLCanvasElement, subtitle: string): void {
  const ctx = context2d(canvas);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = COLOR.pink;
  ctx.font = `${TITLE_SIZE}px ${FONT.display}`;
  ctx.fillText("READ OR DEAD", MARGIN, TITLE_BASELINE);
  ctx.fillStyle = COLOR.mist;
  ctx.font = `700 ${STATS_SIZE}px ${FONT.body}`;
  ctx.fillText(subtitle, MARGIN, STATS_BASELINE);
}

function drawImage(canvas: HTMLCanvasElement, damaged: HTMLCanvasElement, x: number, y: number, size: number): void {
  drawChecker(canvas, x, y, size);
  context2d(canvas).drawImage(damaged, x, y, size, size);
}

function drawCounter(canvas: HTMLCanvasElement, remaining: number): void {
  const ctx = context2d(canvas);
  ctx.textAlign = "left";
  ctx.fillStyle = COLOR.paper;
  ctx.font = `${COUNTER_SIZE}px ${FONT.display}`;
  const digits = String(remaining);
  ctx.fillText(digits, MARGIN, COUNTER_BASELINE);
  const width = ctx.measureText(digits).width;
  ctx.font = `${COUNTER_LABEL_SIZE}px ${FONT.display}`;
  ctx.fillStyle = COLOR.mist;
  ctx.fillText("発目", MARGIN + width + LABEL_GAP, COUNTER_BASELINE);
}

function drawQuestion(canvas: HTMLCanvasElement, meta: ReplayMeta): void {
  const ctx = context2d(canvas);
  ctx.textAlign = "left";
  ctx.fillStyle = COLOR.paper;
  ctx.font = `${QUESTION_SIZE}px ${FONT.display}`;
  ctx.fillText("何発目で", MARGIN, QUESTION_BASELINE - QUESTION_LINE);
  ctx.fillText("分かった？", MARGIN, QUESTION_BASELINE);
  ctx.fillStyle = COLOR.pink;
  fillFitted(canvas, `こたえ　${meta.answer}`, MARGIN, ANSWER_BASELINE, ANSWER_SIZE, IMAGE_SIZE);
}

function statsLine(meta: ReplayMeta): string {
  return `${meta.survivors}人が読んで、${meta.shotCount}発撃った`;
}

export type FrameComposer = (target: HTMLCanvasElement, frame: ReplayFrame) => void;

/** 終了後の逆再生リプレイの 1 フレームを描く関数を作る。作業用キャンバスを使い回す。 */
export function createComposer(source: HTMLCanvasElement, meta: ReplayMeta): FrameComposer {
  const scratch = createImageCanvas();
  return (target, frame) => {
    drawDamaged(scratch, source, frame.shots);
    beginFrame(target);
    drawHeader(target, statsLine(meta));
    drawImage(target, scratch, MARGIN, IMAGE_TOP, IMAGE_SIZE);
    if (frame.phase === "question") {
      drawQuestion(target, meta);
    } else {
      drawCounter(target, frame.remaining);
    }
  };
}

/** 動画を作れない環境向けの 1 枚画像。完成画像・元画像・問いかけを並べる。 */
export function composePoster(source: HTMLCanvasElement, shots: readonly Shot[], meta: ReplayMeta): HTMLCanvasElement {
  const canvas = createFrameCanvas();
  const damaged = createImageCanvas();
  drawDamaged(damaged, source, shots);
  beginFrame(canvas);
  drawHeader(canvas, statsLine(meta));
  drawImage(canvas, damaged, MARGIN, IMAGE_TOP, IMAGE_SIZE);
  drawImage(canvas, source, MARGIN, POSTER_ROW_TOP, POSTER_THUMB);

  const ctx = context2d(canvas);
  const textLeft = MARGIN + POSTER_THUMB + MARGIN;
  ctx.textAlign = "left";
  ctx.fillStyle = COLOR.paper;
  ctx.font = `${POSTER_TEXT_SIZE}px ${FONT.display}`;
  ctx.fillText("何発目で", textLeft, POSTER_ROW_TOP + POSTER_TEXT_SIZE);
  ctx.fillText("分かった？", textLeft, POSTER_ROW_TOP + POSTER_TEXT_SIZE + POSTER_TEXT_SIZE + LABEL_GAP);
  ctx.fillStyle = COLOR.pink;
  fillFitted(canvas, `こたえ　${meta.answer}`, textLeft, POSTER_ROW_TOP + POSTER_THUMB, POSTER_LABEL_SIZE, FRAME_WIDTH - MARGIN - textLeft);
  return canvas;
}

// ---- 毎ターンの共有クリップ ----

export interface ShotClipMeta {
  readonly turnNumber: number;
  readonly shotCount: number;
}

export function shotLabel(turnNumber: number): string {
  return `SHOT #${String(turnNumber).padStart(SHOT_NUMBER_DIGITS, "0")}`;
}

export function shotBurst(shot: Shot): Burst {
  return createBurst(shot.x, shot.y, shot.radius, seedFrom(`${shot.chainId}:${shot.turnNumber}`));
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function drawReticle(canvas: HTMLCanvasElement, x: number, y: number, radius: number): void {
  const ctx = context2d(canvas);
  ctx.strokeStyle = COLOR.pink;
  ctx.lineWidth = RETICLE_LINE;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, FULL_TURN);
  ctx.moveTo(x - radius * RETICLE_CROSS, y);
  ctx.lineTo(x + radius * RETICLE_CROSS, y);
  ctx.moveTo(x, y - radius * RETICLE_CROSS);
  ctx.lineTo(x, y + radius * RETICLE_CROSS);
  ctx.stroke();
}

function drawStamp(canvas: HTMLCanvasElement, progress: number): void {
  const ctx = context2d(canvas);
  const scale = STAMP_START_SCALE - (STAMP_START_SCALE - 1) * easeOut(Math.min(1, progress * EVEN));
  ctx.save();
  ctx.globalAlpha = Math.min(1, (1 - progress) * EVEN);
  ctx.translate(FRAME_WIDTH * HALF, STAMP_BASELINE);
  ctx.rotate(STAMP_TILT);
  ctx.scale(scale, scale);
  ctx.textAlign = "center";
  ctx.font = `${STAMP_SIZE}px ${FONT.display}`;
  ctx.lineWidth = STAMP_STROKE;
  ctx.strokeStyle = COLOR.ink;
  ctx.strokeText("BANG!", 0, 0);
  ctx.fillStyle = COLOR.pink;
  ctx.fillText("BANG!", 0, 0);
  ctx.restore();
}

function drawCard(canvas: HTMLCanvasElement, meta: ShotClipMeta, alpha: number): void {
  const ctx = context2d(canvas);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = "left";
  ctx.fillStyle = COLOR.pink;
  fillFitted(canvas, `${meta.shotCount} SHOT${meta.shotCount === 1 ? "" : "S"}!`, MARGIN, CARD_SHOTS_BASELINE, CARD_SHOTS_SIZE, IMAGE_SIZE);
  ctx.fillStyle = COLOR.paper;
  fillFitted(canvas, "CAN YOU READ IT?", MARGIN, CARD_QUESTION_BASELINE, CARD_QUESTION_SIZE, IMAGE_SIZE);
  ctx.fillStyle = COLOR.mist;
  ctx.font = `${CARD_NEXT_SIZE}px ${FONT.display}`;
  ctx.fillText("次はあなたの番。", MARGIN, CARD_NEXT_BASELINE);
  ctx.restore();
}

export type ClipComposer = (target: HTMLCanvasElement, elapsedMs: number) => void;

/**
 * 1 発分のクリップ。狙う → BANG（衝撃波・破片・揺れ）→「CAN YOU READ IT?」。
 * 答えは出さない。
 */
export function createShotClipComposer(source: HTMLCanvasElement, before: readonly Shot[], shot: Shot, meta: ShotClipMeta): ClipComposer {
  const scratch = createImageCanvas();
  const burst = shotBurst(shot);
  const shotX = MARGIN + shot.x * IMAGE_SIZE;
  const shotY = IMAGE_TOP + shot.y * IMAGE_SIZE;
  const reticleRadius = shot.radius * IMAGE_SIZE;
  return (target, elapsedMs) => {
    const sinceImpact = elapsedMs - IMPACT_AT;
    const grow = Math.min(1, Math.max(0, sinceImpact / fx.hole.growMs));
    const shots = grow > 0 ? [...before, { ...shot, radius: shot.radius * easeOut(grow) }] : before;
    drawDamaged(scratch, source, shots);

    beginFrame(target);
    drawHeader(target, shotLabel(meta.turnNumber));
    const shaking = sinceImpact > 0 && sinceImpact < SHAKE_MS;
    const shake = shaking ? Math.sin(sinceImpact * SHAKE_FREQUENCY) * (1 - sinceImpact / SHAKE_MS) * shot.radius * SHAKE_PER_RADIUS * MARGIN : 0;
    drawImage(target, scratch, MARGIN + shake, IMAGE_TOP - shake * HALF, IMAGE_SIZE);

    if (sinceImpact < 0) {
      const t = easeOut(elapsedMs / AIM_MS);
      const centerX = MARGIN + IMAGE_SIZE * HALF;
      const centerY = IMAGE_TOP + IMAGE_SIZE * HALF;
      drawReticle(target, centerX + (shotX - centerX) * t, centerY + (shotY - centerY) * t, reticleRadius);
    }
    if (sinceImpact >= 0 && sinceImpact <= BURST_MS) {
      drawBurst(target, burst, sinceImpact, { left: MARGIN, top: IMAGE_TOP, size: IMAGE_SIZE });
    }
    if (sinceImpact >= 0 && sinceImpact <= STAMP_MS) drawStamp(target, sinceImpact / STAMP_MS);
    if (elapsedMs >= CARD_AT) drawCard(target, meta, Math.min(1, (elapsedMs - CARD_AT) / CARD_FADE_MS));
  };
}

/** 動画を作れない環境向け。クリップの最後の 1 枚。 */
export function composeShotCard(source: HTMLCanvasElement, before: readonly Shot[], shot: Shot, meta: ShotClipMeta): HTMLCanvasElement {
  const canvas = createFrameCanvas();
  createShotClipComposer(source, before, shot, meta)(canvas, SHOT_CLIP_MS);
  return canvas;
}
