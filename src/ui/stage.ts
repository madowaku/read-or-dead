// 損傷した画像を表示する正方形の台。穴の向こうには市松模様が見える。

import { SOURCE_SIZE, drawDamaged } from "../game/render";
import type { Shot } from "../game/types";
import { h } from "./dom";

const PERCENT = 100;
const DIAMETER_PER_RADIUS = 2;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Stage {
  readonly element: HTMLElement;
  readonly canvas: HTMLCanvasElement;
}

export function createStage(source: HTMLCanvasElement, shots: readonly Shot[]): Stage {
  const canvas = h("canvas", { class: "stage-canvas", attrs: { width: String(SOURCE_SIZE), height: String(SOURCE_SIZE), "aria-label": "問題の画像" } });
  drawDamaged(canvas, source, shots);
  const element = h("div", { class: "stage" }, [canvas]);
  return { element, canvas };
}

/** 画面上のタップ位置を 0〜1 の正規化座標に変換する */
export function toNormalized(canvas: HTMLCanvasElement, clientX: number, clientY: number): Point {
  const rect = canvas.getBoundingClientRect();
  const clamp = (value: number): number => Math.min(1, Math.max(0, value));
  return { x: clamp((clientX - rect.left) / rect.width), y: clamp((clientY - rect.top) / rect.height) };
}

/** 照準。穴と同じ大きさの円を、正規化座標に合わせて重ねる。 */
export function createReticle(radius: number): HTMLElement {
  const size = `${radius * DIAMETER_PER_RADIUS * PERCENT}%`;
  return h("div", { class: "reticle", attrs: { style: `width:${size};height:${size}`, "aria-hidden": "true" } });
}

export function placeReticle(reticle: HTMLElement, point: Point): void {
  reticle.style.setProperty("left", `${point.x * PERCENT}%`);
  reticle.style.setProperty("top", `${point.y * PERCENT}%`);
  reticle.classList.add("is-placed");
}

/** 撃った直後の閃光。穴の位置に一瞬だけ出す。 */
export function flashAt(stage: HTMLElement, point: Point, radius: number): void {
  const size = `${radius * DIAMETER_PER_RADIUS * PERCENT}%`;
  const flash = h("div", {
    class: "muzzle-flash",
    attrs: { style: `left:${point.x * PERCENT}%;top:${point.y * PERCENT}%;width:${size};height:${size}`, "aria-hidden": "true" },
  });
  flash.addEventListener("animationend", () => flash.remove());
  stage.append(flash);
}
