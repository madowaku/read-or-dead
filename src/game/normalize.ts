// 回答の正規化。表記ゆれ（ひらがな／カタカナ、全角／半角、大文字／小文字、空白や記号）を吸収する。

/** カタカナとひらがなのコードポイント差（"ア" U+30A2 → "あ" U+3042） */
const KATAKANA_TO_HIRAGANA_OFFSET = 0x60;

// 判定に関係ない空白・句読点・括弧・ダッシュ類。"「ねこ」！" → "ねこ"; "ねこ" は変化なし。
// https://regex101.com/?flavor=javascript&regex=%5B%5Cs%5Cu3000%E3%83%BB%EF%BD%A5%E3%80%81%E3%80%82%2C.!%EF%BC%81%3F%EF%BC%9F%E3%80%8C%E3%80%8D%E3%80%8E%E3%80%8F%EF%BC%88%EF%BC%89()%E3%80%90%E3%80%91%5C%5B%5C%5D%E3%80%9C~%5C-%E2%80%90%EF%BC%8D%E2%80%95_'%22%E2%80%99%E2%80%9D%E2%80%9C%5D&flags=g&testString=%E3%80%8C%E3%81%AD%E3%81%93%E3%80%8D%EF%BC%81%0A%E3%81%AD%E3%81%93
const IGNORED = /[\s　・･、。,.!！?？「」『』（）()【】\[\]〜~\-‐－―_'"’”“]/g;

// 全角カタカナ1文字（ァ〜ヶ）。"ネコ" → "ねこ"; "ねこ" や長音 "ー" には一致しない。
// https://regex101.com/?flavor=javascript&regex=%5B%5Cu30a1-%5Cu30f6%5D&flags=g&testString=%E3%83%8D%E3%82%B3%0A%E3%81%AD%E3%81%93%0A%E3%83%BC
const KATAKANA = /[ァ-ヶ]/g;

function katakanaToHiragana(text: string): string {
  return text.replace(KATAKANA, (ch) => String.fromCharCode(ch.charCodeAt(0) - KATAKANA_TO_HIRAGANA_OFFSET));
}

export function normalizeAnswer(raw: string): string {
  return katakanaToHiragana(raw.normalize("NFKC").toLowerCase()).replace(IGNORED, "");
}

export function isCorrect(input: string, answer: string, acceptedAnswers: readonly string[]): boolean {
  const normalized = normalizeAnswer(input);
  if (!normalized) return false;
  return [answer, ...acceptedAnswers].some((candidate) => normalizeAnswer(candidate) === normalized);
}
