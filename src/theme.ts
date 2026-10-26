// キャンバス描画で使う色とフォント。CSS 側の :root と同じ値にそろえる。

export const COLOR = {
  cobalt: "#1d3bd6",
  cobaltDeep: "#132a9e",
  paper: "#ffffff",
  ink: "#000000",
  pink: "#ff2e88",
  mist: "#b9c6ff",
  checkerLight: "#8e97c2",
  checkerDark: "#6b74a3",
} as const;

export const FONT = {
  display: '"Dela Gothic One"',
  body: '"Zen Kaku Gothic New", sans-serif',
} as const;
