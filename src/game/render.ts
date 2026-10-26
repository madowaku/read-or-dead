// 問題画像の生成と、弾痕（透明な円）の適用。
// すべて固定解像度のキャンバスで処理し、表示は CSS で拡縮する。
// 座標は正規化値で保持するので、画面サイズが違っても穴の位置は一致する。

import type { Question, Shot } from "./types";

export const SOURCE_SIZE = 1024;

const PAPER = "#ffffff";
const INK = "#000000";
const DISPLAY_FONT = '"Dela Gothic One"';
/** 文字が画像の端に触れない余白（辺に対する比率） */
const TEXT_MARGIN = 0.1;
const LINE_HEIGHT = 1.15;
const MAX_FONT_SIZE = 460;
const HALF = 0.5;
/** 円 1 周（2π） */
const FULL_TURN = Math.PI + Math.PI;

const imageCache = new Map<string, Promise<HTMLImageElement>>();

export class SourceLoadError extends Error {
  constructor(readonly src: string, options?: ErrorOptions) {
    super(`failed to load question image: ${src}`, options);
    this.name = "SourceLoadError";
  }
}

export class FontLoadError extends Error {
  constructor(readonly family: string, options?: ErrorOptions) {
    super(`問題用のフォントを読み込めませんでした。通信状態を確認して、もう一度試してください。（${family}）`, options);
    this.name = "FontLoadError";
  }
}

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SOURCE_SIZE;
  canvas.height = SOURCE_SIZE;
  return canvas;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas is not supported");
  return ctx;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src);
  if (cached) return cached;
  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = (): void => resolve(image);
    image.onerror = (): void => reject(new SourceLoadError(src));
    image.src = src;
  });
  imageCache.set(src, pending);
  try {
    return await pending;
  } catch (err) {
    imageCache.delete(src);
    throw err;
  }
}

interface TextLayout {
  readonly lines: readonly string[];
  readonly size: number;
}

/** 自動で折り返すとき 1 行に入れる最大文字数 */
const MAX_CHARS_PER_LINE = 6;
/** 幅を測るときの基準サイズ。実際のサイズは幅に比例して求める。 */
const MEASURE_SIZE = 100;
const LINE_BREAK = "\n";

/** 明示的な改行があればそれに従い、なければ文字数が均等になるよう分ける */
function splitLines(text: string): readonly string[] {
  if (text.includes(LINE_BREAK)) return text.split(LINE_BREAK).map((line) => line.trim()).filter(Boolean);
  const chars = Array.from(text.trim());
  const lineCount = Math.max(1, Math.ceil(chars.length / MAX_CHARS_PER_LINE));
  const perLine = Math.ceil(chars.length / lineCount);
  return Array.from({ length: lineCount }, (_, index) => chars.slice(index * perLine, (index + 1) * perLine).join("")).filter(Boolean);
}

/** 枠に収まる最大のサイズを求める */
function layoutText(text: string): TextLayout {
  const measure = context2d(createCanvas());
  measure.font = `${MEASURE_SIZE}px ${DISPLAY_FONT}`;
  const box = SOURCE_SIZE * (1 - TEXT_MARGIN - TEXT_MARGIN);
  const lines = splitLines(text);
  const widest = Math.max(1, ...lines.map((line) => measure.measureText(line).width));
  const byWidth = (box * MEASURE_SIZE) / widest;
  const byHeight = box / (Math.max(1, lines.length) * LINE_HEIGHT);
  return { lines, size: Math.floor(Math.min(MAX_FONT_SIZE, byWidth, byHeight)) };
}

async function drawText(canvas: HTMLCanvasElement, text: string): Promise<void> {
  // フォントが端末ごとに違うと画像が変わるため、同梱フォントの読み込みを待つ。
  // @font-face の登録前に呼ばれると load() は空配列で即座に解決するので、ready を待ってから確かめる。
  await document.fonts.ready;
  const faces = await document.fonts.load(`${MAX_FONT_SIZE}px ${DISPLAY_FONT}`, text);
  if (!faces.length) throw new FontLoadError(DISPLAY_FONT);
  const ctx = context2d(canvas);
  const { lines, size } = layoutText(text);
  ctx.fillStyle = INK;
  ctx.font = `${size}px ${DISPLAY_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lineHeight = size * LINE_HEIGHT;
  const top = SOURCE_SIZE * HALF - lines.length * lineHeight * HALF + lineHeight * HALF;
  lines.forEach((line, index) => ctx.fillText(line, SOURCE_SIZE * HALF, top + index * lineHeight));
}

async function drawSilhouette(canvas: HTMLCanvasElement, src: string): Promise<void> {
  const image = await loadImage(src);
  const ctx = context2d(canvas);
  const scale = Math.min(SOURCE_SIZE / image.naturalWidth, SOURCE_SIZE / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  ctx.drawImage(image, (SOURCE_SIZE - width) * HALF, (SOURCE_SIZE - height) * HALF, width, height);
}

/** 損傷前の元画像を作る */
export async function createSource(question: Question): Promise<HTMLCanvasElement> {
  const canvas = createCanvas();
  const ctx = context2d(canvas);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, SOURCE_SIZE, SOURCE_SIZE);
  if (question.kind === "silhouette") {
    await drawSilhouette(canvas, question.source);
  } else {
    await drawText(canvas, question.source);
  }
  return canvas;
}

/** 元画像に弾痕を適用して target に描く。穴は完全な透明になる。 */
export function drawDamaged(target: HTMLCanvasElement, source: HTMLCanvasElement, shots: readonly Shot[]): void {
  const ctx = context2d(target);
  ctx.save();
  ctx.globalCompositeOperation = "copy";
  ctx.drawImage(source, 0, 0, target.width, target.height);
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = INK;
  shots.forEach((shot) => {
    ctx.beginPath();
    ctx.arc(shot.x * target.width, shot.y * target.height, shot.radius * target.width, 0, FULL_TURN);
    ctx.fill();
  });
  ctx.restore();
}

export function createDamagedCanvas(source: HTMLCanvasElement, shots: readonly Shot[]): HTMLCanvasElement {
  const canvas = createCanvas();
  drawDamaged(canvas, source, shots);
  return canvas;
}
