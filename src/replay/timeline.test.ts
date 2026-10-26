import { describe, expect, it } from "vitest";
import type { Shot } from "../game/types";
import { HOLD_ORIGINAL_MS, HOLD_START_MS, STEP_MS, frameAt, replayDuration } from "./timeline";

const RADIUS = 0.08;
const SHOT_COUNT = 3;
const HALF = 0.5;

const SHOTS: readonly Shot[] = Array.from({ length: SHOT_COUNT }, (_, index) => ({
  chainId: "c",
  turnNumber: index + 1,
  x: index / SHOT_COUNT,
  y: HALF,
  radius: RADIUS,
  createdAt: index,
}));

describe("frameAt", () => {
  it("最初は全ショットが入った完成画像", () => {
    const frame = frameAt(SHOTS, 0);
    expect(frame.phase).toBe("damaged");
    expect(frame.shots).toEqual(SHOTS);
  });

  it("最後に撃った穴から順に塞ぐ", () => {
    const frame = frameAt(SHOTS, HOLD_START_MS + STEP_MS * HALF);
    expect(frame.phase).toBe("restoring");
    expect(frame.shots).toHaveLength(SHOT_COUNT);
    const closing = frame.shots[SHOT_COUNT - 1];
    expect(closing?.turnNumber).toBe(SHOT_COUNT);
    expect(closing?.radius).toBeLessThan(RADIUS);
    expect(frame.shots.slice(0, -1)).toEqual(SHOTS.slice(0, -1));
  });

  it("塞ぎ終わると穴のない元画像に戻る", () => {
    const frame = frameAt(SHOTS, HOLD_START_MS + STEP_MS * SHOT_COUNT);
    expect(frame.phase).toBe("original");
    expect(frame.shots).toHaveLength(0);
  });

  it("最後に問いかけを出す", () => {
    const end = replayDuration(SHOT_COUNT) - 1;
    expect(frameAt(SHOTS, end).phase).toBe("question");
    expect(frameAt(SHOTS, HOLD_START_MS + STEP_MS * SHOT_COUNT + HOLD_ORIGINAL_MS).phase).toBe("question");
  });

  it("ショットが 0 発でも破綻しない", () => {
    expect(frameAt([], HOLD_START_MS).phase).toBe("original");
  });
});
