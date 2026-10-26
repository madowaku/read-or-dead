import { describe, expect, it } from "vitest";
import { isCorrect } from "./normalize";
import { ALL_QUESTIONS, KANJI_QUESTIONS, SILHOUETTE_QUESTIONS, WORD_QUESTIONS, customQuestion, displayAnswer, pickFresh } from "./questions";

const KANJI_COUNT = 150;
const WORD_COUNT = 100;
const SILHOUETTE_COUNT = 50;

describe("問題バンク", () => {
  it("漢字150・ことば100・シルエット50の計300問", () => {
    expect(KANJI_QUESTIONS).toHaveLength(KANJI_COUNT);
    expect(WORD_QUESTIONS).toHaveLength(WORD_COUNT);
    expect(SILHOUETTE_QUESTIONS).toHaveLength(SILHOUETTE_COUNT);
  });

  it("キーが重複しない", () => {
    expect(new Set(ALL_QUESTIONS.map((question) => question.key)).size).toBe(ALL_QUESTIONS.length);
  });

  it("遊んだ問題は全部遊ぶまで出ない", () => {
    const [first, ...rest] = SILHOUETTE_QUESTIONS;
    const played = new Set(rest.map((question) => question.key));
    expect(first && pickFresh(SILHOUETTE_QUESTIONS, played)).toBe(first);
    expect(SILHOUETTE_QUESTIONS).toContain(pickFresh(SILHOUETTE_QUESTIONS, new Set(ALL_QUESTIONS.map((question) => question.key))));
  });

  it("キーと画像 URL から答えが分からない", () => {
    SILHOUETTE_QUESTIONS.forEach((question) => {
      const visible = `${question.key} ${question.source}`;
      [question.answer, ...question.acceptedAnswers].forEach((answer) => expect(visible).not.toContain(answer));
    });
  });

  it("文字問題は描かれた表記でも読みでも正解", () => {
    [...KANJI_QUESTIONS, ...WORD_QUESTIONS].forEach((question) => {
      expect(isCorrect(question.answer, question.answer, question.acceptedAnswers)).toBe(true);
      expect(isCorrect(question.source.split("\n").join(""), question.answer, question.acceptedAnswers)).toBe(true);
    });
  });
});

describe("displayAnswer", () => {
  it("表記と読みが違えば併記する", () => {
    const lemon = KANJI_QUESTIONS.find((question) => question.source === "檸檬");
    expect(lemon && displayAnswer(lemon)).toBe("檸檬（れもん）");
  });

  it("表記と読みが同じなら表記だけ", () => {
    expect(displayAnswer(customQuestion("ガラパゴス", "がらぱごす", []))).toBe("ガラパゴス");
  });
});
