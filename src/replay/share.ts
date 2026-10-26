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

/** 投稿文をクリップボードへ。動画を X に直接添付できない端末向け。 */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    throw new SaveError("コピーできませんでした。長押しで選んでコピーしてください。", { cause: err });
  }
}

const X_INTENT = "https://x.com/intent/post";

/** X の投稿画面を開く URL。動画は添付できないので、保存した動画を自分で添える。 */
export function xIntentUrl(text: string, url: string): string {
  const params = new URLSearchParams({ text, url });
  return `${X_INTENT}?${params.toString()}`;
}

/** 今遊んでいるページの URL（Phase 2 で挑戦用 URL に置き換える） */
export function siteUrl(): string {
  return `${location.origin}${location.pathname}`;
}
