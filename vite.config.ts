import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  // GitHub Pages（--mode pages）は今までどおり静的ファイルだけを、サブパスでも動く相対パスで出力する。
  // テストでは Worker を起動しない。それ以外は Cloudflare Workers 用（URL リレーのサーバーつき）。
  if (mode === "pages") return { base: "./" };
  if (mode === "test") return {};
  return { plugins: [cloudflare()] };
});
