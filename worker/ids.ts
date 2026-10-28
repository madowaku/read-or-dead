// サーバーで作る ID とハッシュ

import { BASE62 } from "../src/online/protocol";

const TOKEN_BYTES = 16;
const HEX_RADIX = 16;
const HEX_DIGITS_PER_BYTE = 2;
/** 1 バイトで表せる値の数 */
const BYTE_VALUES = 256;

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(HEX_RADIX).padStart(HEX_DIGITS_PER_BYTE, "0")).join("");
}

/** 推測困難なランダム値（128bit、16 進表記） */
export function randomHex(): string {
  return hex(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

/** URL に入れる短い ID。256 は 62 で割り切れないので、偏りが出ないよう 248 以上は捨てる */
export function randomBase62(length: number): string {
  const usable = Math.floor(BYTE_VALUES / BASE62.length) * BASE62.length;
  const picked = Array.from(crypto.getRandomValues(new Uint8Array(length * HEX_DIGITS_PER_BYTE)))
    .filter((byte) => byte < usable)
    .map((byte) => BASE62[byte % BASE62.length] ?? "");
  if (picked.length < length) return randomBase62(length);
  return picked.slice(0, length).join("");
}

/** トークンや端末 ID はハッシュにして保存する */
export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return hex(new Uint8Array(digest));
}
