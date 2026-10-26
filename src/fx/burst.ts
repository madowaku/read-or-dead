// 着弾の瞬間の閃光・衝撃波・飛び散る破片。
// 経過時間だけで絵が決まる純粋な描画なので、画面上の演出にも共有動画のフレームにも使える。

import { COLOR } from "../theme";
import fx from "./fx.json";
import { seededRandom } from "./random";

const TUNING = fx.burst;
export const BURST_MS = TUNING.durationMs;

const MS_PER_SECOND = 1000;
const HALF = 0.5;
const TRIANGLE_POINTS = 3;
const FULL_TURN = Math.PI + Math.PI;
const SHARD_SKEW = 0.6;

type ShardTone = "ink" | "paper" | "spark";

interface Shard {
  readonly angle: number;
  readonly speed: number;
  readonly size: number;
  readonly spin: number;
  readonly tone: ShardTone;
}

/** 座標と半径は画像に対する正規化値 */
export interface Burst {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly shards: readonly Shard[];
}

/** 描く先の画像の位置（キャンバスのピクセル座標） */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly size: number;
}

const TONE_COLOR: Readonly<Record<ShardTone, string>> = {
  ink: COLOR.ink,
  paper: COLOR.paper,
  spark: COLOR.pink,
};

function between(random: () => number, min: number, max: number): number {
  return min + (max - min) * random();
}

function toneFor(roll: number): ShardTone {
  if (roll < TUNING.toneInk) return "ink";
  if (roll < TUNING.toneSpark) return "paper";
  return "spark";
}

export function createBurst(x: number, y: number, radius: number, seed: number): Burst {
  const random = seededRandom(seed);
  const count = Math.round(TUNING.shardBase + TUNING.shardPerRadius * radius);
  const shards = Array.from({ length: count }, (): Shard => {
    const tone = toneFor(random());
    return {
      angle: random() * FULL_TURN,
      // 大きな弾ほど破片も遠くへ飛ぶ
      speed: between(random, TUNING.speedMin, TUNING.speedMax) * (radius / TUNING.referenceRadius),
      size: between(random, TUNING.sizeMin, TUNING.sizeMax),
      spin: between(random, -TUNING.spinMax, TUNING.spinMax),
      tone,
    };
  });
  return { x, y, radius, shards };
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas is not supported");
  return ctx;
}

/** elapsedMs 時点の演出を canvas に重ねて描く。BURST_MS を過ぎたら何も描かない。 */
export function drawBurst(canvas: HTMLCanvasElement, burst: Burst, elapsedMs: number, box: Box): void {
  if (elapsedMs < 0 || elapsedMs > BURST_MS) return;
  const ctx = context2d(canvas);
  const progress = elapsedMs / BURST_MS;
  const seconds = elapsedMs / MS_PER_SECOND;
  const cx = box.left + burst.x * box.size;
  const cy = box.top + burst.y * box.size;
  const radius = burst.radius * box.size;

  ctx.save();
  // 閃光
  if (progress < TUNING.flashPortion) {
    const flash = 1 - progress / TUNING.flashPortion;
    ctx.globalAlpha = flash;
    ctx.fillStyle = COLOR.paper;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * (1 + (TUNING.flashScale - 1) * (1 - flash)), 0, FULL_TURN);
    ctx.fill();
  }

  // 衝撃波（ピンクと白の 2 重）
  [0, TUNING.ringDelay].forEach((delay, index) => {
    const local = (progress - delay) / (1 - delay);
    if (local <= 0 || local >= 1) return;
    ctx.globalAlpha = 1 - local;
    ctx.strokeStyle = index ? COLOR.paper : COLOR.pink;
    ctx.lineWidth = TUNING.ringWidth * box.size * (1 - local);
    ctx.beginPath();
    ctx.arc(cx, cy, radius * (1 + TUNING.ringGrowth * local), 0, FULL_TURN);
    ctx.stroke();
  });

  // 破片
  ctx.globalAlpha = Math.min(1, (1 - progress) / HALF);
  burst.shards.forEach((shard) => {
    const distance = shard.speed * seconds * box.size;
    const sx = cx + Math.cos(shard.angle) * (radius + distance);
    const sy = cy + Math.sin(shard.angle) * (radius + distance) + TUNING.gravity * seconds * seconds * HALF * box.size;
    const size = shard.size * box.size;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(shard.spin * seconds);
    ctx.fillStyle = TONE_COLOR[shard.tone];
    ctx.beginPath();
    Array.from({ length: TRIANGLE_POINTS }, (_, point) => (point / TRIANGLE_POINTS) * FULL_TURN).forEach((theta, point) => {
      const reach = point ? size * SHARD_SKEW : size;
      const px = Math.cos(theta) * reach;
      const py = Math.sin(theta) * reach;
      if (point) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    });
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });
  ctx.restore();
}
