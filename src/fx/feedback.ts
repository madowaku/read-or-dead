// 効果音と振動。音声ファイルは使わず、WebAudio でその場で合成する（通信量ゼロ・著作権の心配なし）。
// AudioContext はユーザー操作の中でしか鳴らせないため、最初の操作で作る。

import sounds from "./sounds.json";

const MUTE_KEY = "read-or-dead:muted";
const MASTER_GAIN = 0.55;
const SILENT = 0.0001;
/** 乱数 0〜1 を -1〜1 に広げる幅 */
const NOISE_SPAN = 2;

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

function audio(): AudioContext | null {
  if (state.muted || typeof AudioContext === "undefined") return null;
  if (!state.ctx) state.ctx = new AudioContext();
  if (state.ctx.state === "suspended") void state.ctx.resume();
  return state.ctx;
}

function vibrate(pattern: number | readonly number[]): void {
  if (typeof navigator.vibrate !== "function") return;
  navigator.vibrate(typeof pattern === "number" ? pattern : [...pattern]);
}

/** 白色雑音のバッファ。発砲音の「パン」に使う。 */
function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  data.forEach((_, index) => {
    data[index] = Math.random() * NOISE_SPAN - 1;
  });
  return buffer;
}

interface ToneSpec {
  readonly type: OscillatorType;
  readonly from: number;
  readonly to: number;
  readonly peak: number;
  readonly decay: number;
  readonly delay: number;
}

const OSCILLATOR_TYPES: readonly OscillatorType[] = ["sine", "square", "sawtooth", "triangle"];

/** 音色の設計図（周波数は Hz、時間は秒）と振動パターン（ミリ秒）。数値の調整は sounds.json で行う。 */
const RECIPES: Readonly<Record<"buzz" | "ready" | "pass" | "dead", readonly ToneSpec[]>> = {
  buzz: sounds.recipes.buzz.map(toToneSpec),
  ready: sounds.recipes.ready.map(toToneSpec),
  pass: sounds.recipes.pass.map(toToneSpec),
  dead: sounds.recipes.dead.map(toToneSpec),
};
const VIBRATION = sounds.vibration;
const SHOT = sounds.shot;

function toToneSpec(raw: Omit<ToneSpec, "type"> & { readonly type: string }): ToneSpec {
  const type = OSCILLATOR_TYPES.find((candidate) => candidate === raw.type);
  if (!type) throw new TypeError(`unknown oscillator type: ${raw.type}`);
  return { ...raw, type };
}

function envelope(ctx: AudioContext, peak: number, attack: number, decay: number, delay: number): GainNode {
  const gain = ctx.createGain();
  const start = ctx.currentTime + delay;
  gain.gain.setValueAtTime(SILENT, ctx.currentTime);
  gain.gain.setValueAtTime(SILENT, start);
  gain.gain.exponentialRampToValueAtTime(peak * MASTER_GAIN, start + attack);
  gain.gain.exponentialRampToValueAtTime(SILENT, start + attack + decay);
  gain.connect(ctx.destination);
  return gain;
}

const TONE_ATTACK = 0.005;

function tone(ctx: AudioContext, spec: ToneSpec): void {
  const osc = ctx.createOscillator();
  const start = ctx.currentTime + spec.delay;
  osc.type = spec.type;
  osc.frequency.setValueAtTime(spec.from, start);
  osc.frequency.exponentialRampToValueAtTime(spec.to, start + spec.decay);
  osc.connect(envelope(ctx, spec.peak, TONE_ATTACK, spec.decay, spec.delay));
  osc.start(start);
  osc.stop(start + spec.decay + TONE_ATTACK);
}

function playRecipe(recipe: readonly ToneSpec[]): void {
  const ctx = audio();
  if (ctx) recipe.forEach((spec) => tone(ctx, spec));
}

/** 発砲。power（0〜1）が大きいほど低く重く、長く震える。 */
export function playShot(power: number): void {
  const ctx = audio();
  if (ctx) {
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx, SHOT.noiseSeconds);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = SHOT.lowpassBase + SHOT.lowpassRange * (1 - power);
    noise.connect(filter);
    filter.connect(envelope(ctx, 1, SHOT.attack, SHOT.crackDecay + SHOT.bodyDecay * power, 0));
    noise.start();
    tone(ctx, {
      type: "sine",
      from: SHOT.thumpFrom,
      to: SHOT.thumpTo,
      peak: SHOT.thumpPeak + SHOT.powerBoost * power,
      decay: SHOT.bodyDecay + SHOT.bodyDecay * power,
      delay: 0,
    });
  }
  vibrate([SHOT.vibrateBase + SHOT.vibratePower * power, SHOT.vibrateGap, SHOT.tailBase + SHOT.tailPower * power]);
}

/** 「わかった！」の早押し音 */
export function playBuzz(): void {
  playRecipe(RECIPES.buzz);
  vibrate(VIBRATION.buzz);
}

/** READY? の打ち込み音 */
export function playReady(): void {
  playRecipe(RECIPES.ready);
}

/** 正解・受け渡しのファンファーレ */
export function playPass(): void {
  playRecipe(RECIPES.pass);
}

/** 不正解・終了 */
export function playDead(): void {
  playRecipe(RECIPES.dead);
  vibrate(VIBRATION.dead);
}
