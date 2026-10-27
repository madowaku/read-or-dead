import { describe, expect, it } from "vitest";
import { MAX_RADIUS, MIN_RADIUS } from "./power";
import { sweepPosition, traverseMsFor } from "./sweep";

const TRAVERSE = 1000;
const QUARTER = 250;
const HALF = 0.5;
const THREE_QUARTERS = 750;
const ONE_AND_HALF = 1500;
const SAMPLES = 200;
const SAMPLE_STEP_MS = 37;

describe("sweepPosition", () => {
  it("端から端へ一定の速さで進み、端で跳ね返る", () => {
    expect(sweepPosition(0, TRAVERSE)).toBe(0);
    expect(sweepPosition(QUARTER, TRAVERSE)).toBeCloseTo(QUARTER / TRAVERSE);
    expect(sweepPosition(TRAVERSE, TRAVERSE)).toBe(1);
    expect(sweepPosition(ONE_AND_HALF, TRAVERSE)).toBeCloseTo(HALF);
    expect(sweepPosition(TRAVERSE + TRAVERSE, TRAVERSE)).toBeCloseTo(0);
  });

  it("どの時刻でも 0〜1 の範囲に収まる", () => {
    Array.from({ length: SAMPLES }, (_, index) => index * SAMPLE_STEP_MS).forEach((time) => {
      const position = sweepPosition(time, TRAVERSE, HALF);
      expect(position).toBeGreaterThanOrEqual(0);
      expect(position).toBeLessThanOrEqual(1);
    });
  });

  it("開始位置を指定できる", () => {
    expect(sweepPosition(0, TRAVERSE, HALF)).toBeCloseTo(HALF);
    expect(sweepPosition(THREE_QUARTERS, TRAVERSE, HALF)).toBeCloseTo(THREE_QUARTERS / TRAVERSE);
  });
});

describe("traverseMsFor", () => {
  it("大きい弾ほど速く動く", () => {
    expect(traverseMsFor(MAX_RADIUS)).toBeLessThan(traverseMsFor(MIN_RADIUS));
  });
});
