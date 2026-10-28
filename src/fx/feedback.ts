// ゲーム中の効果音と振動。音声ファイルは使わず、WebAudio でその場で合成する（通信量ゼロ・著作権の心配なし）。
// 合成そのものは synth.ts。共有動画の音声トラックも同じ合成を使う。
// AudioContext はユーザー操作の中でしか鳴らせないため、最初の操作で作る。

import sounds from "./sounds.json";
import { scheduleImpact, scheduleRecipe, scheduleShot, type Mixer, type RecipeName } from "./synth";

const MUTE_KEY = "read-or-dead:muted";
const VIBRATION = sounds.vibration;
const SHOT = sounds.shot;

const state: { ctx: AudioContext | null; muted: boolean } = { ctx: null, muted: readMuted() };

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch (err) {
    console.warn("readMuted failed", err);
    return false;
  }
}

export function isMuted(): boolean {
  return state.muted;
}

export function setMuted(muted: boolean): void {
  state.muted = muted;
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch (err) {
    console.warn("setMuted failed", err);
  }
}

function live(): Mixer | null {
  if (state.muted || typeof AudioContext === "undefined") return null;
  if (!state.ctx) state.ctx = new AudioContext();
  if (state.ctx.state === "suspended") void state.ctx.resume();
  return { ctx: state.ctx, out: state.ctx.destination };
}

function vibrate(pattern: number | readonly number[]): void {
  if (typeof navigator.vibrate !== "function") return;
  navigator.vibrate(typeof pattern === "number" ? pattern : [...pattern]);
}

function playRecipe(name: RecipeName): void {
  const mixer = live();
  if (mixer) scheduleRecipe(mixer, name, mixer.ctx.currentTime);
}

/** 発砲と着弾。power（0〜1）が大きいほど低く重く、長く震える。 */
export function playShot(power: number): void {
  const IMPACT_DELAY = 0.07;
  const mixer = live();
  if (mixer) {
    scheduleShot(mixer, mixer.ctx.currentTime, power);
    scheduleImpact(mixer, mixer.ctx.currentTime + IMPACT_DELAY, power);
  }
  vibrate([SHOT.vibrateBase + SHOT.vibratePower * power, SHOT.vibrateGap, SHOT.tailBase + SHOT.tailPower * power]);
}

/** 「わかった！」の早押し音 */
export function playBuzz(): void {
  playRecipe("buzz");
  vibrate(VIBRATION.buzz);
}

/** READY? の打ち込み音 */
export function playReady(): void {
  playRecipe("ready");
}

/** 正解・受け渡しのファンファーレ */
export function playPass(): void {
  playRecipe("pass");
}

/** 不正解・終了 */
export function playDead(): void {
  playRecipe("dead");
  vibrate(VIBRATION.dead);
}
