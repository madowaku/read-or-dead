import { bindings, defineConfig, exports } from "cf/config";
import * as entrypoint from "./worker/index.ts" with { type: "cf-worker" };

/** 新しい木を作れる回数（IP ごと、TREE_LIMIT_PERIOD 秒あたり） */
const TREE_LIMIT = 5;
const TREE_LIMIT_PERIOD = 60;

export default defineConfig({
  worker: {
    name: "read-or-dead",
    entrypoint,
    compatibilityDate: "2026-10-23",
    compatibilityFlags: ["enable_ctx_exports"],
    observability: { enabled: true },
    assets: {
      notFoundHandling: "single-page-application",
      // 挑戦ページ（リンクカードのタグを差し込む）・カード画像・API は Worker が先に受ける
      runWorkerFirst: ["/r/*", "/card/*", "/api/*"],
    },
    env: {
      ASSETS: bindings.assets(),
      // 新しい木を作る回数の上限。挑戦・回答・射撃には掛けない
      TREE_LIMITER: bindings.rateLimit({ namespace: "1001", simple: { limit: TREE_LIMIT, period: TREE_LIMIT_PERIOD } }),
    },
    exports: {
      Tree: exports.durableObject({ storage: "sqlite" }),
    },
  },
});
