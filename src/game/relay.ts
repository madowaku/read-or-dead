// ローカルモードのリレー進行。Phase 2 ではこの役割をサーバーが担う。
// 正解情報は外へ出さず、UI には publicView() / result() 経由でだけ渡す。

import { randomId } from "./id";
import { isCorrect } from "./normalize";
import type { Chain, Question, Shot, Turn } from "./types";

/** 穴の半径（画像の幅に対する比率）。初期版は固定。 */
export const SHOT_RADIUS = 0.08;

export type RelayErrorCode =
  | "chain-not-active"
  | "chain-not-completed"
  | "turn-already-claimed"
  | "invalid-token"
  | "turn-not-claimed"
  | "turn-not-correct"
  | "already-shot"
  | "out-of-bounds";

export class RelayError extends Error {
  constructor(readonly code: RelayErrorCode) {
    super(`relay: ${code}`);
    this.name = "RelayError";
  }
}

/** 挑戦者に見せてよい情報だけ */
export interface PublicView {
  readonly chainId: string;
  readonly status: Chain["status"];
  readonly sourceImageKey: string;
  readonly turnNumber: number;
  readonly turnStatus: Turn["status"];
  readonly shots: readonly Shot[];
}

export interface RelayResult {
  readonly chainId: string;
  readonly sourceImageKey: string;
  readonly answer: string;
  readonly acceptedAnswers: readonly string[];
  readonly shots: readonly Shot[];
  readonly turns: readonly Turn[];
  /** 正解した人数 */
  readonly survivors: number;
  readonly lastAnswer: string | null;
  readonly endedBy: "wrong" | "give-up";
  readonly createdAt: number;
  readonly completedAt: number;
}

export interface RelaySnapshot {
  readonly chain: Chain;
  readonly turns: readonly Turn[];
  readonly shots: readonly Shot[];
}

export interface AnswerOutcome {
  readonly correct: boolean;
}

export class LocalRelay {
  private readonly chain: Chain;
  private readonly turns: Turn[];
  private readonly shots: Shot[];

  private constructor(snapshot: RelaySnapshot) {
    this.chain = { ...snapshot.chain };
    this.turns = snapshot.turns.map((turn) => ({ ...turn }));
    this.shots = [...snapshot.shots];
  }

  static create(question: Question, now: number = Date.now()): LocalRelay {
    const chain: Chain = {
      id: randomId(),
      status: "active",
      sourceImageKey: question.key,
      answer: question.answer,
      acceptedAnswers: question.acceptedAnswers,
      turnNumber: 1,
      createdAt: now,
      completedAt: null,
    };
    return new LocalRelay({ chain, turns: [newTurn(chain.id, 1, now)], shots: [] });
  }

  static restore(snapshot: RelaySnapshot): LocalRelay {
    return new LocalRelay(snapshot);
  }

  snapshot(): RelaySnapshot {
    return { chain: { ...this.chain }, turns: this.turns.map((turn) => ({ ...turn })), shots: [...this.shots] };
  }

  publicView(): PublicView {
    return {
      chainId: this.chain.id,
      status: this.chain.status,
      sourceImageKey: this.chain.sourceImageKey,
      turnNumber: this.chain.turnNumber,
      turnStatus: this.currentTurn().status,
      shots: [...this.shots],
    };
  }

  /** 現在のターンの参加権を取得する。二重取得は拒否。返り値のトークンで回答・射撃する。 */
  claimTurn(): string {
    this.requireActive();
    const turn = this.currentTurn();
    if (turn.status !== "waiting") throw new RelayError("turn-already-claimed");
    turn.status = "claimed";
    return turn.tokenHash;
  }

  submitAnswer(token: string, input: string, now: number = Date.now()): AnswerOutcome {
    const turn = this.claimedTurn(token);
    const correct = isCorrect(input, this.chain.answer, this.chain.acceptedAnswers);
    turn.submittedAnswer = input;
    if (correct) {
      turn.status = "correct";
      return { correct };
    }
    this.failCurrentTurn(now);
    return { correct };
  }

  giveUp(token: string, now: number = Date.now()): void {
    this.claimedTurn(token);
    this.failCurrentTurn(now);
  }

  /** 正解したターンにつき 1 発だけ撃てる。撃つと次のターンへ進む。 */
  fireShot(token: string, x: number, y: number, now: number = Date.now()): Shot {
    this.requireActive();
    const turn = this.currentTurn();
    if (turn.tokenHash !== token) throw new RelayError("invalid-token");
    if (this.shots.some((shot) => shot.turnNumber === turn.turnNumber)) throw new RelayError("already-shot");
    if (turn.status !== "correct") throw new RelayError("turn-not-correct");
    if (!isUnit(x) || !isUnit(y)) throw new RelayError("out-of-bounds");

    const shot: Shot = { chainId: this.chain.id, turnNumber: turn.turnNumber, x, y, radius: SHOT_RADIUS, createdAt: now };
    this.shots.push(shot);
    turn.finishedAt = now;
    this.chain.turnNumber = turn.turnNumber + 1;
    this.turns.push(newTurn(this.chain.id, this.chain.turnNumber, now));
    return shot;
  }

  /** 終了後のみ取得できる。 */
  result(): RelayResult {
    if (this.chain.status !== "completed" || this.chain.completedAt === null) {
      throw new RelayError("chain-not-completed");
    }
    const last = this.currentTurn();
    return {
      chainId: this.chain.id,
      sourceImageKey: this.chain.sourceImageKey,
      answer: this.chain.answer,
      acceptedAnswers: [...this.chain.acceptedAnswers],
      shots: [...this.shots],
      turns: this.turns.map((turn) => ({ ...turn })),
      survivors: this.turns.filter((turn) => turn.status === "correct").length,
      lastAnswer: last.submittedAnswer,
      endedBy: last.submittedAnswer === null ? "give-up" : "wrong",
      createdAt: this.chain.createdAt,
      completedAt: this.chain.completedAt,
    };
  }

  private failCurrentTurn(now: number): void {
    const turn = this.currentTurn();
    turn.status = "failed";
    turn.finishedAt = now;
    this.chain.status = "completed";
    this.chain.completedAt = now;
  }

  private claimedTurn(token: string): Turn {
    this.requireActive();
    const turn = this.currentTurn();
    if (turn.tokenHash !== token) throw new RelayError("invalid-token");
    if (turn.status !== "claimed") throw new RelayError("turn-not-claimed");
    return turn;
  }

  private currentTurn(): Turn {
    const turn = this.turns[this.turns.length - 1];
    if (!turn) throw new RelayError("chain-not-active");
    return turn;
  }

  private requireActive(): void {
    if (this.chain.status !== "active") throw new RelayError("chain-not-active");
  }
}

function newTurn(chainId: string, turnNumber: number, now: number): Turn {
  return { chainId, turnNumber, tokenHash: randomId(), status: "waiting", createdAt: now, finishedAt: null, submittedAnswer: null };
}

function isUnit(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}
