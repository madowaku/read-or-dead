const ID_BYTES = 16;
const HEX_RADIX = 16;
const HEX_DIGITS_PER_BYTE = 2;

/** 推測困難なランダム ID（128bit、16 進表記） */
export function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_BYTES));
  return Array.from(bytes, (byte) => byte.toString(HEX_RADIX).padStart(HEX_DIGITS_PER_BYTE, "0")).join("");
}
