// 共有シートが使えれば共有、使えなければダウンロードで保存する。

export type SaveOutcome = "shared" | "downloaded" | "cancelled";

const ABORT_ERROR = "AbortError";
const PNG_TYPE = "image/png";

export class SaveError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SaveError";
  }
}

export async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, PNG_TYPE));
  if (!blob) throw new SaveError("画像を作れませんでした");
  return blob;
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // ダウンロード開始前に破棄されないよう少し待つ
  const REVOKE_DELAY_MS = 10_000;
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

export async function shareOrDownload(blob: Blob, filename: string, text: string): Promise<SaveOutcome> {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === ABORT_ERROR) return "cancelled";
      // 共有シートが失敗しても保存はできるようにする
      download(blob, filename);
      return "downloaded";
    }
  }
  download(blob, filename);
  return "downloaded";
}
