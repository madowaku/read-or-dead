// 画面遷移。ローカルモード（同じ端末を回して遊ぶ）。

import { LocalRelay, RelayError, SHOT_RADIUS } from "./game/relay";
import { ALL_QUESTIONS, SILHOUETTE_QUESTIONS, TEXT_QUESTIONS, customQuestion, displayAnswer, pickRandom } from "./game/questions";
import { createSource, drawDamaged } from "./game/render";
import type { Chain, Question } from "./game/types";
import { composePoster, createComposer, createFrameCanvas, type ReplayMeta } from "./replay/compose";
import { RecordingError, play, record, supportedVideoType, type PlaybackHandle } from "./replay/player";
import { canvasToBlob, shareOrDownload } from "./replay/share";
import { clearGame, loadGame, saveGame } from "./storage";
import { button, h, once } from "./ui/dom";
import { createReticle, createStage, flashAt, placeReticle, toNormalized, type Point } from "./ui/stage";

const HANDOFF_DELAY_MS = 900;
const TOAST_MS = 2800;
const PREVIEW_DEBOUNCE_MS = 250;
const MAX_CUSTOM_LENGTH = 12;
const SLOW_SPEED = 0.5;
const DEFAULT_SPEED = 1;
const FAST_SPEED = 2;
const SPEEDS: readonly number[] = [SLOW_SPEED, DEFAULT_SPEED, FAST_SPEED];
const SHARE_TEXT = "READ OR DEAD — 何発目で分かった？";

// 別解の区切り。読点・カンマ・改行・スラッシュ。"ねこ、ネコ/cat" → ["ねこ","ネコ","cat"]; "ねこ" は 1 件のまま。
// https://regex101.com/?flavor=javascript&regex=%5B%E3%80%81%2C%EF%BC%8C%5Cn%2F%EF%BC%8F%5D&flags=g&testString=%E3%81%AD%E3%81%93%E3%80%81%E3%83%8D%E3%82%B3%2Fcat%0A%E3%81%AD%E3%81%93
const ANSWER_SEPARATOR = /[、,，\n/／]/;

type Pool = "text" | "silhouette" | "mix";

const POOLS: Readonly<Record<Pool, readonly Question[]>> = {
  text: TEXT_QUESTIONS,
  silhouette: SILHOUETTE_QUESTIONS,
  mix: ALL_QUESTIONS,
};

interface Game {
  readonly question: Question;
  readonly relay: LocalRelay;
  readonly source: HTMLCanvasElement;
}

function screen(name: string, children: readonly (Node | null | false)[]): HTMLElement {
  return h("main", { class: `screen screen-${name}` }, children);
}

function resumeLabel(chain: Chain): string {
  if (chain.status === "active") return `続きから（${chain.turnNumber}人目）`;
  return "前回の結果を見る";
}

function errorMessage(err: unknown): string {
  if (err instanceof RelayError) return "この操作はもうできません。画面を進めてください。";
  if (err instanceof RecordingError) return err.message;
  if (err instanceof Error) return err.message;
  return "うまくいきませんでした。もう一度試してください。";
}

export class App {
  private game: Game | null = null;
  private token: string | null = null;
  private playback: PlaybackHandle | null = null;
  private speed = DEFAULT_SPEED;

  constructor(private readonly root: HTMLElement) {}

  start(): void {
    this.showTitle();
  }

  // ---- 共通 ----

  private mount(view: HTMLElement): void {
    this.playback?.stop();
    this.playback = null;
    this.root.replaceChildren(view);
    window.scrollTo(0, 0);
    view.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }

  private toast(message: string): void {
    const note = h("div", { class: "toast", text: message, attrs: { role: "status" } });
    document.body.append(note);
    // アニメーションを切っている端末でも消えるよう、時間で消す
    window.setTimeout(() => note.remove(), TOAST_MS);
  }

