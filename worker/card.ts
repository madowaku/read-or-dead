// リンクカード「弾痕カード」を作る。問題の画像は使わず、紙に撃たれた穴の位置と何人目かだけを描く。
// 文字入りのテンプレート（tools/card-template で作る）に穴と数字を描き足して、パレット形式の PNG にする。

import type { Shot } from "../src/game/types";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  DIGIT,
  DIGIT_COUNT,
  DIGIT_SLOT,
  HOLE,
  INDEX_CHECKER_DARK,
  INDEX_CHECKER_LIGHT,
  INDEX_COBALT,
  INDEX_INK,
  PALETTE,
  PAPER,
} from "../src/online/card-layout";
import { DIGITS_DATA, TEMPLATE_DATA } from "./card-template";

const DIGIT_GLYPHS = 10;
/** PNG ファイルの先頭 8 バイト（"PNG


"） */
const PNG_SIGNATURE = Uint8Array.from(atob("iVBORw0KGgo="), (ch) => ch.charCodeAt(0));
const BIT_DEPTH = 8;
const COLOR_TYPE_PALETTE = 3;
const FILTER_NONE = 0;
const CHANNELS = 3;
const IHDR_LENGTH = 13;
const UINT32_BYTES = 4;
const CRC_POLYNOMIAL = 0xedb88320;
const CRC_INITIAL = 0xffffffff;
const BYTE_BITS = 8;
const BYTE_VALUES = 256;
/** 画素の中心 */
const PIXEL_CENTER = 0.5;
const CHECKER_PARITY = 2;

const CRC_TABLE: readonly number[] = Array.from({ length: BYTE_VALUES }, (_, n) =>
  Array.from({ length: BYTE_BITS }).reduce<number>((c) => (c & 1 ? CRC_POLYNOMIAL ^ (c >>> 1) : c >>> 1), n),
);

function crc32(bytes: Uint8Array): number {
  return (bytes.reduce((crc, byte) => (CRC_TABLE[(crc ^ byte) & (BYTE_VALUES - 1)] ?? 0) ^ (crc >>> BYTE_BITS), CRC_INITIAL) ^ CRC_INITIAL) >>> 0;
}

function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(UINT32_BYTES);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  parts.reduce((offset, part) => {
    out.set(part, offset);
    return offset + part.length;
  }, 0);
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typed = concat([new TextEncoder().encode(type), data]);
  return concat([uint32(data.length), typed, uint32(crc32(typed))]);
}

async function transform(data: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const output = new Blob([data]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(output).arrayBuffer());
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Array.from(atob(text), (ch) => ch.charCodeAt(0)));
}

/** テンプレートはパレット番号の並びを deflate したもの。何度も使うので 1 回だけ展開する */
const unpacked: { template: Promise<Uint8Array> | null; digits: Promise<Uint8Array> | null } = { template: null, digits: null };

function template(): Promise<Uint8Array> {
  unpacked.template ??= transform(fromBase64(TEMPLATE_DATA), new DecompressionStream("deflate"));
  return unpacked.template;
}

function digits(): Promise<Uint8Array> {
  unpacked.digits ??= transform(fromBase64(DIGITS_DATA), new DecompressionStream("deflate"));
  return unpacked.digits;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, index) => from + index);
}

/** 穴：中は市松模様、ふちは黒。重なった穴もそのまま上から描く */
function drawHole(pixels: Uint8Array, shot: Shot): void {
  const cx = PAPER.x + shot.x * PAPER.size;
  const cy = PAPER.y + shot.y * PAPER.size;
  const radius = shot.radius * PAPER.size;
  const inner = Math.max(0, radius - HOLE.rim);
  const top = Math.max(PAPER.y, Math.floor(cy - radius));
  const bottom = Math.min(PAPER.y + PAPER.size, Math.ceil(cy + radius));
  const left = Math.max(PAPER.x, Math.floor(cx - radius));
  const right = Math.min(PAPER.x + PAPER.size, Math.ceil(cx + radius));
  range(top, bottom).forEach((y) =>
    range(left, right).forEach((x) => {
      const distance = Math.hypot(x + PIXEL_CENTER - cx, y + PIXEL_CENTER - cy);
      if (distance > radius) return;
      const dark = (Math.floor((x - PAPER.x) / HOLE.checker) + Math.floor((y - PAPER.y) / HOLE.checker)) % CHECKER_PARITY;
      const fill = dark ? INDEX_CHECKER_DARK : INDEX_CHECKER_LIGHT;
      pixels.set([distance > inner ? INDEX_INK : fill], y * CARD_WIDTH + x);
    }),
  );
}

/** 何人目かの数字を 3 桁で置く。背景（コバルト）の画素は写さない */
function drawTurn(pixels: Uint8Array, sprite: Uint8Array, turnNumber: number): void {
  const text = String(Math.min(turnNumber, Number("9".repeat(DIGIT_COUNT)))).padStart(DIGIT_COUNT, "0");
  const spriteWidth = DIGIT.width * DIGIT_GLYPHS;
  Array.from(text).forEach((ch, position) => {
    const glyph = Number(ch);
    const left = DIGIT_SLOT.x + position * (DIGIT.width + DIGIT_SLOT.gap);
    range(0, DIGIT.height).forEach((y) =>
      range(0, DIGIT.width).forEach((x) => {
        const value = sprite[y * spriteWidth + glyph * DIGIT.width + x] ?? INDEX_COBALT;
        if (value !== INDEX_COBALT) pixels.set([value], (DIGIT_SLOT.y + y) * CARD_WIDTH + left + x);
      }),
    );
  });
}

async function encodePng(pixels: Uint8Array): Promise<Uint8Array> {
  const rowLength = CARD_WIDTH + 1;
  const raw = new Uint8Array(rowLength * CARD_HEIGHT);
  range(0, CARD_HEIGHT).forEach((y) => {
    raw.set([FILTER_NONE], y * rowLength);
    raw.set(pixels.subarray(y * CARD_WIDTH, (y + 1) * CARD_WIDTH), y * rowLength + 1);
  });
  const header = concat([uint32(CARD_WIDTH), uint32(CARD_HEIGHT), new Uint8Array([BIT_DEPTH, COLOR_TYPE_PALETTE, 0, 0, 0])]);
  if (header.length !== IHDR_LENGTH) throw new Error("bad IHDR");
  const palette = new Uint8Array(PALETTE.length * CHANNELS);
  PALETTE.forEach((color, index) => palette.set(color, index * CHANNELS));
  return concat([
    PNG_SIGNATURE,
    chunk("IHDR", header),
    chunk("PLTE", palette),
    chunk("IDAT", await transform(raw, new CompressionStream("deflate"))),
    chunk("IEND", new Uint8Array()),
  ]);
}

/** depth：撃たれた数。カードには次の挑戦者の番号（depth + 1）を出す */
export async function renderCard(depth: number, shots: readonly Shot[]): Promise<Uint8Array> {
  const pixels = Uint8Array.from(await template());
  shots.forEach((shot) => drawHole(pixels, shot));
  drawTurn(pixels, await digits(), depth + 1);
  return encodePng(pixels);
}
