import { describe, expect, it } from "vitest";
import type { Shot } from "../game/types";
import { CARD_AT, FLASH_MS, IMPACT_AT, SHOT_CLIP_MS, clipFrameAt, clipSoundCues } from "./clip";

const FPS = 24;
const MS_PER_SECOND = 1000;
const FRAME_MS = MS_PER_SECOND / FPS;
const BIG = 0.12;
const SMALL = 0.06;
const EPSILON = 1;

function shotAt(turnNumber: number, x: number, y: number, radius: number): Shot {
  return { chainId: "c", turnNumber, x, y, radius, createdAt: turnNumber };
}

const LEFT = 0.2;
const TOP = 0.3;
const RIGHT = 0.7;
const BOTTOM = 0.6;
const AIM_X = 0.4;
const AIM_Y = 0.45;
const SECOND_TURN = 2;
const THIRD_TURN = 3;

const BEFORE: readonly Shot[] = [shotAt(1, LEFT, TOP, SMALL), shotAt(SECOND_TURN, RIGHT, BOTTOM, SMALL)];
const SHOT = shotAt(THIRD_TURN, AIM_X, AIM_Y, BIG);
const AFTER: readonly Shot[] = [...BEFORE, SHOT];

/** 書き出す全フレームの時刻 + 境目の直前・直後 */
const TIMES: readonly number[] = [
  ...Array.from({ length: Math.ceil(SHOT_CLIP_MS / FRAME_MS) + 1 }, (_, index) => index * FRAME_MS),
  IMPACT_AT - EPSILON,
  IMPACT_AT,
  IMPACT_AT + EPSILON,
  CARD_AT,
  SHOT_CLIP_MS,
];

describe("clipFrameAt（共有用 1 発クリップ）", () => {
  it("どのフレームも撃った後の全弾痕を描き、最後の 1 発も最初から最大の半径", () => {
    TIMES.forEach((time) => expect(clipFrameAt(BEFORE, SHOT, time).shots).toEqual(AFTER));
  });

  it("先頭・着弾直前・着弾直後・最終フレームでも射撃前の状態にならない", () => {
    [0, IMPACT_AT - EPSILON, IMPACT_AT + EPSILON, SHOT_CLIP_MS].forEach((time) => {
      const frame = clipFrameAt(BEFORE, SHOT, time);
      expect(frame.shots).toContain(SHOT);
      expect(frame.shots.find((shot) => shot.turnNumber === SHOT.turnNumber)?.radius).toBe(BIG);
    });
  });

  it("照準は着弾前だけ出て、着弾の瞬間に着弾点へ届く", () => {
    expect(clipFrameAt(BEFORE, SHOT, 0).reticle).not.toBeNull();
    const last = clipFrameAt(BEFORE, SHOT, IMPACT_AT - EPSILON).reticle;
    expect(last?.x).toBeCloseTo(SHOT.x);
    expect(last?.y).toBeCloseTo(SHOT.y);
    expect(clipFrameAt(BEFORE, SHOT, IMPACT_AT).reticle).toBeNull();
  });

  it("着弾はフラッシュで見せ、すぐ消える", () => {
    expect(clipFrameAt(BEFORE, SHOT, IMPACT_AT - EPSILON).flash).toBe(0);
    expect(clipFrameAt(BEFORE, SHOT, IMPACT_AT).flash).toBe(1);
    expect(clipFrameAt(BEFORE, SHOT, IMPACT_AT + FLASH_MS).flash).toBe(0);
  });

  it("締めのカードは CARD_AT から出る", () => {
    expect(clipFrameAt(BEFORE, SHOT, CARD_AT - EPSILON).card).toBe(0);
    expect(clipFrameAt(BEFORE, SHOT, SHOT_CLIP_MS).card).toBe(1);
  });

  it("1 発目のクリップ（撃つ前は無傷）でも無傷の画像を出さない", () => {
    TIMES.forEach((time) => expect(clipFrameAt([], SHOT, time).shots).toEqual([SHOT]));
  });
});

describe("clipSoundCues", () => {
  it("発砲は着弾フレームと同時、締めはカードと同時", () => {
    const cues = clipSoundCues(1);
    expect(cues.find((cue) => cue.kind === "shot")?.atMs).toBe(IMPACT_AT);
    expect(cues.find((cue) => cue.kind === "finale")?.atMs).toBe(CARD_AT);
    cues.forEach((cue) => expect(cue.atMs).toBeLessThan(SHOT_CLIP_MS));
  });
});
