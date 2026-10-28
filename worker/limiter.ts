// 回数制限。Cloudflare の Rate Limiting binding は場所ごとのおおよその制限で、短時間なら上限を大きく超えて通る。
// 運用費を抑えるために、木を作る回数は Durable Object「Limiter」で厳密に数える。
// 1 つのキー（IP ごと、または全体）を 1 つのオブジェクトが担当するので、数え漏れが起きない。

import { DurableObject } from "cloudflare:workers";
import { WindowCounter } from "./window";

/** 1 つの IP から新しい木を作れる回数（WINDOW_MS あたり） */
export const TREE_LIMIT_PER_IP = 5;
/** すべての IP をあわせて新しい木を作れる回数（WINDOW_MS あたり）。大量の IP から作られても費用が暴れないように */
export const TREE_LIMIT_GLOBAL = 60;
export const WINDOW_MS = 60_000;

export class Limiter extends DurableObject {
  private readonly counter: WindowCounter;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.counter = new WindowCounter(ctx.storage.sql);
  }

  take(limit: number, windowMs: number): boolean {
    return this.counter.take(limit, windowMs, Date.now());
  }
}
