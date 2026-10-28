import { describe, expect, it } from "vitest";
import { canShareChallenge, challengeText, shareChallenge, type ChallengeLink, type ShareEnv } from "./share";

const LINK: ChallengeLink = {
  title: "READ OR DEAD",
  text: "TURN 001 突破（⚡1.3s）\n次はあなた。読める？ #READORDEAD",
  url: "https://example.test/r/AbCdEfGhIj/Qm81aZ",
};

interface Calls {
  readonly shared: ShareData[];
  readonly copied: string[];
}

function env(options: { share?: "ok" | "abort" | "error" | "none"; canShare?: boolean; copy?: "ok" | "error" }): { readonly env: ShareEnv; readonly calls: Calls } {
  const calls: Calls = { shared: [], copied: [] };
  const share = async (data: ShareData): Promise<void> => {
    calls.shared.push(data);
    if (options.share === "abort") throw new DOMException("cancelled", "AbortError");
    if (options.share === "error") throw new DOMException("not allowed", "NotAllowedError");
  };
  return {
    calls,
    env: {
      share: options.share === "none" ? undefined : share,
      canShare: options.canShare === undefined ? undefined : (): boolean => options.canShare ?? true,
      copy: async (text: string): Promise<void> => {
        if (options.copy === "error") throw new Error("clipboard blocked");
        calls.copied.push(text);
      },
    },
  };
}

describe("shareChallenge", () => {
  it("共有シートに投稿文・挑戦 URL・タイトルだけを渡す（画像や動画は付けない）", async () => {
    const { env: shareEnv, calls } = env({ share: "ok" });
    expect(await shareChallenge(LINK, shareEnv)).toBe("shared");
    expect(calls.shared).toEqual([{ title: LINK.title, text: LINK.text, url: LINK.url }]);
    expect(calls.copied).toEqual([]);
  });

  it("閉じただけならコピーしない", async () => {
    const { env: shareEnv, calls } = env({ share: "abort" });
    expect(await shareChallenge(LINK, shareEnv)).toBe("cancelled");
    expect(calls.copied).toEqual([]);
  });

  it("共有に失敗したら投稿文＋改行＋URL をコピーする", async () => {
    const { env: shareEnv, calls } = env({ share: "error" });
    expect(await shareChallenge(LINK, shareEnv)).toBe("copied");
    expect(calls.copied).toEqual([`${LINK.text}\n${LINK.url}`]);
  });

  it("共有シートがない・共有できないと判定されたらコピーを主役にする", async () => {
    const missing = env({ share: "none" });
    expect(canShareChallenge(LINK, missing.env)).toBe(false);
    expect(await shareChallenge(LINK, missing.env)).toBe("copied");

    const refused = env({ share: "ok", canShare: false });
    expect(canShareChallenge(LINK, refused.env)).toBe(false);
    expect(await shareChallenge(LINK, refused.env)).toBe("copied");
    expect(refused.calls.shared).toEqual([]);
  });

  it("共有もコピーもできなければ failed（画面に手でコピーする文章を出す）", async () => {
    const { env: shareEnv } = env({ share: "error", copy: "error" });
    expect(await shareChallenge(LINK, shareEnv)).toBe("failed");
  });

  it("コピーする文章は投稿文の次の行に URL", () => {
    expect(challengeText(LINK).split("\n").at(-1)).toBe(LINK.url);
  });
});
