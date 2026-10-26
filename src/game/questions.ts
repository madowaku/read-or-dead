// 問題バンク。データは src/data/*.json に置き、ここで Question に変換する。
// 追加するときは JSON に 1 行足すだけでよい（シルエットは画像も public/questions/silhouette/ に置く）。

import kanjiData from "../data/kanji.json";
import silhouetteData from "../data/silhouettes.json";
import wordData from "../data/words.json";
import { seedFrom } from "../fx/random";
import { randomId } from "./id";
import { normalizeAnswer } from "./normalize";
import type { Question, QuestionKind } from "./types";

interface TextEntry {
  /** 画像に描く文字。"\n" は改行位置で、正解判定と表示では取り除く。 */
  readonly text: string;
  readonly answer: string;
  readonly also?: readonly string[];
}

interface SilhouetteEntry {
  /** 元画像の名前（assets-src/silhouettes で始まるフォルダの <file>.png）。公開名は並び順の番号。 */
  readonly file: string;
  /** 終了後にそのまま表示するので、読みやすい表記にする */
  readonly answer: string;
  readonly also?: readonly string[];
}

const LINE_BREAK = "\n";
const FILE_NUMBER_DIGITS = 2;
const KEY_RADIX = 36;

function flatten(text: string): string {
  return text.split(LINE_BREAK).join("");
}

/** 公開されるキーから答えが分からないよう、表示テキストのハッシュで作る */
function textKey(kind: QuestionKind, text: string): string {
  return `${kind}-${seedFrom(text).toString(KEY_RADIX)}`;
}

function fromText(kind: QuestionKind, entry: TextEntry): Question {
  return {
    key: textKey(kind, entry.text),
    kind,
    source: entry.text,
    answer: entry.answer,
    acceptedAnswers: [flatten(entry.text), ...(entry.also ?? [])],
  };
}

/** 終了後に見せる答え。文字問題で表記と読みが違えば「胡瓜（きゅうり）」のように併記する。 */
export function displayAnswer(question: Question): string {
  if (question.kind === "silhouette") return question.answer;
  const shown = flatten(question.source);
  return normalizeAnswer(shown) === normalizeAnswer(question.answer) ? shown : `${shown}（${question.answer}）`;
}

const KANJI: readonly TextEntry[] = kanjiData;
const WORDS: readonly TextEntry[] = wordData;
const SILHOUETTES: readonly SilhouetteEntry[] = silhouetteData;

/** 漢字・熟語・難読 */
export const KANJI_QUESTIONS: readonly Question[] = KANJI.map((entry) => fromText("kanji", entry));
/** 日常のことば・カタカナ・英語・ことわざ・短文 */
export const WORD_QUESTIONS: readonly Question[] = WORDS.map((entry) => fromText("word", entry));
/** シルエット・ピクトグラム。キーと画像 URL は番号にして答えを隠す。 */
export const SILHOUETTE_QUESTIONS: readonly Question[] = SILHOUETTES.map((entry, index) => ({
  key: `silhouette-${index + 1}`,
  kind: "silhouette",
  source: `${import.meta.env.BASE_URL}questions/silhouette/${String(index + 1).padStart(FILE_NUMBER_DIGITS, "0")}.png`,
  answer: entry.answer,
  acceptedAnswers: entry.also ?? [],
}));

export const ALL_QUESTIONS: readonly Question[] = [...KANJI_QUESTIONS, ...WORD_QUESTIONS, ...SILHOUETTE_QUESTIONS];

export function findQuestion(key: string): Question | undefined {
  return ALL_QUESTIONS.find((question) => question.key === key);
}

/** 遊んだことのない問題から選ぶ。全部遊んだら全体から選び直す。 */
export function pickFresh(pool: readonly Question[], played: ReadonlySet<string>, random: () => number = Math.random): Question {
  const fresh = pool.filter((question) => !played.has(question.key));
  const candidates = fresh.length ? fresh : pool;
  const question = candidates[Math.floor(random() * candidates.length)];
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
    acceptedAnswers: [flatten(text), ...acceptedAnswers],
  };
}
