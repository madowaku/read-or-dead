import { describe, expect, it } from "vitest";
import { isCorrect } from "./normalize";
import { SILHOUETTE_QUESTIONS, TEXT_QUESTIONS, customQuestion, displayAnswer } from "./questions";

const QUESTIONS_PER_KIND = 10;

describe("問題バンク", () => {
  it("文字・シルエットが各10問ある", () => {
    expect(TEXT_QUESTIONS).toHaveLength(QUESTIONS_PER_KIND);
    expect(SILHOUETTE_QUESTIONS).toHaveLength(QUESTIONS_PER_KIND);
  });

  it("キーと画像 URL から答えが分からない", () => {
    SILHOUETTE_QUESTIONS.forEach((question) => {
      const visible = `${question.key} ${question.source}`;
      [question.answer, ...question.acceptedAnswers].forEach((answer) => expect(visible).not.toContain(answer));
    });
  });

  it("文字問題は描かれた表記でも読みでも正解", () => {
    TEXT_QUESTIONS.forEach((question) => {
      expect(isCorrect(question.answer, question.answer, question.acceptedAnswers)).toBe(true);
      expect(isCorrect(question.source.split("\n").join(""), question.answer, question.acceptedAnswers)).toBe(true);
    });
  });
});

describe("displayAnswer", () => {
  it("表記と読みが違えば併記する", () => {
    const lemon = TEXT_QUESTIONS.find((question) => question.source === "檸檬");
    expect(lemon && displayAnswer(lemon)).toBe("檸檬（れもん）");
  });

  it("表記と読みが同じなら表記だけ", () => {
    expect(displayAnswer(customQuestion("ガラパゴス", "がらぱごす", []))).toBe("ガラパゴス");
  });
});