  private guard(action: () => void | Promise<void>): () => void {
    return (): void => {
      const run = async (): Promise<void> => {
        try {
          await action();
        } catch (err) {
          console.error(err);
          this.toast(errorMessage(err));
        }
      };
      void run();
    };
  }

  private persist(): void {
    if (!this.game) return;
    saveGame({ question: this.game.question, relay: this.game.relay.snapshot(), token: this.token });
  }

  private requireGame(): Game {
    if (!this.game) throw new Error("ゲームが始まっていません");
    return this.game;
  }

  // ---- 1. タイトル ----

  private showTitle(): void {
    const saved = loadGame();
    const savedLabel = saved ? resumeLabel(saved.relay.chain) : null;
    const logo = h("h1", { class: "logo", attrs: { "aria-label": "READ OR DEAD" } }, [
      h("span", { class: "logo-line logo-read", text: "READ" }),
      h("span", { class: "logo-line logo-or", text: "OR" }),
      h("span", { class: "logo-line logo-dead", text: "DEAD" }),
    ]);
    this.mount(
      screen("title", [
        logo,
        h("p", { class: "tagline", text: "読めたら撃て。撃ったら渡せ。" }),
        h("div", { class: "actions" }, [
          button("START", () => this.showSetup()),
          savedLabel ? button(savedLabel, this.guard(() => this.resume()), "ghost") : null,
          button("遊び方", () => this.showHowTo(), "ghost"),
        ]),
      ]),
    );
  }

  private showHowTo(): void {
    const steps = [
      "1台のスマホを順番に回して遊びます。",
      "画像を見て、何が描かれているか答えます。チャンスは1回。",
      "正解したら、画像のどこか1か所を撃って消します。",
      "撃ったら次の人へ。前の人の答えは見せないでください。",
      "誰かが読めなかったら終了。消えた絵が元に戻るリプレイで答え合わせ。",
    ];
    this.mount(
      screen("howto", [
        h("h2", { class: "heading", text: "遊び方" }),
        h("ol", { class: "rules" }, steps.map((step) => h("li", { text: step }))),
        h("p", { class: "note", text: "どこを撃つかが腕の見せどころ。消しすぎると次の人が読めず、残しすぎると長引きます。" }),
        h("div", { class: "actions" }, [button("戻る", () => this.showTitle(), "ghost")]),
      ]),
    );
  }

  // ---- 2. 出題 ----

  private showSetup(): void {
    const pick = (pool: Pool): (() => void) => this.guard(() => this.startGame(pickRandom(POOLS[pool])));
    this.mount(
      screen("setup", [
        h("h2", { class: "heading", text: "お題を選ぶ" }),
        h("p", { class: "lead", text: "おまかせなら、全員が答えを知らないまま始められます。" }),
        h("div", { class: "choices" }, [
          button("文字", pick("text")),
          button("シルエット", pick("silhouette")),
          button("どちらでも", pick("mix")),
        ]),
        h("div", { class: "divider", attrs: { role: "separator" } }),
        h("p", { class: "lead", text: "自分で出題するなら、出題者は答える側に回らないでください。" }),
        h("div", { class: "actions" }, [
          button("自分で出題する", () => this.showCustomSetup(), "ghost"),
          button("戻る", () => this.showTitle(), "ghost"),
        ]),
      ]),
    );
  }

