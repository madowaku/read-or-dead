// 揺れる照準。指でなぞった位置を狙うが、照準はその周りを小さく漂う。
// 動かした直後は大きく揺れ、落ち着くまで待つほど正確になる（急いで撃つと外れる）。

import fx from "../fx/fx.json";
import { placeReticle, toNormalized, type Point } from "./stage";

const TUNING = fx.aim;
const HALF = 0.5;
const CENTER: Point = { x: HALF, y: HALF };

export interface AimController {
  /** 今この瞬間の照準の位置（揺れを含む） */
  readonly current: () => Point;
  readonly stop: () => void;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** 2 つの正弦波を混ぜた、規則的に見えにくい揺れ（-1〜1） */
function wave(t: number, slow: number, fast: number): number {
  return (Math.sin(t * slow) + TUNING.mixSecond * Math.sin(t * fast)) / (1 + TUNING.mixSecond);
}

export function startAim(stage: HTMLElement, canvas: HTMLCanvasElement, reticle: HTMLElement, onAim: () => void): AimController {
  const state = { target: CENTER, position: CENTER, movedAt: performance.now(), frameId: 0, pressed: false };

  const moveTo = (event: PointerEvent): void => {
    state.target = toNormalized(canvas, event.clientX, event.clientY);
    state.movedAt = performance.now();
    onAim();
  };
  const onDown = (event: PointerEvent): void => {
    state.pressed = true;
    stage.setPointerCapture(event.pointerId);
    moveTo(event);
  };
  const onMove = (event: PointerEvent): void => {
    if (state.pressed) moveTo(event);
  };
  const onUp = (): void => {
    state.pressed = false;
  };
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);

  const tick = (now: number): void => {
    const settle = Math.max(0, 1 - (now - state.movedAt) / TUNING.settleMs);
    const amplitude = TUNING.baseAmplitude + TUNING.moveAmplitude * settle;
    state.position = {
      x: clampUnit(state.target.x + amplitude * wave(now, TUNING.freqX1, TUNING.freqX2)),
      y: clampUnit(state.target.y + amplitude * wave(now, TUNING.freqY1, TUNING.freqY2)),
    };
    placeReticle(reticle, state.position);
    state.frameId = requestAnimationFrame(tick);
  };
  state.frameId = requestAnimationFrame(tick);

  return {
    current: (): Point => state.position,
    stop: (): void => {
      cancelAnimationFrame(state.frameId);
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
    },
  };
}
