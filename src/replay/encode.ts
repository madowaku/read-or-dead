// 共有動画の書き出し。
//
// 第一候補は Mediabunny + WebCodecs。1 コマずつ描いてエンコードするので、
// 端末が重くてもコマ落ちや音ズレが起きず、実時間より速く書き出せる（H.264 / AAC の MP4）。
// 対応していない端末やエンコードに失敗したときは、再生しながら録画する MediaRecorder に切り替える。
// どちらも使えない端末では、呼び出し側が PNG 保存に切り替える（canMakeVideo() が false）。

import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, canEncodeAudio, canEncodeVideo } from "mediabunny";
import { renderCues } from "../fx/synth";
import type { SoundCue } from "./clip";
import { play } from "./player";
import { RecordingError, hasWebCodecs, recorderType } from "./support";

export { RecordingError };

/** X 向けに軽く。720×1280・24fps・約 1.8Mbps で 5 秒なら 1MB 強。 */
export const VIDEO_FPS = 24;
export const VIDEO_BITRATE = 1_800_000;
export const AUDIO_BITRATE = 128_000;
const MS_PER_SECOND = 1000;
/** 進捗表示を描き直す余裕を作るため、このコマ数ごとに処理を手放す */
const YIELD_EVERY_FRAMES = 6;
/** 2 秒ごとにキーフレーム */
const KEY_FRAME_INTERVAL_SECONDS = 2;
const MP4_TYPE = "video/mp4";
const AUDIO_CHANNELS = 2;

export type EncodeMethod = "webcodecs" | "mediarecorder";

export interface VideoJob {
  /** 書き出し専用のキャンバス（表示中のプレビューとは別にする） */
  readonly canvas: HTMLCanvasElement;
  /** 先頭からのミリ秒を受け取って、その瞬間の絵を canvas に描く */
  readonly draw: (elapsedMs: number) => void;
  readonly durationMs: number;
  /** 効果音。null なら音なしの動画 */
  readonly cues: readonly SoundCue[] | null;
  readonly onProgress?: (ratio: number) => void;
}

export interface EncodedVideo {
  readonly blob: Blob;
  readonly type: string;
  readonly extension: "mp4" | "webm";
  readonly method: EncodeMethod;
  readonly hasAudio: boolean;
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

/** H.264（と AAC）でエンコードできなければ null */
async function encodeWithWebCodecs(job: VideoJob, audio: AudioBuffer | null): Promise<EncodedVideo | null> {
  if (!hasWebCodecs()) return null;
  const { width, height } = job.canvas;
  const videoOk = await canEncodeVideo("avc", { width, height, bitrate: VIDEO_BITRATE, frameRate: VIDEO_FPS });
  const audioOk = !audio || (await canEncodeAudio("aac", { numberOfChannels: AUDIO_CHANNELS, sampleRate: audio.sampleRate, bitrate: AUDIO_BITRATE }));
  if (!videoOk || !audioOk) return null;

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
  const video = new CanvasSource(job.canvas, { codec: "avc", bitrate: VIDEO_BITRATE, keyFrameInterval: KEY_FRAME_INTERVAL_SECONDS });
  output.addVideoTrack(video, { frameRate: VIDEO_FPS });
  const sound = audio ? new AudioBufferSource({ codec: "aac", bitrate: AUDIO_BITRATE }) : null;
  if (sound) output.addAudioTrack(sound);

  try {
    await output.start();
    if (sound && audio) await sound.add(audio);
    const frameCount = Math.ceil((job.durationMs / MS_PER_SECOND) * VIDEO_FPS);
    const frameSeconds = 1 / VIDEO_FPS;
    await Array.from({ length: frameCount }, (_, index) => index).reduce(async (previous, index) => {
      await previous;
      job.draw(Math.min(job.durationMs, index * frameSeconds * MS_PER_SECOND));
      await video.add(index * frameSeconds, frameSeconds);
      job.onProgress?.((index + 1) / frameCount);
      if (!(index % YIELD_EVERY_FRAMES)) await nextTask();
    }, Promise.resolve());
    await output.finalize();
  } catch (err) {
    if (output.state === "started" || output.state === "pending") await output.cancel();
    throw err;
  }

  if (!target.buffer) throw new RecordingError("動画データが空でした");
  return { blob: new Blob([target.buffer], { type: MP4_TYPE }), type: MP4_TYPE, extension: "mp4", method: "webcodecs", hasAudio: Boolean(audio) };
}

/** 再生しながら録画する。音は同じ AudioBuffer を同時に流して録る。 */
async function recordWithMediaRecorder(job: VideoJob, audio: AudioBuffer | null): Promise<EncodedVideo> {
  const type = recorderType(Boolean(audio)) ?? recorderType(false);
  if (!type) throw new RecordingError("この端末のブラウザは動画の書き出しに対応していません。画像で保存してください。");
  const withAudio = Boolean(audio) && type === recorderType(true);

  const stream = job.canvas.captureStream(VIDEO_FPS);
  const audioCtx = withAudio ? new AudioContext() : null;
  const player = audioCtx && audio ? audioCtx.createBufferSource() : null;
  if (audioCtx && player && audio) {
    const destination = audioCtx.createMediaStreamDestination();
    player.buffer = audio;
    player.connect(destination);
    destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
  }

  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: VIDEO_BITRATE, audioBitsPerSecond: AUDIO_BITRATE });
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size) chunks.push(event.data);
  });
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.addEventListener("stop", () => resolve());
    recorder.addEventListener("error", (event) => reject(new RecordingError("録画に失敗しました", { cause: event })));
  });

  const progress = window.setInterval(() => job.onProgress?.(0), MS_PER_SECOND);
  recorder.start();
  player?.start();
  try {
    await play(job.draw, job.durationMs, () => 1).finished;
  } finally {
    window.clearInterval(progress);
    recorder.stop();
    stream.getTracks().forEach((track) => track.stop());
    await audioCtx?.close();
  }
  await stopped;

  const blob = new Blob(chunks, { type });
  if (!blob.size) throw new RecordingError("録画データが空でした");
  return { blob, type, extension: type.startsWith(MP4_TYPE) ? "mp4" : "webm", method: "mediarecorder", hasAudio: withAudio };
}

/** WebCodecs で書き出し、だめなら MediaRecorder で録画する */
export async function encodeVideo(job: VideoJob): Promise<EncodedVideo> {
  const audio = job.cues ? await renderCues(job.cues, job.durationMs) : null;
  try {
    const encoded = await encodeWithWebCodecs(job, audio);
    if (encoded) return encoded;
  } catch (err) {
    console.warn("WebCodecs での書き出しに失敗したので、録画に切り替えます", err);
  }
  return recordWithMediaRecorder(job, audio);
}
