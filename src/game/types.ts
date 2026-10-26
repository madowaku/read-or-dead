// 保存データ。Phase 2（非同期URLリレー）でサーバーに移す前提で、
// Implementation Brief の Chain / Shot / Turn と同じ形にしている。

export type ChainStatus = "active" | "completed" | "expired";
export type TurnStatus = "waiting" | "claimed" | "correct" | "failed";
export type QuestionKind = "text" | "silhouette" | "custom";

export interface Chain {
  readonly id: string;
  status: ChainStatus;
  readonly sourceImageKey: string;
  /** 非公開。終了前に UI へ渡さないこと。 */
  readonly answer: string;
  /** 非公開。正規化前の別解。 */
  readonly acceptedAnswers: readonly string[];
  /** 現在挑戦中（または次に挑戦する）ターン番号。1 始まり。 */
  turnNumber: number;
  readonly createdAt: number;
  completedAt: number | null;
}

export interface Shot {
  readonly chainId: string;
  readonly turnNumber: number;
  /** 0〜1 の正規化座標（画像の幅・高さ基準） */
  readonly x: number;
  readonly y: number;
  /** 画像の幅に対する比率 */
  readonly radius: number;
  readonly createdAt: number;
}

export interface Turn {
  readonly chainId: string;
  readonly turnNumber: number;
  /** ローカル版では参加権トークンのハッシュの代わりにランダム ID を入れる */
  readonly tokenHash: string;
  status: TurnStatus;
  readonly createdAt: number;
  finishedAt: number | null;
  /** 挑戦者が入力した回答（ギブアップ時は null） */
  submittedAnswer: string | null;
}

export interface Question {
  readonly key: string;
  readonly kind: QuestionKind;
  /** 文字問題: 描画する文字列 / シルエット: 画像 URL */
  readonly source: string;
  readonly answer: string;
  readonly acceptedAnswers: readonly string[];
}
