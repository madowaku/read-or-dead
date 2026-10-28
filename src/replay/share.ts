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

// ---- 挑戦状（投稿文＋挑戦 URL）を好きなアプリへ渡す ----

/** 共有シートに渡すもの。画像や動画は付けない（リンクカードは挑戦ページの OGP に任せる） */
export interface ChallengeLink {
  readonly title: string;
  readonly text: string;
  readonly url: string;
}

/**
 * shared：共有シートで共有先が選ばれた（実際に投稿されたかまでは分からない）
 * cancelled：共有シートを閉じた
 * copied：共有できなかったので投稿文と URL をコピーした
 * failed：共有もコピーもできなかった（手で選んでコピーしてもらう）
 */
export type ChallengeShareOutcome = "shared" | "cancelled" | "copied" | "failed";

/** 共有に使う端末の機能。テストでは差し替える */
export interface ShareEnv {
  readonly share?: (data: ShareData) => Promise<void>;
  readonly canShare?: (data: ShareData) => boolean;
  readonly copy: (text: string) => Promise<void>;
}

export function browserShareEnv(): ShareEnv {
  return {
    share: typeof navigator.share === "function" ? (data): Promise<void> => navigator.share(data) : undefined,
    canShare: typeof navigator.canShare === "function" ? (data): boolean => navigator.canShare(data) : undefined,
    copy: copyText,
  };
}

/** コピーするときの 1 つの文章（投稿文＋改行＋URL） */
export function challengeText(link: ChallengeLink): string {
  return `${link.text}\n${link.url}`;
}

/** 共有シートを使えるか。使えなければ「コピー」を主役にする */
export function canShareChallenge(link: ChallengeLink, env: ShareEnv): boolean {
  if (!env.share) return false;
  return env.canShare ? env.canShare({ ...link }) : true;
}

async function copyFallback(link: ChallengeLink, env: ShareEnv): Promise<ChallengeShareOutcome> {
  try {
    await env.copy(challengeText(link));
    return "copied";
  } catch (err) {
    console.warn("copy failed", err);
    return "failed";
  }
}

/** 共有シートを開く。タップの直後に呼ぶ（その前に待つ処理を挟むと、ブラウザが共有シートを開かないことがある） */
export async function shareChallenge(link: ChallengeLink, env: ShareEnv): Promise<ChallengeShareOutcome> {
  if (!env.share || !canShareChallenge(link, env)) return copyFallback(link, env);
  try {
    await env.share({ ...link });
    return "shared";
  } catch (err) {
    // 閉じただけなら何もしない（勝手にコピーしない）
    if (err instanceof DOMException && err.name === ABORT_ERROR) return "cancelled";
    console.warn("share failed", err);
    return copyFallback(link, env);
  }
}
