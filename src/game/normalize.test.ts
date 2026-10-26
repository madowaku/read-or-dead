import { describe, expect, it } from "vitest";
import { isCorrect, normalizeAnswer } from "./normalize";

describe("normalizeAnswer", () => {
  it("カタカナをひらがなにそろえる", () => {
    expect(normalizeAnswer("ペンギン")).toBe("ぺんぎん");
  });

  it("半角カナ・全角英数・大文字を吸収する", () => {
    expect(normalizeAnswer("ﾍﾟﾝｷﾞﾝ")).toBe("ぺんぎん");
    expect(normalizeAnswer("ＳＵＳＨＩ")).toBe("sushi");
  });

  it("空白・記号を無視し、長音は残す", () => {
    expect(normalizeAnswer(" 「ギター」！ ")).toBe("ぎたー");
  });
});

describe("isCorrect", () => {
  it("答えと別解のどちらでも正解", () => {
    expect(isCorrect("ウサギ", "うさぎ", ["兎"])).toBe(true);
    expect(isCorrect("兎", "うさぎ", ["兎"])).toBe(true);
  });

  it("空入力や別の言葉は不正解", () => {
    expect(isCorrect("", "うさぎ", [])).toBe(false);
    expect(isCorrect("　", "うさぎ", [])).toBe(false);
    expect(isCorrect("うさ", "うさぎ", [])).toBe(false);
  });
});
