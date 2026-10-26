// 再現できる乱数。同じ種なら同じ破片が飛ぶので、画面の演出と共有動画が一致する。

/** mulberry32 の定数 */
const INCREMENT = 0x6d2b79f5;
const SHIFT_A = 15;
const SHIFT_B = 7;
const SHIFT_C = 14;
const MIX = 61;
const UINT32_RANGE = 4294967296;

export function seededRandom(seed: number): () => number {
  const state = { value: seed >>> 0 };
  return (): number => {
    state.value = (state.value + INCREMENT) >>> 0;
    const a = Math.imul(state.value ^ (state.value >>> SHIFT_A), state.value | 1);
    const b = (a + Math.imul(a ^ (a >>> SHIFT_B), a | MIX)) ^ a;
    return ((b ^ (b >>> SHIFT_C)) >>> 0) / UINT32_RANGE;
  };
}

/** 文字列から種を作る（チェーン ID とターン番号など） */
export function seedFrom(text: string): number {
  const FNV_OFFSET = 2166136261;
  const FNV_PRIME = 16777619;
  return Array.from(text).reduce((hash, ch) => Math.imul(hash ^ ch.charCodeAt(0), FNV_PRIME) >>> 0, FNV_OFFSET);
}
