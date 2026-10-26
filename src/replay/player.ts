// リプレイの再生と録画。録画は再生中のキャンバスをそのまま MediaRecorder に流す。

/** X 向けに軽く。720×1280・24fps・約 1.8Mbps で 5 秒なら 1MB 強。 */
const CAPTURE_FPS = 24;
const VIDEO_BITS_PER_SECOND = 1_800_000;

/** 共有しやすい順。Android Chrome は新しめなら mp4、古ければ webm になる。 */
const VIDEO_TYPES: readonly string[] = [
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

export class RecordingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RecordingError";
  }
}

export function supportedVideoType(): string | null {
  if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement.prototype.captureStream !== "function") return null;
  return VIDEO_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

export interface PlaybackHandle {
  readonly stop: () => void;
  /** 最後まで再生すると解決する。stop() で止めたときも解決する。 */
  readonly finished: Promise<void>;
}

/** 経過時間（ミリ秒）を受け取ってその瞬間の絵を描く */
export type Drawer = (elapsedMs: number) => void;

/** speed() は毎フレーム読むので、再生中の速度変更が反映される */
export function play(draw: Drawer, duration: number, speed: () => number): PlaybackHandle {
  const state = { elapsed: 0, last: performance.now(), frameId: 0, stopped: false };
  const finished = new Promise<void>((resolve) => {
    const tick = (now: number): void => {
      if (state.stopped) return resolve();
      state.elapsed = Math.min(duration, state.elapsed + (now - state.last) * speed());
      state.last = now;
      draw(state.elapsed);
      if (state.elapsed >= duration) return resolve();
      state.frameId = requestAnimationFrame(tick);
    };
    draw(0);
    state.frameId = requestAnimationFrame(tick);
  });
  return {
    finished,
    stop: (): void => {
      state.stopped = true;
      cancelAnimationFrame(state.frameId);
    },
  };
}

export interface Recording {
  readonly blob: Blob;
  readonly type: string;
  readonly extension: "mp4" | "webm";
}

/** 頭から再生し直しながら録画する */
export async function record(canvas: HTMLCanvasElement, draw: Drawer, duration: number, speed: () => number): Promise<Recording> {
  const type = supportedVideoType();
  if (!type) throw new RecordingError("この端末のブラウザは動画の書き出しに対応していません");

  const stream = canvas.captureStream(CAPTURE_FPS);
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: VIDEO_BITS_PER_SECOND });
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size) chunks.push(event.data);
  });
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.addEventListener("stop", () => resolve());
    recorder.addEventListener("error", (event) => reject(new RecordingError("録画に失敗しました", { cause: event })));
  });

  recorder.start();
  try {
    await play(draw, duration, speed).finished;
  } finally {
    recorder.stop();
    stream.getTracks().forEach((track) => track.stop());
  }
  await stopped;

  const blob = new Blob(chunks, { type });
  if (!blob.size) throw new RecordingError("録画データが空でした");
  return { blob, type, extension: type.startsWith("video/mp4") ? "mp4" : "webm" };
}
