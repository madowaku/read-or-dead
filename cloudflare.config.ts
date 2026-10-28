import { bindings, defineConfig, exports } from "cf/config";
import * as entrypoint from "./worker/index.ts" with { type: "cf-worker" };

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
    },
    exports: {
      Tree: exports.durableObject({ storage: "sqlite" }),
    },
  },
});
