// 画面遷移。ローカルモード（同じ端末を回して遊ぶ）。
// READY? → 早押し（わかった！）→ 回答 → 揺れる照準で BANG! → PASS IT ON → 次の人。

import { BURST_MS, drawBurst } from "./fx/burst";
import { isMuted, playBuzz, playDead, playPass, playReady, playShot, setMuted } from "./fx/feedback";
import fx from "./fx/fx.json";
import { MAX_RADIUS, MIN_RADIUS, SLOW_LIMIT_MS, radiusFor, rankOf, type PowerRank } from "./game/power";
import {
  ALL_QUESTIONS,
  KANJI_QUESTIONS,
  SILHOUETTE_QUESTIONS,
  WORD_QUESTIONS,
  customQuestion,
  displayAnswer,
  pickFresh,
} from "./game/questions";
import { LocalRelay, RelayError, type RelayResult } from "./game/relay";
import { createSource, drawDamaged } from "./game/render";
import type { Chain, Question, Shot } from "./game/types";
import {
  SHOT_CLIP_MS,
  composePoster,
  composeShotCard,
  createComposer,
  createFrameCanvas,
  createShotClipComposer,
  shotBurst,
  shotLabel,
  type ReplayMeta,
} from "./replay/compose";
import { clipSoundCues, type SoundCue } from "./replay/clip";
import type { EncodedVideo } from "./replay/encode";
import { RecordingError, canMakeVideo } from "./replay/support";
import { play, type Drawer, type PlaybackHandle } from "./replay/player";
import { canvasToBlob, copyText, shareOrDownload, siteUrl, xIntentUrl } from "./replay/share";
import { frameAt, replayDuration, replaySoundCues } from "./replay/timeline";
import { clearGame, forgetPlayed, loadGame, loadPlayed, loadVideoSound, markPlayed, saveGame, saveVideoSound } from "./storage";
import { startAim, type AimController } from "./ui/aim";
import { button, h, once } from "./ui/dom";
import { createReticle, createStage, type Point } from "./ui/stage";

const TOAST_MS = 2800;
const PREVIEW_DEBOUNCE_MS = 250;
const MAX_CUSTOM_LENGTH = 12;
const SLOW_SPEED = 0.5;
const DEFAULT_SPEED = 1;
const FAST_SPEED = 2;
const SPEEDS: readonly number[] = [SLOW_SPEED, DEFAULT_SPEED, FAST_SPEED];
const INTRO_MS = 1500;
const REDUCED_INTRO_MS = 300;
const AFTER_SHOT_MS = 1400;
const PERCENT = 100;
const MS_PER_SECOND = 1000;
const SECONDS_DIGITS = 1;
const PERCENT_DIGITS = 1;
const TURN_DIGITS = 3;
const DIAMETER_PER_RADIUS = 2;
/** 照準の外まで破片が飛ぶよう、演出用キャンバスを画像より広く取る（片側の比率） */
const BURST_BLEED = 0.5;
/** 弾の大きさメーターの箱が表す画像の幅の比率 */
const METER_SPAN = 0.3;
const METER_BOX_PX = 72;
const HASHTAG = "#READORDEAD";
const BYTES_PER_KB = 1024;
const BYTES_PER_MB = BYTES_PER_KB * BYTES_PER_KB;
const MB_DIGITS = 1;

/** 書き出し用の絵と音の指定。canvas は書き出し専用に毎回作る。 */
interface VideoPlan {
  readonly draw: Drawer;
  readonly durationMs: number;
  readonly cues: readonly SoundCue[];
}

function describeVideo(video: EncodedVideo): string {
  const size = (video.blob.size / BYTES_PER_MB).toFixed(MB_DIGITS);
  return `${size}MB・${video.hasAudio ? "音あり" : "音なし"}`;
}

// 別解の区切り。読点・カンマ・改行・スラッシュ。"ねこ、ネコ/cat" → ["ねこ","ネコ","cat"]; "ねこ" は 1 件のまま。
// https://regex101.com/?flavor=javascript&regex=%5B%E3%80%81%2C%EF%BC%8C%5Cn%2F%EF%BC%8F%5D&flags=g&testString=%E3%81%AD%E3%81%93%E3%80%81%E3%83%8D%E3%82%B3%2Fcat%0A%E3%81%AD%E3%81%93
const ANSWER_SEPARATOR = /[、,，\n/／]/;

