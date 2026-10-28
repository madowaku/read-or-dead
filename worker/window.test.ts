import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { SqlRunner, SqlValue } from "./relay";
import { WindowCounter } from "./window";

const LIMIT = 3;
const WINDOW_MS = 60_000;
const START = 1_000;
const LATER = START + WINDOW_MS - 1;

function memorySql(): SqlRunner {
  const db = new DatabaseSync(":memory:");
  return {
    exec: (query: string, ...bindings: SqlValue[]) => {
      const params = bindings.map((value): SQLInputValue => (value instanceof ArrayBuffer ? new Uint8Array(value) : value));
      const rows = db.prepare(query).all(...params);
      return { toArray: (): Record<string, SqlValue>[] => rows.map((row): Record<string, SqlValue> => ({ ...row }) as Record<string, SqlValue>) };
    },
  };
}

describe("WindowCounter", () => {
  it("時間枠の中では上限まで。枠が変われば数え直す", () => {
    const counter = new WindowCounter(memorySql());
    const taken = Array.from({ length: LIMIT + 1 }, () => counter.take(LIMIT, WINDOW_MS, START));
    expect(taken).toEqual([true, true, true, false]);
    expect(counter.take(LIMIT, WINDOW_MS, LATER)).toBe(false);
    expect(counter.take(LIMIT, WINDOW_MS, START + WINDOW_MS)).toBe(true);
  });
});
