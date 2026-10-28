// リンクカードのテンプレートを作る道具。開発サーバーで /tools/card-template.html を開くと、
// 文字入りのテンプレートと数字の画像をパレット番号に変換し、worker/card-template.ts の中身を出力する。
// 文字やレイアウトを変えたときだけ作り直す。

import "@fontsource/dela-gothic-one/400.css";
import "@fontsource/zen-kaku-gothic-new/700.css";
import { CARD_HEIGHT, CARD_WIDTH, DIGIT, DIGIT_SLOT, PALETTE, PAPER, type Rgb } from "../src/online/card-layout";
import tool from "./card-template.json";

const DISPLAY = '"Dela Gothic One"';
const BODY = '"Zen Kaku Gothic New"';
const RGBA = 4;
const DIGIT_GLYPHS = 10;
const HALF = 2;
const SQUARE = 2;
const GREEN = 1;
const BLUE = 2;

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2d context unavailable");
  return ctx;
}

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function css([r, g, b]: Rgb): string {
  return `rgb(${r}, ${g}, ${b})`;
}

/** 各画素を、いちばん近いパレットの色の番号にする */
function quantize(canvas: HTMLCanvasElement): Uint8Array<ArrayBuffer> {
  const { data } = context(canvas).getImageData(0, 0, canvas.width, canvas.height);
  return Uint8Array.from({ length: canvas.width * canvas.height }, (_, index) => {
    const r = data[index * RGBA] ?? 0;
    const g = data[index * RGBA + GREEN] ?? 0;
    const b = data[index * RGBA + BLUE] ?? 0;
    const distances = PALETTE.map(([pr, pg, pb]) => (pr - r) ** SQUARE + (pg - g) ** SQUARE + (pb - b) ** SQUARE);
    return distances.indexOf(Math.min(...distances));
  });
}

async function deflateBase64(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  const packed = new Uint8Array(await new Response(stream).arrayBuffer());
  return btoa(Array.from(packed, (byte) => String.fromCharCode(byte)).join(""));
}

const colors = tool.colors;

function drawTemplate(): HTMLCanvasElement {
  const canvas = canvasOf(CARD_WIDTH, CARD_HEIGHT);
  const ctx = context(canvas);
  ctx.fillStyle = colors.cobalt;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  ctx.fillStyle = colors.paper;
  ctx.fillRect(PAPER.x, PAPER.y, PAPER.size, PAPER.size);

  // 紙の真ん中の大きな「？」（穴はこの上に描かれる）
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = colors.mist;
  ctx.font = `400 ${tool.question.size}px ${DISPLAY}`;
  ctx.fillText("？", PAPER.x + PAPER.size / HALF, PAPER.y + PAPER.size / HALF);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  tool.texts.forEach((text) => {
    ctx.fillStyle = colors[text.color as keyof typeof colors];
    ctx.font = text.display ? `400 ${text.size}px ${DISPLAY}` : `700 ${text.size}px ${BODY}`;
    ctx.fillText(text.text, text.x, text.y);
  });
  // 数字の枠は空けておく（Worker が描く）
  ctx.fillStyle = colors.cobalt;
  ctx.fillRect(DIGIT_SLOT.x, DIGIT_SLOT.y, CARD_WIDTH - DIGIT_SLOT.x, DIGIT.height);
  return canvas;
}

function drawDigits(): HTMLCanvasElement {
  const canvas = canvasOf(DIGIT.width * DIGIT_GLYPHS, DIGIT.height);
  const ctx = context(canvas);
  ctx.fillStyle = colors.cobalt;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = colors.paper;
  ctx.font = `400 ${tool.digitFont}px ${DISPLAY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  Array.from({ length: DIGIT_GLYPHS }, (_, digit) => ctx.fillText(String(digit), digit * DIGIT.width + DIGIT.width / HALF, DIGIT.height / HALF + tool.digitNudge));
  return canvas;
}

async function main(): Promise<void> {
  await document.fonts.load(`400 ${tool.digitFont}px ${DISPLAY}`, "READ OR DEAD TURN 0123456789 読める？");
  await document.fonts.load(`700 ${tool.question.size}px ${BODY}`, "答えはリンクの先で。");
  await document.fonts.ready;
  const template = drawTemplate();
  const digits = drawDigits();
  const preview = canvasOf(CARD_WIDTH, CARD_HEIGHT);
  const previewCtx = context(preview);
  previewCtx.drawImage(template, 0, 0);
  previewCtx.fillStyle = css(PALETTE[0] ?? [0, 0, 0]);
  previewCtx.drawImage(digits, 0, 0, DIGIT.width * DIGIT_GLYPHS, DIGIT.height, DIGIT_SLOT.x, DIGIT_SLOT.y, DIGIT.width * DIGIT_GLYPHS, DIGIT.height);
  document.body.append(preview);

  const source = [
    "// tools/card-template.html で作ったリンクカードのテンプレート。手で書き換えない。",
    "// パレット番号（src/online/card-layout.ts の PALETTE）の並びを deflate して base64 にしたもの。",
    "",
    `export const TEMPLATE_DATA = "${await deflateBase64(quantize(template))}";`,
    "",
    `export const DIGITS_DATA = "${await deflateBase64(quantize(digits))}";`,
    "",
  ].join("\n");
  const output = document.createElement("textarea");
  output.id = "output";
  output.value = source;
  document.body.append(output);
}

void main();