type Pool = "kanji" | "word" | "silhouette" | "all";

const POOLS: Readonly<Record<Pool, { readonly label: string; readonly questions: readonly Question[] }>> = {
  kanji: { label: "漢字・熟語", questions: KANJI_QUESTIONS },
  word: { label: "ことば・短文", questions: WORD_QUESTIONS },
  silhouette: { label: "シルエット", questions: SILHOUETTE_QUESTIONS },
  all: { label: "ぜんぶ", questions: ALL_QUESTIONS },
};

const RANK_TITLE: Readonly<Record<PowerRank, string>> = {
  power: "POWER SHOT!",
  normal: "SHOT!",
  weak: "WEAK SHOT…",
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

function turnLabel(turnNumber: number): string {
  return `TURN ${String(turnNumber).padStart(TURN_DIGITS, "0")}`;
}

function percent(radius: number): string {
  return `${(radius * PERCENT).toFixed(PERCENT_DIGITS)}%`;
}

function seconds(ms: number): string {
  return `${(ms / MS_PER_SECOND).toFixed(SECONDS_DIGITS)}s`;
}

/** 0（最小の弾）〜 1（最大の弾） */
function powerLevel(radius: number): number {
  return (radius - MIN_RADIUS) / (MAX_RADIUS - MIN_RADIUS);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** 弾の大きさメーター。円の直径が実際の穴の大きさに比例する。 */
function createMeter(): { readonly element: HTMLElement; readonly update: (radius: number, elapsedMs: number) => void } {
  const bullet = h("span", { class: "meter-bullet" });
  const ring = h("span", { class: "meter-ring" }, [bullet]);
  const time = h("span", { class: "meter-time" });
  const size = h("span", { class: "meter-size" });
  const element = h("div", { class: "meter", attrs: { "aria-live": "off" } }, [ring, h("span", { class: "meter-text" }, [time, size])]);
  return {
    element,
    update: (radius, elapsedMs): void => {
      const diameter = ((radius * DIAMETER_PER_RADIUS) / METER_SPAN) * METER_BOX_PX;
      bullet.style.setProperty("width", `${diameter}px`);
      bullet.style.setProperty("height", `${diameter}px`);
      ring.style.setProperty("--p", String(Math.min(1, elapsedMs / SLOW_LIMIT_MS)));
      time.textContent = seconds(elapsedMs);
      size.textContent = `弾 ${percent(radius)}`;
    },
  };
}

/** 画面を駆け抜ける文字 */
function sweep(text: string, direction: "left" | "right", variant: string): HTMLElement {
  return h("p", { class: `sweep sweep-${direction} sweep-${variant}`, attrs: { "aria-hidden": "true" } }, [h("span", { text })]);
}

export class App {
  private game: Game | null = null;
  private token: string | null = null;
  private playback: PlaybackHandle | null = null;
  private cleanup: (() => void) | null = null;
  private speed = DEFAULT_SPEED;

  constructor(private readonly root: HTMLElement) {}

  start(): void {
    this.showTitle();
  }

  // ---- 共通 ----

  private mount(view: HTMLElement): void {
    this.playback?.stop();
    this.playback = null;
    this.cleanup?.();
    this.cleanup = null;
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

  private requireToken(): string {
    if (!this.token) throw new RelayError("invalid-token");
    return this.token;
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
    const soundButton = button(isMuted() ? "音：OFF" : "音：ON", () => {
      setMuted(!isMuted());
      soundButton.textContent = isMuted() ? "音：OFF" : "音：ON";
      if (!isMuted()) playBuzz();
    }, "ghost");
    soundButton.classList.add("btn-small");
    this.mount(
      screen("title", [
        logo,
        h("p", { class: "tagline", text: "読めたら撃て。撃ったら渡せ。" }),
        h("div", { class: "actions" }, [
          button("START", () => this.showSetup()),
          savedLabel ? button(savedLabel, this.guard(() => this.resume()), "ghost") : null,
          button("遊び方", () => this.showHowTo(), "ghost"),
          soundButton,
        ]),
      ]),
    );
  }

  private showHowTo(): void {
    const steps = [
      "1台のスマホを順番に回して遊びます。",
      "画像が出たら、読めた瞬間に「わかった！」。早く押すほど弾が大きくなります（0秒で12%、15秒で6%）。",
      "それから答えを入力。チャンスは1回。入力の速さは弾の大きさに関係ありません。",
      "正解したら、画像をなぞって狙い、BANG!。照準は少し揺れます。動かした直後は特に揺れるので、落ち着いてから撃つのがコツ。",
      "撃ったら次の人へ。その一発は短い動画にしてすぐ共有できます。",
      "誰かが読めなかったら終了。消えた絵が元に戻るリプレイで答え合わせ。",
    ];
    this.mount(
      screen("howto", [
        h("h2", { class: "heading", text: "遊び方" }),
        h("ol", { class: "rules" }, steps.map((step) => h("li", { text: step }))),
        h("div", { class: "actions" }, [button("戻る", () => this.showTitle(), "ghost")]),
      ]),
    );
  }

  // ---- 2. 出題 ----

  private showSetup(): void {
    const pick = (pool: Pool): (() => void) =>
      this.guard(() => {
        const { questions } = POOLS[pool];
        const played = loadPlayed();
        if (questions.every((question) => played.has(question.key))) forgetPlayed(questions.map((question) => question.key));
        return this.startGame(pickFresh(questions, loadPlayed()));
      });
    const choices = (["kanji", "word", "silhouette", "all"] as const).map((pool) => {
      const choice = button(POOLS[pool].label, pick(pool));
      choice.append(h("span", { class: "choice-count", text: `${POOLS[pool].questions.length}問` }));
      return choice;
    });
    this.mount(
      screen("setup", [
        h("h2", { class: "heading", text: "お題を選ぶ" }),
        h("p", { class: "lead", text: "おまかせなら、全員が答えを知らないまま始められます。" }),
        h("div", { class: "choices" }, choices),
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
    markPlayed(question.key);
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
        h("p", { class: "turn-kicker", text: "NEXT PLAYER" }),
        h("p", { class: "turn-number" }, [h("span", { class: "turn-digits", text: String(view.turnNumber) }), h("span", { class: "turn-unit", text: "人目" })]),
        h("p", { class: "lead", text: view.shots.length ? `ここまで ${view.shots.length} 発撃たれています。` : "まだ一発も撃たれていません。" }),
        h("p", { class: "note", text: "押すと READY? のあと画像が出て、時計が動き出します。答えを知っている人は目をそらして。" }),
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

  // ---- 4. 回答（READY? → わかった！ → 入力） ----

  private showAnswer(): void {
    const { relay, source } = this.requireGame();
    const token = this.requireToken();
    const view = relay.publicView();
    const meter = createMeter();
    const stage = createStage(source, view.shots);
    const buzzed = view.buzzedAt !== null && view.shownAt !== null;

    const giveUp = (): void => {
      if (!window.confirm("ギブアップするとゲームが終わります。いいですか？")) return;
      this.guard(() => {
        relay.giveUp(token);
        this.token = null;
        this.persist();
        playDead();
        this.showEnd();
      })();
    };
    const giveUpButton = button("ギブアップ", giveUp, "danger");
    giveUpButton.classList.add("btn-small");

    const header = h("div", { class: "answer-head" }, [
      h("p", { class: "status-line" }, [
        h("strong", { text: turnLabel(view.turnNumber) }),
        view.shots.length ? `　${view.shots.length}発撃たれた画像` : "　まだ無傷の画像",
      ]),
      meter.element,
    ]);

    if (buzzed && view.shownAt !== null && view.buzzedAt !== null && view.power !== null) {
      meter.update(view.power, view.buzzedAt - view.shownAt);
      this.mount(screen("answer", [header, stage.element, this.answerForm(token, view.power, view.buzzedAt - view.shownAt), giveUpButton]));
      return;
    }

    const buzzButton = button("わかった！", () => buzz(), "primary");
    buzzButton.classList.add("btn-buzz");
    buzzButton.disabled = view.shownAt === null;
    const ticker = { frameId: 0 };
    const tick = (): void => {
      const shownAt = relay.publicView().shownAt;
      if (shownAt !== null) {
        const elapsed = Math.max(0, Date.now() - shownAt);
        meter.update(radiusFor(elapsed), elapsed);
      }
      ticker.frameId = requestAnimationFrame(tick);
    };
    meter.update(MAX_RADIUS, 0);

    const buzz = once(
      this.guard(() => {
        relay.buzz(token, Date.now());
        this.persist();
        playBuzz();
        this.showAnswer();
      }),
    );

    const startClock = (): void => {
      relay.startClock(token, Date.now());
      this.persist();
      stage.element.classList.remove("is-covered");
      buzzButton.disabled = false;
      ticker.frameId = requestAnimationFrame(tick);
    };

    const view$ = screen("answer", [header, stage.element, buzzButton, h("p", { class: "note", text: "読めた瞬間に押す。入力の時間は数えません。" }), giveUpButton]);
    if (view.shownAt === null) {
      // まだ見せていない：READY? の演出のあとで画像を出し、時計を動かす
      stage.element.classList.add("is-covered");
      const intro = h("div", { class: "intro", attrs: { "aria-live": "assertive" } }, [
        h("p", { class: "intro-ready", text: "READY?" }),
        h("p", { class: "intro-turn", text: turnLabel(view.turnNumber) }),
      ]);
      view$.append(intro);
      this.mount(view$);
      this.cleanup = (): void => cancelAnimationFrame(ticker.frameId);
      playReady();
      const reveal = async (): Promise<void> => {
        await wait(prefersReducedMotion() ? REDUCED_INTRO_MS : INTRO_MS);
        if (!view$.isConnected) return;
        intro.remove();
        view$.classList.add("is-flash");
        startClock();
      };
      void reveal();
      return;
    }
    // 再読み込みなどで戻ってきた：時計は最初に見せた時刻から進んだまま
    this.mount(view$);
    this.cleanup = (): void => cancelAnimationFrame(ticker.frameId);
    startClock();
  }

  private answerForm(token: string, power: number, elapsedMs: number): HTMLElement {
    const { relay } = this.requireGame();
    const input = h("input", {
      class: "answer-input",
      attrs: { type: "text", autocomplete: "off", autocapitalize: "off", spellcheck: "false", enterkeyhint: "done", placeholder: "答えを入力", "aria-label": "回答", "data-autofocus": "" },
    });
    const submit = once(
      this.guard(() => {
        const outcome = relay.submitAnswer(token, input.value);
        this.persist();
        if (outcome.correct) {
          playPass();
          this.showShoot();
          return;
        }
        this.token = null;
        this.persist();
        playDead();
        this.showEnd();
      }),
    );
    const form = h("form", { class: "answer-form" }, [
      h("p", { class: `power-banner power-${rankOf(power)}` }, [
        h("span", { class: "power-title", text: RANK_TITLE[rankOf(power)] }),
        h("span", { class: "power-detail", text: `${seconds(elapsedMs)}　弾 ${percent(power)}` }),
      ]),
      input,
      button("回答する", () => form.requestSubmit()),
    ]);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!input.value.trim()) {
        this.toast("答えを入力してください");
        return;
      }
      submit();
    });
    return form;
  }

  // ---- 5. 射撃 ----

  private showShoot(): void {
    const { relay, source } = this.requireGame();
    const token = this.requireToken();
    const view = relay.publicView();
    const power = view.power ?? MIN_RADIUS;
    const rank = rankOf(power);

    const stage = createStage(source, view.shots);
    const reticle = createReticle(power);
    stage.element.append(reticle);
    stage.element.classList.add("is-aiming");
    const burstCanvas = h("canvas", { class: "burst-canvas", attrs: { "aria-hidden": "true" } });
    const wrap = h("div", { class: "stage-wrap" }, [stage.element, burstCanvas]);
    const bangButton = button("BANG!", () => fire(), "primary");
    bangButton.classList.add("btn-bang");
    const aim: AimController = startAim(stage.element, stage.canvas, reticle, () => undefined);

    const fire = once(
      this.guard(async () => {
        const point: Point = aim.current();
        bangButton.disabled = true;
        const shot = relay.fireShot(token, point.x, point.y);
        this.token = null;
        this.persist();
        aim.stop();
        reticle.remove();
        stage.element.classList.remove("is-aiming");
        playShot(powerLevel(power));
        this.animateImpact(view$, stage.canvas, burstCanvas, source, view.shots, shot);
        await wait(AFTER_SHOT_MS);
        if (view$.isConnected) this.showHandoff();
      }),
    );

    const view$ = screen("shoot", [
      h("p", { class: `power-banner power-${rank}` }, [h("span", { class: "power-title", text: RANK_TITLE[rank] }), h("span", { class: "power-detail", text: `弾 ${percent(power)}` })]),
      h("p", { class: "lead", text: "画像をなぞって狙う。照準は少し揺れます。" }),
      wrap,
      h("div", { class: "actions" }, [bangButton]),
    ]);
    this.mount(view$);
    // mount() は前の画面の後片付けを呼ぶので、この画面の後片付けは mount の後に登録する
    this.cleanup = (): void => aim.stop();
  }

  /** 着弾：穴が広がる・衝撃波と破片・画面の揺れ・BANG! の文字 */
  private animateImpact(view: HTMLElement, canvas: HTMLCanvasElement, burstCanvas: HTMLCanvasElement, source: HTMLCanvasElement, before: readonly Shot[], shot: Shot): void {
    const burst = shotBurst(shot);
    const stageRect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const size = stageRect.width * ratio;
    const bleed = size * BURST_BLEED;
    const side = String(Math.round(size + bleed + bleed));
    burstCanvas.setAttribute("width", side);
    burstCanvas.setAttribute("height", side);
    const box = { left: bleed, top: bleed, size };

    view.style.setProperty("--shake", String(powerLevel(shot.radius)));
    if (!prefersReducedMotion()) view.classList.add("is-shaking");
    view.append(h("p", { class: `bang-stamp bang-${rankOf(shot.radius)}`, text: "BANG!", attrs: { "aria-hidden": "true" } }));

    const startedAt = performance.now();
    const frame = (now: number): void => {
      const elapsed = now - startedAt;
      const grow = Math.min(1, elapsed / fx.hole.growMs);
      drawDamaged(canvas, source, [...before, { ...shot, radius: shot.radius * grow }]);
      const ctx = burstCanvas.getContext("2d");
      ctx?.clearRect(0, 0, burstCanvas.width, burstCanvas.height);
      drawBurst(burstCanvas, burst, elapsed, box);
      if (elapsed < BURST_MS && burstCanvas.isConnected) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // ---- 6. 受け渡し（PASS IT ON!） ----

  private lastShot(): Shot | null {
    const shots = this.requireGame().relay.publicView().shots;
    return shots[shots.length - 1] ?? null;
  }

  private showHandoff(): void {
    const { relay } = this.requireGame();
    const view = relay.publicView();
    const shot = this.lastShot();
    this.mount(
      screen("handoff", [
        h("div", { class: "sweeps" }, [
          sweep(shot ? shotLabel(shot.turnNumber) : "SHOT", "left", "shot"),
          sweep("NEXT PLAYER!", "right", "next"),
        ]),
        h("p", { class: "handoff-title" }, [h("span", { text: "PASS IT" }), h("span", { text: "ON!" })]),
        h("p", { class: "lead", text: `答えは言わずに、${view.turnNumber}人目の人へ端末を渡してください。` }),
        h("div", { class: "actions" }, [
          button("渡した", () => this.showReceive()),
          shot ? button("この一発をシェア", () => this.showShotShare(shot), "ghost") : null,
        ]),
      ]),
    );
  }

  /** 1 発分の短い動画を作って共有する。答えは出さない。 */
  private showShotShare(shot: Shot): void {
    const { source, relay } = this.requireGame();
    const view = relay.publicView();
    const before = view.shots.filter((other) => other.turnNumber < shot.turnNumber);
    const shotCount = before.length + 1;
    const meta = { turnNumber: shot.turnNumber, shotCount };
    const canvas = createFrameCanvas();
    canvas.classList.add("replay-canvas");
    canvas.setAttribute("aria-label", `${shotLabel(shot.turnNumber)} の動画`);
    const composer = createShotClipComposer(source, before, shot, meta);
    const draw: Drawer = (elapsed) => composer(canvas, elapsed);
    const text = `${shotLabel(shot.turnNumber)} 💥 ${shotCount}発撃たれたこの画像、読める？\n次はあなたの番。 ${HASHTAG}`;

    const loop = async (): Promise<void> => {
      // 共有ボタンを押して録画が始まるまで、繰り返し再生して見せる
      const playback = play(draw, SHOT_CLIP_MS, () => DEFAULT_SPEED);
      this.playback = playback;
      await playback.finished;
      await wait(MS_PER_SECOND);
      if (canvas.isConnected && this.playback === playback && !actions.isRecording()) void loop();
    };
    const actions = this.shareActions({
      planVideo: (target) => {
        // プレビューとは別の描画担当を作る（作業用キャンバスを取り合わないように）
        const exporter = createShotClipComposer(source, before, shot, meta);
        return { draw: (elapsed) => exporter(target, elapsed), durationMs: SHOT_CLIP_MS, cues: clipSoundCues(powerLevel(shot.radius)) };
      },
      poster: () => composeShotCard(source, before, shot, meta),
      filename: `read-or-dead-shot-${shot.turnNumber}`,
      text,
      back: () => this.showHandoff(),
      backLabel: "戻る",
      resume: () => void loop(),
    });

    this.mount(
      screen("share", [
        h("p", { class: "status-line", text: "共有する人だけ見てください。次の人には見せないで。" }),
        h("div", { class: "replay-frame" }, [canvas]),
        actions.element,
      ]),
    );
    void loop();
  }

  /** 動画で共有（音あり／なし）・画像で保存・投稿文コピー・X で投稿 */
  private shareActions(options: {
    readonly planVideo: (target: HTMLCanvasElement) => VideoPlan;
    readonly poster: () => HTMLCanvasElement;
    readonly filename: string;
    readonly text: string;
    readonly back: () => void;
    readonly backLabel: string;
    /** 書き出しの間止めていたプレビューを再開する */
    readonly resume: () => void;
  }): { readonly element: HTMLElement; readonly isRecording: () => boolean } {
    const busy = { recording: false, sound: loadVideoSound() };
    const videoAvailable = canMakeVideo();
    const fullText = `${options.text}
${siteUrl()}`;
    const videoButton = button("動画で共有", () => saveVideo());
    const soundButtons = ([true, false] as const).map((withSound) => {
      const soundButton = button(withSound ? "音あり" : "音なし", () => {
        busy.sound = withSound;
        saveVideoSound(withSound);
        soundButtons.forEach((other, index) => other.setAttribute("aria-pressed", String(!index === withSound)));
      }, "ghost");
      soundButton.classList.add("speed");
      soundButton.setAttribute("aria-pressed", String(withSound === busy.sound));
      return soundButton;
    });
    const imageButton = button("画像で保存", () => saveImage(), videoAvailable ? "ghost" : "primary");
    const lockable = [videoButton, imageButton, ...soundButtons];
    const lock = (locked: boolean): void => lockable.forEach((control) => control.toggleAttribute("disabled", locked));

    const saveVideo = this.guard(async () => {
      if (busy.recording) return;
      busy.recording = true;
      lock(true);
      videoButton.textContent = "動画を作っています…";
      this.playback?.stop();
      try {
        // 書き出し処理（mediabunny）は重いので、使うときに初めて読み込む
        const { encodeVideo } = await import("./replay/encode");
        const target = createFrameCanvas();
        const plan = options.planVideo(target);
        const video = await encodeVideo({
          canvas: target,
          draw: plan.draw,
          durationMs: plan.durationMs,
          cues: busy.sound ? plan.cues : null,
          onProgress: (ratio) => {
            videoButton.textContent = ratio ? `動画を作っています… ${Math.round(ratio * PERCENT)}%` : "録画しています…";
          },
        });
        videoButton.textContent = "共有しています…";
        const outcome = await shareOrDownload(video.blob, `${options.filename}.${video.extension}`, fullText);
        if (outcome === "downloaded") this.toast(`動画を保存しました（${describeVideo(video)}）`);
        if (outcome === "shared") this.toast(`動画を共有しました（${describeVideo(video)}）`);
      } finally {
        busy.recording = false;
        lock(false);
        videoButton.textContent = "動画で共有";
        if (videoButton.isConnected) options.resume();
      }
    });
    const saveImage = this.guard(async () => {
      const blob = await canvasToBlob(options.poster());
      const outcome = await shareOrDownload(blob, `${options.filename}.png`, fullText);
      if (outcome === "downloaded") this.toast("画像を保存しました");
    });
    const copy = this.guard(async () => {
      await copyText(fullText);
      this.toast("投稿文をコピーしました");
    });
    const xLink = h("a", {
      class: "btn btn-ghost btn-link",
      text: "X で投稿",
      attrs: { href: xIntentUrl(options.text, siteUrl()), target: "_blank", rel: "noopener" },
    });
    const element = h("div", { class: "actions" }, [
      videoAvailable
        ? h("div", { class: "speed-row", attrs: { role: "group", "aria-label": "動画の効果音" } }, [h("span", { class: "speed-label", text: "動画の音" }), ...soundButtons])
        : null,
      videoAvailable ? videoButton : h("p", { class: "note", text: "この端末では動画を作れないため、画像で保存できます。" }),
      imageButton,
      h("div", { class: "actions-row" }, [button("投稿文をコピー", copy, "ghost"), xLink]),
      h("p", { class: "note", text: "X に直接添付できないときは、保存した動画を X の投稿画面で添えてください。" }),
      button(options.backLabel, options.back, "ghost"),
    ]);
    return { element, isRecording: (): boolean => busy.recording };
  }

  // ---- 7. 終了 ----

  private resultMeta(): { readonly meta: ReplayMeta; readonly result: RelayResult } {
    const { relay, question } = this.requireGame();
    const result = relay.result();
    return { result, meta: { answer: displayAnswer(question), shotCount: result.shots.length, survivors: result.survivors } };
  }

  private showEnd(): void {
    const { source } = this.requireGame();
    const { result, meta } = this.resultMeta();
    const headline = result.endedBy === "give-up" ? "ギブアップ。" : "読めなかった。";
    const biggest = result.shots.reduce<Shot | null>((best, shot) => (!best || shot.radius > best.radius ? shot : best), null);
    const stats: readonly (readonly [string, string])[] = [
      ["挑戦した人", `${result.turns.length}人`],
      ["読めた人", `${result.survivors}人`],
      ["撃った数", `${result.shots.length}発`],
      ["最大の一発", biggest ? `${shotLabel(biggest.turnNumber)}（${percent(biggest.radius)}）` : "なし"],
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
    const draw: Drawer = (elapsed) => composer(canvas, frameAt(result.shots, elapsed));
    const duration = replayDuration(result.shots.length);
    const actions = this.shareActions({
      planVideo: (target) => {
        // 書き出しは選んでいる再生速度で。時間も効果音もその速度に合わせて縮める
        const speed = this.speed;
        const exporter = createComposer(source, meta);
        return {
          draw: (elapsed) => exporter(target, frameAt(result.shots, elapsed * speed)),
          durationMs: duration / speed,
          cues: replaySoundCues(result.shots.length).map((cue) => ({ ...cue, atMs: cue.atMs / speed })),
        };
      },
      poster: () => composePoster(source, result.shots, meta),
      filename: "read-or-dead",
      text: `READ OR DEAD 💀 ${result.survivors}人が読んで${result.shots.length}発で力尽きた。何発目で分かった？ ${HASHTAG}`,
      back: () => this.showEnd(),
      backLabel: "結果に戻る",
      resume: () => restart(),
    });

    const restart = (): void => {
      if (actions.isRecording()) return;
      this.playback?.stop();
      this.playback = play(draw, duration, () => this.speed);
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

    this.mount(
      screen("replay", [
        h("div", { class: "replay-frame" }, [canvas]),
        h("div", { class: "speed-row", attrs: { role: "group", "aria-label": "再生速度" } }, speedButtons),
        button("もう一度再生", restart, "ghost"),
        actions.element,
      ]),
    );
    restart();
  }
}
