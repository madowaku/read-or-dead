// 進行中のゲームを端末に保存する。タブが裏で破棄されても続きから遊べるようにするため。

import type { RelaySnapshot } from "./game/relay";
import type { Question } from "./game/types";

const STORAGE_KEY = "read-or-dead:game";
const STORAGE_VERSION = 1;

export interface SavedGame {
  readonly version: typeof STORAGE_VERSION;
  readonly question: Question;
  readonly relay: RelaySnapshot;
  /** 参加権を取得済みで回答・射撃が残っている場合のトークン */
  readonly token: string | null;
}

function isSavedGame(value: unknown): value is SavedGame {
  if (typeof value !== "object" || value === null) return false;
  const record: Readonly<Record<string, unknown>> = { ...value };
  return record.version === STORAGE_VERSION && typeof record.question === "object" && typeof record.relay === "object";
}

export function saveGame(game: Omit<SavedGame, "version">): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, ...game }));
  } catch (err) {
    // 保存できなくても遊べる。プライベートモードなどで失敗する。
    console.warn("saveGame failed", err);
  }
}

export function loadGame(): SavedGame | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSavedGame(parsed) ? parsed : null;
  } catch (err) {
    console.warn("loadGame failed", err);
    return null;
  }
}

export function clearGame(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn("clearGame failed", err);
  }
}
