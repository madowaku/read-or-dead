// 動画を作れるかどうかの判定。mediabunny を読み込まずに使えるよう encode.ts から分けている。

/** MediaRecorder で使う形式（共有しやすい順）。Android Chrome は新しめなら mp4、古ければ webm になる。 */
const RECORDER_TYPES_WITH_AUDIO: readonly string[] = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];
const RECORDER_TYPES_SILENT: readonly string[] = [
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

export function hasWebCodecs(): boolean {
  return typeof VideoEncoder !== "undefined";
}

export function recorderType(withAudio: boolean): string | null {
  if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement.prototype.captureStream !== "function") return null;
  const candidates = withAudio ? RECORDER_TYPES_WITH_AUDIO : RECORDER_TYPES_SILENT;
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

/** この端末で何らかの方法で動画を作れるか */
export function canMakeVideo(): boolean {
  return hasWebCodecs() || recorderType(false) !== null;
}
