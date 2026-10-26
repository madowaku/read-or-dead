import { randomId } from "./id";
import { normalizeAnswer } from "./normalize";
import type { Question } from "./types";

interface TextEntry {
  readonly text: string;
  readonly answer: string;
  readonly also?: readonly string[];
}

interface SilhouetteEntry {
  readonly file: string;
  readonly answer: string;
  readonly also: readonly string[];
}

// 文字問題は描かれた文字そのもの（漢字表記など）でも正解にする。
// text の "\n" は画像上の改行位置。正解判定と表示では取り除く。
const TEXT_ENTRIES: readonly TextEntry[] = [
  { text: "檸檬", answer: "れもん" },
  { text: "薔薇", answer: "ばら" },
  { text: "憂鬱", answer: "ゆううつ" },
  { text: "蒲公英", answer: "たんぽぽ" },
  { text: "胡瓜", answer: "きゅうり" },
  { text: "やきそば\nパン", answer: "やきそばぱん", also: ["焼きそばパン"] },
  { text: "ちゃぶ台\n返し", answer: "ちゃぶだいがえし" },
  { text: "ガラパゴス", answer: "がらぱごす" },
  { text: "SUSHI", answer: "すし", also: ["寿司", "鮨"] },
  { text: "東京\n特許\n許可局", answer: "とうきょうとっきょきょかきょく" },
];

// answer は終了後にそのまま表示するので、読みやすい表記にする
const SILHOUETTE_ENTRIES: readonly SilhouetteEntry[] = [
  { file: "rabbit", answer: "うさぎ", also: ["兎", "rabbit", "bunny"] },
  { file: "giraffe", answer: "キリン", also: ["麒麟", "giraffe", "ジラフ"] },
  { file: "elephant", answer: "ゾウ", also: ["象", "elephant"] },
  { file: "penguin", answer: "ペンギン", also: ["penguin"] },
  { file: "beetle", answer: "カブトムシ", also: ["兜虫", "甲虫", "カブト", "beetle"] },
  { file: "bicycle", answer: "自転車", also: ["じてんしゃ", "チャリ", "チャリンコ", "bicycle", "bike"] },
  { file: "helicopter", answer: "ヘリコプター", also: ["ヘリ", "helicopter"] },
  { file: "guitar", answer: "ギター", also: ["アコギ", "アコースティックギター", "guitar"] },
  { file: "whale", answer: "クジラ", also: ["鯨", "whale", "まっこうくじら", "ざとうくじら"] },
  { file: "snail", answer: "カタツムリ", also: ["蝸牛", "でんでんむし", "まいまい", "snail"] },
];

const LINE_BREAK = "\n";

function flatten(text: string): string {
  return text.split(LINE_BREAK).join("");
}

/** 終了後に見せる答え。文字問題で表記と読みが違えば「胡瓜（きゅうり）」のように併記する。 */
export function displayAnswer(question: Question): string {
  if (question.kind === "silhouette") return question.answer;
  const shown = flatten(question.source);
  return normalizeAnswer(shown) === normalizeAnswer(question.answer) ? shown : `${shown}（${question.answer}）`;
}

export const TEXT_QUESTIONS: readonly Question[] =TEXT_ENTRIES.map((entry, index) => ({
  key: `text-${index + 1}`,
  kind: "text",
  source: entry.text,
  answer: entry.answer,
  acceptedAnswers: [flatten(entry.text), ...(entry.also ?? [])],
}));

const FILE_NUMBER_DIGITS = 2;

// 公開されるキーと画像 URL から答えが分からないよう、番号で参照する。
// 画像は assets-src/silhouettes/<file>.png を番号順に public へ書き出したもの。
export const SILHOUETTE_QUESTIONS: readonly Question[] = SILHOUETTE_ENTRIES.map((entry, index) => ({
  key: `silhouette-${index + 1}`,
  kind: "silhouette",
  source: `${import.meta.env.BASE_URL}questions/silhouette/${String(index + 1).padStart(FILE_NUMBER_DIGITS, "0")}.png`,
  answer: entry.answer,
  acceptedAnswers: entry.also,
}));

export const ALL_QUESTIONS: readonly Question[] = [...TEXT_QUESTIONS, ...SILHOUETTE_QUESTIONS];

export function findQuestion(key: string): Question | undefined {
  return ALL_QUESTIONS.find((question) => question.key === key);
}

export function pickRandom(pool: readonly Question[], random: () => number = Math.random): Question {
  const question = pool[Math.floor(random() * pool.length)];
  if (!question) throw new RangeError("question pool is empty");
  return question;
}

/** 出題画面で作る自作問題。文字を描いて出題する。 */
export function customQuestion(text: string, answer: string, acceptedAnswers: readonly string[]): Question {
  return {
    key: `custom-${randomId()}`,
    kind: "custom",
    source: text,
    answer,
    acceptedAnswers: [text, ...acceptedAnswers],
  };
}