  private showCustomSetup(): void {
    const textInput = h("input", {
      class: "field-input",
      attrs: { type: "text", maxlength: String(MAX_CUSTOM_LENGTH), placeholder: "例：薔薇", autocomplete: "off", "data-autofocus": "" },
    });
    const answerInput = h("input", { class: "field-input", attrs: { type: "text", placeholder: "例：ばら（空なら書いた文字のまま）", autocomplete: "off" } });
    const altInput = h("textarea", { class: "field-input", attrs: { rows: "2", placeholder: "例：ローズ、rose（読点や改行で区切る）" } });
    const preview = h("div", { class: "preview" });
    const timer = { id: 0 };

    const refresh = this.guard(async () => {
      const text = textInput.value.trim();
      if (!text) {
        preview.replaceChildren();
        return;
      }
      const source = await createSource(customQuestion(text, text, []));
      preview.replaceChildren(createStage(source, []).element);
    });
    textInput.addEventListener("input", () => {
      clearTimeout(timer.id);
      timer.id = window.setTimeout(refresh, PREVIEW_DEBOUNCE_MS);
    });

    const submit = this.guard(async () => {
      const text = textInput.value.trim();
      if (!text) {
        this.toast("お題の文字を入れてください");
        textInput.focus();
        return;
      }
      const answer = answerInput.value.trim() || text;
      const alternatives = altInput.value.split(ANSWER_SEPARATOR).map((value) => value.trim()).filter(Boolean);
      await this.startGame(customQuestion(text, answer, alternatives));
    });

    this.mount(
      screen("custom", [
        h("h2", { class: "heading", text: "自分で出題する" }),
        h("label", { class: "field" }, [h("span", { class: "field-label", text: `お題の文字（${MAX_CUSTOM_LENGTH}文字まで）` }), textInput]),
        h("label", { class: "field" }, [h("span", { class: "field-label", text: "答え" }), answerInput]),
        h("label", { class: "field" }, [h("span", { class: "field-label", text: "別解" }), altInput]),
        h("p", { class: "field-label", text: "見た目の確認" }),
        preview,
        h("div", { class: "actions" }, [button("この問題で始める", submit), button("戻る", () => this.showSetup(), "ghost")]),
      ]),
    );
  }

  private async startGame(question: Question): Promise<void> {
    const source = await createSource(question);
    this.game = { question, relay: LocalRelay.create(question), source };
    this.token = null;
    this.persist();
    this.showReceive();
  }

  private async resume(): Promise<void> {
    const saved = loadGame();
    if (!saved) {
      this.showTitle();
      return;
    }
    const source = await createSource(saved.question);
    this.game = { question: saved.question, relay: LocalRelay.restore(saved.relay), source };
    this.token = saved.token;
    const view = this.game.relay.publicView();
    if (view.status !== "active") return this.showEnd();
    if (this.token && view.turnStatus === "claimed") return this.showAnswer();
    if (this.token && view.turnStatus === "correct") return this.showShoot();
    // 参加権を取ったまま中断していたら、同じターンの続きとして扱えないので受け取り画面に戻す
    return this.showReceive();
  }

  // ---- 3. リレー受信 ----

  private showReceive(): void {
    const { relay } = this.requireGame();
    const view = relay.publicView();
    const claim = once(
      this.guard(() => {
        this.token = relay.claimTurn();
        this.persist();
        this.showAnswer();
      }),
    );
    const ready = view.turnStatus === "waiting";
    this.mount(
      screen("receive", [
        h("p", { class: "turn-kicker", text: "次の挑戦者" }),
        h("p", { class: "turn-number" }, [h("span", { class: "turn-digits", text: String(view.turnNumber) }), h("span", { class: "turn-unit", text: "人目" })]),
        h("p", { class: "lead", text: view.shots.length ? `ここまで ${view.shots.length} 発撃たれています。` : "まだ一発も撃たれていません。" }),
        h("p", { class: "note", text: "答えを知っている人は画面から目をそらしてください。" }),
        h("div", { class: "actions" }, [
          ready ? button("挑戦する", claim) : h("p", { class: "note", text: "このターンはもう始まっています。" }),
          button("やめる", () => this.confirmQuit(), "ghost"),
        ]),
      ]),
    );
  }

  private confirmQuit(): void {
    if (!window.confirm("このゲームを終わりにしますか？ 記録は残りません。")) return;
    clearGame();
    this.game = null;
    this.token = null;
    this.showTitle();
  }

  // ---- 4. 回答 ----

