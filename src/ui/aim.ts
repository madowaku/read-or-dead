// 横→縦の 2 回タップ照準。
// 1 回目：左右に往復する縦線をタップで止めて横位置を決める。
// 2 回目：上下に往復する横線をタップで止めると、その交点に発射する。
// 画面のどこをタップしてもよい（スペース / Enter でも可）。

import { LOCK_GUARD_MS, sweepPosition, traverseMsFor } from "../game/sweep";
import { h } from "./dom";
import { placeReticle, type Point } from "./stage";

const PERCENT = 100;

export type AimStep = "x" | "y" | "done";

export interface AimController {
  readonly stop: () => void;
}

export interface AimOptions {
  /** タップを受け付ける範囲（ふつうは画面全体） */
  readonly tapArea: HTMLElement;
  /** 照準の線を重ねる画像の台 */
  readonly stage: HTMLElement;
  readonly reticle: HTMLElement;
  readonly radius: number;
  /** 手順が進むたびに呼ばれる（案内文の切り替え用） */
  readonly onStep: (step: AimStep) => void;
  /** 2 回目のタップで呼ばれる */
  readonly onFire: (point: Point) => void;
  readonly random?: () => number;
}

export function startSweepAim(options: AimOptions): AimController {
  const random = options.random ?? Math.random;
  const traverseMs = traverseMsFor(options.radius);
  const lineX = h("div", { class: "sweep-line sweep-line-x", attrs: { "aria-hidden": "true" } });
  const lineY = h("div", { class: "sweep-line sweep-line-y", attrs: { "aria-hidden": "true" } });
  options.stage.append(lineX, lineY);

  const state = {
    step: "x" as AimStep,
    startedAt: performance.now(),
    // 毎回同じ位置から動くと覚えられてしまうので、動き出す位置をずらす
    startAt: random(),
    x: 0,
    y: 0,
    lockedAt: 0,
    frameId: 0,
  };

  const render = (now: number): void => {
    const position = sweepPosition(now - state.startedAt, traverseMs, state.startAt);
    if (state.step === "x") state.x = position;
    if (state.step === "y") state.y = position;
    lineX.style.setProperty("left", `${state.x * PERCENT}%`);
    lineY.style.setProperty("top", `${state.y * PERCENT}%`);
    lineY.classList.toggle("is-active", state.step !== "x");
    lineX.classList.toggle("is-locked", state.step !== "x");
    if (state.step !== "x") placeReticle(options.reticle, { x: state.x, y: state.y });
    if (state.step !== "done") state.frameId = requestAnimationFrame(render);
  };

  const lock = (): void => {
    const now = performance.now();
    if (state.step === "done" || now - state.lockedAt < LOCK_GUARD_MS) return;
    render(now);
    state.lockedAt = now;
    if (state.step === "x") {
      state.step = "y";
      state.startedAt = now;
      state.startAt = random();
      options.onStep("y");
      return;
    }
    state.step = "done";
    cancelAnimationFrame(state.frameId);
    options.onStep("done");
    options.onFire({ x: state.x, y: state.y });
  };

  const onPointer = (event: PointerEvent): void => {
    // ボタンやリンクの操作は照準のタップとして扱わない
    if (event.target instanceof Element && event.target.closest("button, a")) return;
    event.preventDefault();
    lock();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    lock();
  };
  options.tapArea.addEventListener("pointerdown", onPointer);
  window.addEventListener("keydown", onKey);
  options.onStep("x");
  state.frameId = requestAnimationFrame(render);

  return {
    stop: (): void => {
      cancelAnimationFrame(state.frameId);
      options.tapArea.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
      lineX.remove();
      lineY.remove();
    },
  };
}
