// 進行中のゲームを端末に保存する。タブが裏で破棄されても続きから遊べるようにするため。

import type { RelaySnapshot } from "./game/relay";
import type { Question } from "./game/types";

const STORAGE_KEY = "read-or-dead:game";
/** v0.1 の保存データ（早押しの時刻を持たない）は読み込まない */
const STORAGE_VERSION = 2;

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

// ---- 遊んだ問題の履歴（同じ問題ばかり出ないように） ----

const PLAYED_KEY = "read-or-dead:played";

export function loadPlayed(): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PLAYED_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch (err) {
    console.warn("loadPlayed failed", err);
    return new Set();
  }
}

export function markPlayed(key: string): void {
  try {
    localStorage.setItem(PLAYED_KEY, JSON.stringify([...loadPlayed(), key]));
  } catch (err) {
    console.warn("markPlayed failed", err);
  }
}

/** 候補を全部遊んだら、その分の履歴を消して一巡させる */
export function forgetPlayed(keys: readonly string[]): void {
  const drop = new Set(keys);
  try {
    localStorage.setItem(PLAYED_KEY, JSON.stringify([...loadPlayed()].filter((key) => !drop.has(key))));
  } catch (err) {
    console.warn("forgetPlayed failed", err);
  }
}