  private showAnswer(): void {
    const { relay, source } = this.requireGame();
    const view = relay.publicView();
    const token = this.token;
    if (!token) return this.showReceive();

    const input = h("input", {
      class: "answer-input",
      attrs: { type: "text", autocomplete: "off", autocapitalize: "off", spellcheck: "false", enterkeyhint: "done", placeholder: "何に見える？", "aria-label": "回答", "data-autofocus": "" },
    });
    const submit = once(
      this.guard(() => {
        const value = input.value;
        const outcome = relay.submitAnswer(token, value);
        this.persist();
        if (outcome.correct) {
          this.showShoot();
          return;
        }
        this.token = null;
        this.persist();
        this.showEnd();
      }),
    );
    const form = h("form", { class: "answer-form", on: { submit: (event) => event.preventDefault() } }, [input]);
    form.addEventListener("submit", () => {
      if (!input.value.trim()) {
        this.toast("答えを入力してください");
        return;
      }
      submit();
    });

    const giveUp = (): void => {
      if (!window.confirm("ギブアップするとゲームが終わります。いいですか？")) return;
      this.guard(() => {
        relay.giveUp(token);
        this.token = null;
        this.persist();
        this.showEnd();
      })();
    };

    this.mount(
      screen("answer", [
        h("p", { class: "status-line" }, [h("strong", { text: `${view.turnNumber}人目` }), view.shots.length ? `　${view.shots.length}発撃たれた画像` : "　まだ無傷の画像"]),
        createStage(source, view.shots).element,
        form,
        h("p", { class: "note", text: "チャンスは1回。ひらがな・カタカナ・漢字どれでも大丈夫です。" }),
        h("div", { class: "actions actions-row" }, [
          button("回答する", () => form.requestSubmit()),
          button("ギブアップ", giveUp, "danger"),
        ]),
      ]),
    );
  }

  // ---- 5. 射撃 ----

  private showShoot(): void {
    const { relay, source } = this.requireGame();
    const view = relay.publicView();
    const token = this.token;
    if (!token) return this.showReceive();

    const stage = createStage(source, view.shots);
    const reticle = createReticle(SHOT_RADIUS);
    stage.element.append(reticle);
    stage.element.classList.add("is-aiming");
    const aim: { point: Point | null } = { point: null };
    const fireButton = button("ここを撃つ", () => fire());
    fireButton.disabled = true;

    stage.element.addEventListener("pointerdown", (event) => {
      const point = toNormalized(stage.canvas, event.clientX, event.clientY);
      aim.point = point;
      placeReticle(reticle, point);
      fireButton.disabled = false;
    });

    const fire = once(
      this.guard(() => {
        const point = aim.point;
        if (!point) return;
        fireButton.disabled = true;
        relay.fireShot(token, point.x, point.y);
        this.token = null;
        this.persist();
        drawDamaged(stage.canvas, source, relay.publicView().shots);
        reticle.remove();
        stage.element.classList.remove("is-aiming");
        flashAt(stage.element, point, SHOT_RADIUS);
        window.setTimeout(() => this.showHandoff(), HANDOFF_DELAY_MS);
      }),
    );

    this.mount(
      screen("shoot", [
        h("p", { class: "verdict", text: "正解。" }),
        h("p", { class: "lead", text: "1か所だけ撃って消せます。狙う場所をタップ。" }),
        stage.element,
        h("div", { class: "actions" }, [fireButton]),
      ]),
    );
  }

  // ---- 6. 受け渡し ----

  private showHandoff(): void {
    const { relay } = this.requireGame();
    const next = relay.publicView().turnNumber;
    this.mount(
      screen("handoff", [
        h("p", { class: "handoff-title", text: "渡せ。" }),
        h("p", { class: "lead", text: `答えは言わずに、${next}人目の人へ端末を渡してください。` }),
        h("div", { class: "actions" }, [button("渡した", () => this.showReceive())]),
      ]),
    );
  }

  // ---- 7. 終了 ----

  private resultMeta(): { readonly meta: ReplayMeta; readonly result: ReturnType<LocalRelay["result"]> } {
    const { relay, question } = this.requireGame();
    const result = relay.result();
    return { result, meta: { answer: displayAnswer(question), shotCount: result.shots.length, survivors: result.survivors } };
  }

