// 効果音の合成。鳴らす先（AudioContext / OfflineAudioContext）と時刻を指定して予約する。
// ゲーム中のリアルタイム再生（feedback.ts）と、共有動画の音声トラック（renderCues）で同じ音を使う。

import type { SoundCue, SoundKind } from "../replay/clip";
import sounds from "./sounds.json";

const MASTER_GAIN = 0.55;
const SILENT = 0.0001;
/** 乱数 0〜1 を -1〜1 に広げる幅 */
const NOISE_SPAN = 2;
const TONE_ATTACK = 0.005;
const MS_PER_SECOND = 1000;

export interface Mixer {
  readonly ctx: BaseAudioContext;
  /** 音をつなぐ先 */
  readonly out: AudioNode;
}

interface ToneSpec {
  readonly type: OscillatorType;
  readonly from: number;
  readonly to: number;
  readonly peak: number;
  readonly decay: number;
  readonly delay: number;
}

export type RecipeName = "buzz" | "ready" | "pass" | "dead" | "finale" | "rewind";

const OSCILLATOR_TYPES: readonly OscillatorType[] = ["sine", "square", "sawtooth", "triangle"];

function toToneSpec(raw: Omit<ToneSpec, "type"> & { readonly type: string }): ToneSpec {
  const type = OSCILLATOR_TYPES.find((candidate) => candidate === raw.type);
  if (!type) throw new TypeError(`unknown oscillator type: ${raw.type}`);
  return { ...raw, type };
}

/** 音色の設計図（周波数は Hz、時間は秒）。数値の調整は sounds.json で行う。 */
const RECIPES: Readonly<Record<RecipeName, readonly ToneSpec[]>> = {
  buzz: sounds.recipes.buzz.map(toToneSpec),
  ready: sounds.recipes.ready.map(toToneSpec),
  pass: sounds.recipes.pass.map(toToneSpec),
  dead: sounds.recipes.dead.map(toToneSpec),
  finale: sounds.recipes.finale.map(toToneSpec),
  rewind: sounds.recipes.rewind.map(toToneSpec),
};
const SHOT = sounds.shot;
const IMPACT = sounds.impact;
const RENDER = sounds.render;

/** 白色雑音のバッファ */
function noiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  data.forEach((_, index) => {
    data[index] = Math.random() * NOISE_SPAN - 1;
  });
  return buffer;
}

function envelope(mixer: Mixer, peak: number, attack: number, decay: number, start: number): GainNode {
  const gain = mixer.ctx.createGain();
  gain.gain.setValueAtTime(SILENT, start);
  gain.gain.exponentialRampToValueAtTime(peak * MASTER_GAIN, start + attack);
  gain.gain.exponentialRampToValueAtTime(SILENT, start + attack + decay);
  gain.connect(mixer.out);
  return gain;
}

function tone(mixer: Mixer, spec: ToneSpec, when: number): void {
  const osc = mixer.ctx.createOscillator();
  const start = when + spec.delay;
  osc.type = spec.type;
  osc.frequency.setValueAtTime(spec.from, start);
  osc.frequency.exponentialRampToValueAtTime(spec.to, start + spec.decay);
  osc.connect(envelope(mixer, spec.peak, TONE_ATTACK, spec.decay, start));
  osc.start(start);
  osc.stop(start + spec.decay + TONE_ATTACK);
}

function noiseBurst(mixer: Mixer, filterType: BiquadFilterType, frequency: number, q: number, peak: number, decay: number, start: number): void {
  const noise = mixer.ctx.createBufferSource();
  noise.buffer = noiseBuffer(mixer.ctx, decay + SHOT.attack);
  const filter = mixer.ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  noise.connect(filter);
  filter.connect(envelope(mixer, peak, SHOT.attack, decay, start));
  noise.start(start);
}

export function scheduleRecipe(mixer: Mixer, name: RecipeName, when: number): void {
  RECIPES[name].forEach((spec) => tone(mixer, spec, when));
}

/** 発砲（BANG!）。power（0〜1）が大きいほど低く重く、長く響く。 */
export function scheduleShot(mixer: Mixer, when: number, power: number): void {
  const DEFAULT_Q = 0.7;
  noiseBurst(mixer, "lowpass", SHOT.lowpassBase + SHOT.lowpassRange * (1 - power), DEFAULT_Q, 1, SHOT.crackDecay + SHOT.bodyDecay * power, when);
  tone(
    mixer,
    {
      type: "sine",
      from: SHOT.thumpFrom,
      to: SHOT.thumpTo,
      peak: SHOT.thumpPeak + SHOT.powerBoost * power,
      decay: SHOT.bodyDecay + SHOT.bodyDecay * power,
      delay: 0,
    },
    when,
  );
}

/** 着弾。紙が裂けて破片が散るパラパラ音と、低い地鳴り。 */
export function scheduleImpact(mixer: Mixer, when: number, power: number): void {
  Array.from({ length: IMPACT.debrisCount }, (_, index) => when + index * IMPACT.debrisGap).forEach((start, index) =>
    noiseBurst(mixer, "bandpass", IMPACT.bandpass * (1 + index / IMPACT.debrisCount), IMPACT.bandpassQ, IMPACT.debrisPeak * (1 - index / IMPACT.debrisCount), IMPACT.debrisDecay, start),
  );
  tone(
    mixer,
    { type: "sine", from: IMPACT.rumbleFrom, to: IMPACT.rumbleTo, peak: IMPACT.rumblePeak * power, decay: IMPACT.rumbleDecay, delay: 0 },
    when,
  );
}

const CUE_SCHEDULERS: Readonly<Record<SoundKind, (mixer: Mixer, when: number, power: number) => void>> = {
  shot: scheduleShot,
  impact: scheduleImpact,
  finale: (mixer, when) => scheduleRecipe(mixer, "finale", when),
  rewind: (mixer, when) => scheduleRecipe(mixer, "rewind", when),
};

export class AudioRenderError extends Error {
  constructor(options?: ErrorOptions) {
    super("効果音を作れませんでした", options);
    this.name = "AudioRenderError";
  }
}

/** 動画の時間割に合わせた音声トラックを、実時間を待たずに書き出す */
export async function renderCues(cues: readonly SoundCue[], durationMs: number): Promise<AudioBuffer> {
  if (typeof OfflineAudioContext === "undefined") throw new AudioRenderError();
  const length = Math.ceil((durationMs / MS_PER_SECOND) * RENDER.sampleRate);
  const ctx = new OfflineAudioContext(RENDER.channels, length, RENDER.sampleRate);
  // 音が重なっても割れないよう、最後にコンプレッサーを通す
  const compressor = ctx.createDynamicsCompressor();
  compressor.connect(ctx.destination);
  const mixer: Mixer = { ctx, out: compressor };
  cues.forEach((cue) => CUE_SCHEDULERS[cue.kind](mixer, cue.atMs / MS_PER_SECOND, cue.power));
  try {
    return await ctx.startRendering();
  } catch (err) {
    throw new AudioRenderError({ cause: err });
  }
}
