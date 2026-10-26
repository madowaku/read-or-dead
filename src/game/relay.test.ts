import { describe, expect, it } from "vitest";
import { LocalRelay, RelayError, SHOT_RADIUS } from "./relay";
import type { Question } from "./types";

const QUESTION: Question = {
  key: "test",
  kind: "text",
  source: "檸檬",
  answer: "れもん",
  acceptedAnswers: ["檸檬"],
};

const CENTER = 0.5;
const SECOND_TURN = 2;

function errorCode(action: () => unknown): string | undefined {
  try {
    action();
  } catch (err) {
    if (err instanceof RelayError) return err.code;
    throw err;
  }
  return undefined;
}

describe("LocalRelay", () => {
  it("正解すると 1 発撃てて次のターンへ進む", () => {
    const relay = LocalRelay.create(QUESTION);
    const token = relay.claimTurn();
    expect(relay.submitAnswer(token, "レモン").correct).toBe(true);
    const shot = relay.fireShot(token, CENTER, CENTER);
    expect(shot.radius).toBe(SHOT_RADIUS);
    expect(relay.publicView().turnNumber).toBe(SECOND_TURN);
    expect(relay.publicView().shots).toHaveLength(1);
  });

  it("公開ビューに正解情報を含めない", () => {
    const relay = LocalRelay.create(QUESTION);
    const json = JSON.stringify(relay.publicView());
    expect(json).not.toContain("れもん");
    expect(json).not.toContain("檸檬");
  });

  it("同じ参加権での二重射撃・二重回答・二重取得を拒否する", () => {
    const relay = LocalRelay.create(QUESTION);
    const token = relay.claimTurn();
    expect(errorCode(() => relay.claimTurn())).toBe("turn-already-claimed");
    relay.submitAnswer(token, "れもん");
    expect(errorCode(() => relay.submitAnswer(token, "れもん"))).toBe("turn-not-claimed");
    relay.fireShot(token, CENTER, CENTER);
    expect(errorCode(() => relay.fireShot(token, CENTER, CENTER))).toBe("invalid-token");
    expect(relay.publicView().shots).toHaveLength(1);
  });

  it("回答前・範囲外の射撃を拒否する", () => {
    const relay = LocalRelay.create(QUESTION);
    const token = relay.claimTurn();
    expect(errorCode(() => relay.fireShot(token, CENTER, CENTER))).toBe("turn-not-correct");
    relay.submitAnswer(token, "れもん");
    expect(errorCode(() => relay.fireShot(token, CENTER + 1, CENTER))).toBe("out-of-bounds");
    expect(errorCode(() => relay.fireShot("other", CENTER, CENTER))).toBe("invalid-token");
  });

  it("不正解で終了し、終了後だけ結果を取得できる", () => {
    const relay = LocalRelay.create(QUESTION);
    expect(errorCode(() => relay.result())).toBe("chain-not-completed");
    const first = relay.claimTurn();
    relay.submitAnswer(first, "れもん");
    relay.fireShot(first, CENTER, CENTER);
    const second = relay.claimTurn();
    expect(relay.submitAnswer(second, "みかん").correct).toBe(false);
    expect(errorCode(() => relay.claimTurn())).toBe("chain-not-active");

    const result = relay.result();
    expect(result.answer).toBe("れもん");
    expect(result.survivors).toBe(1);
    expect(result.lastAnswer).toBe("みかん");
    expect(result.endedBy).toBe("wrong");
    expect(result.shots).toHaveLength(1);
  });

  it("ギブアップでも終了する", () => {
    const relay = LocalRelay.create(QUESTION);
    relay.giveUp(relay.claimTurn());
    expect(relay.result().endedBy).toBe("give-up");
    expect(relay.result().survivors).toBe(0);
  });

  it("スナップショットから復元しても状態が一致する", () => {
    const relay = LocalRelay.create(QUESTION);
    const token = relay.claimTurn();
    relay.submitAnswer(token, "れもん");
    const restored = LocalRelay.restore(JSON.parse(JSON.stringify(relay.snapshot())));
    restored.fireShot(token, CENTER, CENTER);
    expect(errorCode(() => restored.fireShot(token, CENTER, CENTER))).toBe("invalid-token");
    expect(restored.publicView().turnNumber).toBe(SECOND_TURN);
  });
});
