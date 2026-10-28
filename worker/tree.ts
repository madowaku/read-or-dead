// Durable Object「Tree」。1 本の木（1 つの問題）を 1 つのオブジェクトが担当する。
// 中身は TreeRelay。RPC では独自のエラー型が伝わらないので、結果は Outcome にして返す。

import { DurableObject } from "cloudflare:workers";
import type { Shot } from "../src/game/types";
import { NODE_ID_LENGTH, type AttemptState, type NodeView, type TreeErrorCode } from "../src/online/protocol";
import { randomBase62, randomHex } from "./ids";
import { TreeError, TreeRelay } from "./relay";

export type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: TreeErrorCode };

function run<T>(action: () => T): Outcome<T> {
  try {
    return { ok: true, value: action() };
  } catch (err) {
    if (err instanceof TreeError) return { ok: false, code: err.code };
    throw err;
  }
}

export class Tree extends DurableObject {
  private readonly relay: TreeRelay;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.relay = new TreeRelay({
      sql: ctx.storage.sql,
      now: () => Date.now(),
      nodeId: () => randomBase62(NODE_ID_LENGTH),
      attemptId: () => randomHex(),
    });
  }

  create(treeId: string, questionKey: string): Outcome<null> {
    return run(() => {
      this.relay.create(treeId, questionKey);
      return null;
    });
  }

  nodeView(nodeId: string, deviceHash: string | null): Outcome<NodeView> {
    return run(() => this.relay.nodeView(nodeId, deviceHash));
  }

  claim(nodeId: string, deviceHash: string, tokenHash: string): Outcome<AttemptState> {
    return run(() => this.relay.claim(nodeId, deviceHash, tokenHash));
  }

  state(attemptId: string, tokenHash: string): Outcome<AttemptState> {
    return run(() => this.relay.state(attemptId, tokenHash));
  }

  start(attemptId: string, tokenHash: string): Outcome<AttemptState> {
    return run(() => this.relay.start(attemptId, tokenHash));
  }

  buzz(attemptId: string, tokenHash: string, clientMs: number): Outcome<AttemptState> {
    return run(() => this.relay.buzz(attemptId, tokenHash, clientMs));
  }

  answer(attemptId: string, tokenHash: string, input: string): Outcome<AttemptState> {
    return run(() => this.relay.answer(attemptId, tokenHash, input));
  }

  giveUp(attemptId: string, tokenHash: string): Outcome<AttemptState> {
    return run(() => this.relay.giveUp(attemptId, tokenHash));
  }

  shoot(attemptId: string, tokenHash: string, x: number, y: number): Outcome<AttemptState> {
    return run(() => this.relay.shoot(attemptId, tokenHash, x, y));
  }

  card(nodeId: string): Outcome<{ readonly depth: number; readonly shots: readonly Shot[] }> {
    return run(() => this.relay.card(nodeId));
  }
}
