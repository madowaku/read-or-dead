// 9:16 の共有用フレームを描く。動画の各フレームと、保存用の 1 枚画像の両方に使う。

import { SOURCE_SIZE, drawDamaged } from "../game/render";
import type { Shot } from "../game/types";
import { COLOR, FONT } from "../theme";
import type { ReplayFrame } from "./timeline";

export const FRAME_WIDTH = 1080;
export const FRAME_HEIGHT = 1920;

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
  canvas.width = FRAME_WIDTH;
  canvas.height = FRAME_HEIGHT;
  return canvas;
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

function drawHeader(canvas: HTMLCanvasElement, meta: ReplayMeta): void {
  const ctx = context2d(canvas);
  ctx.fillStyle = COLOR.cobalt;
  ctx.fillRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = COLOR.pink;
  ctx.font = `${TITLE_SIZE}px ${FONT.display}`;
  ctx.fillText("READ OR DEAD", MARGIN, TITLE_BASELINE);
  ctx.fillStyle = COLOR.mist;
  ctx.font = `700 ${STATS_SIZE}px ${FONT.body}`;
  ctx.fillText(`${meta.survivors}人が読んで、${meta.shotCount}発撃った`, MARGIN, STATS_BASELINE);
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

export type FrameComposer = (target: HTMLCanvasElement, frame: ReplayFrame) => void;

/** リプレイの 1 フレームを描く関数を作る。作業用キャンバスを使い回す。 */
export function createComposer(source: HTMLCanvasElement, meta: ReplayMeta): FrameComposer {
  const scratch = document.createElement("canvas");
  scratch.width = SOURCE_SIZE;
  scratch.height = SOURCE_SIZE;
  return (target, frame) => {
    drawDamaged(scratch, source, frame.shots);
    drawHeader(target, meta);
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
  const damaged = document.createElement("canvas");
  damaged.width = SOURCE_SIZE;
  damaged.height = SOURCE_SIZE;
  drawDamaged(damaged, source, shots);
  drawHeader(canvas, meta);
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
