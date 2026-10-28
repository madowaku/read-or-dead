// オンライン（URL リレー）の API を呼ぶ。端末 ID と挑戦のトークンは端末に保存する。

import { randomId } from "../game/id";
import {
  DEVICE_HEADER,
  ROOT_NODE,
  TREE_ID_LENGTH,
  isBase62,
  isNodeId,
  type ApiError,
  type AttemptState,
  type ClaimResult,
  type CreatedTree,
  type NodeView,
  type OnlinePool,
  type TreeErrorCode,
} from "./protocol";

const DEVICE_KEY = "read-or-dead:device";
const ATTEMPTS_KEY = "read-or-dead:attempts";

export type AttemptAction = "state" | "start" | "buzz" | "answer" | "give-up" | "shoot";

export class OnlineError extends Error {
  constructor(
    readonly code: TreeErrorCode | "network",
    options?: ErrorOptions,
  ) {
    super(`online: ${code}`, options);
    this.name = "OnlineError";
  }
}

/** この端末で始めた挑戦。トークンはこの端末だけが持つ */
export interface SavedAttempt {
  readonly attemptId: string;
  readonly token: string;
}

/** 端末に保存できないときに使う、ページを開いている間だけの ID */
const SESSION_DEVICE = randomId();

function deviceId(): string {
  try {
    const saved = localStorage.getItem(DEVICE_KEY);
    if (saved) return saved;
    const created = randomId();
    localStorage.setItem(DEVICE_KEY, created);
    return created;
  } catch (err) {
    console.warn("deviceId failed", err);
    return SESSION_DEVICE;
  }
}

function loadAttempts(): Readonly<Record<string, SavedAttempt>> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ATTEMPTS_KEY) ?? "{}");
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, SavedAttempt>) : {};
  } catch (err) {
    console.warn("loadAttempts failed", err);
    return {};
  }
}

export function savedAttempt(treeId: string): SavedAttempt | null {
  const saved = loadAttempts()[treeId];
  return saved && typeof saved.attemptId === "string" && typeof saved.token === "string" ? saved : null;
}

function saveAttempt(treeId: string, attempt: SavedAttempt): void {
  try {
    localStorage.setItem(ATTEMPTS_KEY, JSON.stringify({ ...loadAttempts(), [treeId]: attempt }));
  } catch (err) {
    console.warn("saveAttempt failed", err);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", [DEVICE_HEADER]: deviceId() },
  }).catch((err: unknown) => {
    throw new OnlineError("network", { cause: err });
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as ApiError | null)?.error;
    throw new OnlineError(error ?? "network");
  }
  return body as T;
}

function post<T>(path: string, body: object): Promise<T> {
  return call<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export function createTree(pool: OnlinePool): Promise<CreatedTree> {
  return post<CreatedTree>("/api/trees", { pool });
}

export function fetchNode(treeId: string, nodeId: string): Promise<NodeView> {
  return call<NodeView>(`/api/trees/${treeId}/nodes/${nodeId}`);
}

export async function claim(treeId: string, nodeId: string): Promise<AttemptState> {
  const result = await post<ClaimResult>(`/api/trees/${treeId}/nodes/${nodeId}/attempts`, {});
  saveAttempt(treeId, { attemptId: result.state.attemptId, token: result.token });
  return result.state;
}

export function act(treeId: string, attempt: SavedAttempt, action: AttemptAction, extra: object = {}): Promise<AttemptState> {
  return post<AttemptState>(`/api/trees/${treeId}/attempts/${attempt.attemptId}/${action}`, { token: attempt.token, ...extra });
}

/** "/r/<木>/<ノード>" を読む。挑戦ページでなければ null */
export function parseChallengePath(pathname: string): { readonly treeId: string; readonly nodeId: string } | null {
  const [, prefix, treeId = "", nodeId = ROOT_NODE] = pathname.split("/");
  if (prefix !== "r" || !isBase62(treeId, TREE_ID_LENGTH) || !isNodeId(nodeId)) return null;
  return { treeId, nodeId };
}
