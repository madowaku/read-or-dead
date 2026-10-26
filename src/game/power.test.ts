import { describe, expect, it } from "vitest";
import { MAX_RADIUS, MIN_RADIUS, SLOW_LIMIT_MS, radiusFor, rankOf } from "./power";

const QUICK_MS = 4_000;
const EXPECTED_AT_QUICK = 0.104;
const PRECISION = 3;
const HALF = 0.5;

describe("radiusFor", () => {
  it("0 秒で最大、制限時間以降は最小", () => {
    expect(radiusFor(0)).toBe(MAX_RADIUS);
    expect(radiusFor(SLOW_LIMIT_MS)).toBe(MIN_RADIUS);
    expect(radiusFor(SLOW_LIMIT_MS + SLOW_LIMIT_MS)).toBe(MIN_RADIUS);
  });

  it("4 秒ならおよそ 10%", () => {
    expect(radiusFor(QUICK_MS)).toBeCloseTo(EXPECTED_AT_QUICK, PRECISION);
  });

  it("速いほど格が上", () => {
    expect(rankOf(radiusFor(0))).toBe("power");
    expect(rankOf(radiusFor(SLOW_LIMIT_MS * HALF))).toBe("normal");
    expect(rankOf(radiusFor(SLOW_LIMIT_MS))).toBe("weak");
  });
});