  private showEnd(): void {
    const { source } = this.requireGame();
    const { result, meta } = this.resultMeta();
    const headline = result.endedBy === "give-up" ? "ギブアップ。" : "読めなかった。";
    const stats: readonly (readonly [string, string])[] = [
      ["挑戦した人", `${result.turns.length}人`],
      ["読めた人", `${result.survivors}人`],
      ["撃った数", `${result.shots.length}発`],
      ["最後の回答", result.lastAnswer ?? "（ギブアップ）"],
    ];
    this.mount(
      screen("end", [
        h("p", { class: "verdict verdict-dead", text: headline }),
        createStage(source, result.shots).element,
        h("p", { class: "reveal" }, [h("span", { class: "reveal-label", text: "こたえ" }), h("span", { class: "reveal-answer", text: meta.answer })]),
        h(
          "dl",
          { class: "stats" },
          stats.flatMap(([label, value]) => [h("dt", { text: label }), h("dd", { text: value })]),
        ),
        h("div", { class: "actions" }, [
          button("リプレイを見る", () => this.showReplay()),
          button("もう一度遊ぶ", () => this.showSetup(), "ghost"),
          button("タイトルへ", () => this.showTitle(), "ghost"),
        ]),
      ]),
    );
  }

  // ---- 8. リプレイ ----

  private showReplay(): void {
    const { source } = this.requireGame();
    const { result, meta } = this.resultMeta();
    const canvas = createFrameCanvas();
    canvas.classList.add("replay-canvas");
    canvas.setAttribute("aria-label", "逆再生リプレイ");
    const composer = createComposer(source, meta);
    const busy = { recording: false };

    const restart = (): void => {
      if (busy.recording) return;
      this.playback?.stop();
      this.playback = play(canvas, composer, result.shots, () => this.speed);
    };

    const speedButtons = SPEEDS.map((value) => {
      const speedButton = button(`${value}×`, () => {
        this.speed = value;
        speedButtons.forEach((other) => other.setAttribute("aria-pressed", String(other === speedButton)));
      }, "ghost");
      speedButton.classList.add("speed");
      speedButton.setAttribute("aria-pressed", String(value === this.speed));
      return speedButton;
    });

    const videoType = supportedVideoType();
    const saveVideo = this.guard(async () => {
      if (busy.recording) return;
      busy.recording = true;
      videoButton.disabled = true;
      videoButton.textContent = "動画を作っています…";
      this.playback?.stop();
      try {
        const recording = await record(canvas, composer, result.shots, () => this.speed);
        const outcome = await shareOrDownload(recording.blob, `read-or-dead.${recording.extension}`, SHARE_TEXT);
        if (outcome === "downloaded") this.toast("動画を保存しました");
      } finally {
        busy.recording = false;
        videoButton.disabled = false;
        videoButton.textContent = "動画で共有";
      }
    });
    const videoButton = button("動画で共有", saveVideo);

    const saveImage = this.guard(async () => {
      const blob = await canvasToBlob(composePoster(source, result.shots, meta));
      const outcome = await shareOrDownload(blob, "read-or-dead.png", SHARE_TEXT);
      if (outcome === "downloaded") this.toast("画像を保存しました");
    });

    this.mount(
      screen("replay", [
        h("div", { class: "replay-frame" }, [canvas]),
        h("div", { class: "speed-row", attrs: { role: "group", "aria-label": "再生速度" } }, speedButtons),
        h("div", { class: "actions" }, [
          videoType ? videoButton : h("p", { class: "note", text: "この端末では動画を作れないため、画像で保存できます。" }),
          button("画像で保存", saveImage, videoType ? "ghost" : "primary"),
          button("もう一度再生", restart, "ghost"),
          button("結果に戻る", () => this.showEnd(), "ghost"),
        ]),
      ]),
    );
    restart();
  }
}
