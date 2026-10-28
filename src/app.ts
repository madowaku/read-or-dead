// 画面遷移。
// ローカルモード（同じ端末を回して遊ぶ）：READY? → 早押し（わかった！）→ 回答 → 照準で BANG! → PASS IT ON → 次の人。
// オンライン（URL リレー）：挑戦ページ → READY? → 早押し → 回答 → BANG! → 自分の一発の URL を投稿。
// 回答と射撃の画面は Turn を通して両方で使う。

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
  findQuestion,
  pickFresh,
} from "./game/questions";
import { OnlineError, act, claim, createTree, fetchNode, parseChallengePath, savedAttempt, type SavedAttempt } from "./online/client";
import { ANSWER_LIMIT_MS, challengePath, isFailure, type AttemptState, type OnlinePool } from "./online/protocol";
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
import { startSweepAim, type AimController, type AimStep } from "./ui/aim";
import { button, h, once } from "./ui/dom";
import { createReticle, createStage, revealHole, type Point } from "./ui/stage";

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
  // 端末ごとの書き出し方法の違いを確かめられるよう、方法も出す
  const method = video.method === "webcodecs" ? "高速書き出し" : "録画";
  return `${size}MB・${video.hasAudio ? "音あり" : "音なし"}・${method}・${video.extension.toUpperCase()}`;
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

const AIM_STEP_LABEL: Readonly<Record<AimStep, string>> = {
  x: "① 動く縦線を、狙う横位置でタップ",
  y: "② 動く横線を、狙う縦位置でタップで発射！",
  done: "BANG!",
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

/** 回答・射撃の画面に見せる、いまのターンの様子 */
interface TurnView {
  readonly turnNumber: number;
  readonly shots: readonly Shot[];
  /** 画像を見せ始めた時刻（この端末の時計） */
  readonly shownAt: number | null;
  readonly buzzedAt: number | null;
  readonly power: number | null;
}

/** 1 人分の挑戦。ローカル（LocalRelay）とオンライン（API）で同じ画面を使うための窓口 */
interface Turn {
  readonly source: HTMLCanvasElement;
  readonly view: () => TurnView;
  /** 画像を見せた。オンラインではサーバーの時計が先に動いているので何もしない */
  readonly startClock: () => void;
  readonly buzz: () => Promise<void>;
  /** 正解なら true */
  readonly answer: (input: string) => Promise<boolean>;
  readonly giveUp: () => Promise<void>;
  readonly fire: (point: Point) => Promise<Shot>;
  readonly afterShot: () => void;
  readonly afterFail: () => void;
  readonly giveUpPrompt: string;
  readonly note: string;
}

/** オンラインの 1 回の挑戦 */
interface OnlineRun {
  readonly treeId: string;
  readonly attempt: SavedAttempt;
  readonly state: AttemptState;
  readonly source: HTMLCanvasElement;
  /** 画像を見せ始めた時刻（この端末の時計） */
  readonly shownAt: number;
  /** 問題を受け取ってから画面に出すまでにかかった時間。サーバーはこの分を早押しの時間から差し引く */
  readonly renderMs: number;
}

/** すでに別の画面へ移ったので、エラーとして知らせなくてよい */
class Redirected extends Error {}

const ONLINE_POOLS: readonly OnlinePool[] = ["kanji", "word", "silhouette", "all"];
/** GitHub Pages 版にはサーバーがないので、URL リレーは出さない */
const ONLINE_AVAILABLE = import.meta.env.MODE !== "pages";

const ONLINE_ERROR_MESSAGE: Readonly<Partial<Record<OnlineError["code"], string>>> = {
  network: "通信できませんでした。電波のよい所でもう一度試してください。",
  "already-played": "この問題にはもう挑戦しました。挑戦できるのは1回だけです。",
  "tree-not-found": "この挑戦ページは見つかりませんでした。",
  "node-not-found": "この挑戦ページは見つかりませんでした。",
  expired: "時間切れになりました。",
  "tree-full": "この問題は枝が増えすぎたため、これ以上撃てません。",
  "rate-limited": "新しい問題を続けて作りすぎました。1分ほど待ってから試してください。",
};

const FAILURE_HEADLINE: Readonly<Record<"wrong" | "give-up" | "expired", string>> = {
  wrong: "読めなかった。",
  "give-up": "ギブアップ。",
  expired: "時間切れ。",
};

function screen(name: string, children: readonly (Node | null | false)[]): HTMLElement {
  return h("main", { class: `screen screen-${name}` }, children);
}

function resumeLabel(chain: Chain): string {
  if (chain.status === "active") return `続きから（${chain.turnNumber}人目）`;
  return "前回の結果を見る";
}

function errorMessage(err: unknown): string {
  if (err instanceof RelayError) return "この操作はもうできません。画面を進めてください。";
  if (err instanceof OnlineError) return ONLINE_ERROR_MESSAGE[err.code] ?? "この操作はもうできません。ページを読み込み直してください。";
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

/** READY? の演出。終わったら呼び出し側で取り除く */
function readyIntro(turnNumber: number): HTMLElement {
  return h("div", { class: "intro", attrs: { "aria-live": "assertive" } }, [
    h("p", { class: "intro-ready", text: "READY?" }),
    h("p", { class: "intro-turn", text: turnLabel(turnNumber) }),
  ]);
}

/** 投稿文。短く、答えは書かない */
function postText(turnNumber: number, buzzMs: number | null): string {
  const time = buzzMs === null ? "" : `（⚡${seconds(buzzMs)}）`;
  return `${turnLabel(turnNumber)} 突破${time}\n次はあなた。読める？ ${HASHTAG}`;
}

/** リンクカードと同じ画像（撃たれた穴の位置だけ）。SNS で見たカードとつながるように */
function cardImage(treeId: string, nodeId: string): HTMLElement {
  return h("img", {
    class: "card-preview",
    attrs: { src: `/card/${treeId}/${nodeId}.png`, alt: "撃たれた穴の位置", width: "1200", height: "630", decoding: "async" },
  });
}

/** 目立たせない操作（戻る・おまけ） */
function textButton(label: string, onClick: () => void): HTMLButtonElement {
  return h("button", { class: "text-button", text: label, attrs: { type: "button" }, on: { click: onClick } });
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
    window.addEventListener("popstate", () => this.route());
    this.route();
  }

  /** URL に合わせて最初の画面を選ぶ。"/r/<木>/<ノード>" なら挑戦ページ */
  private route(): void {
    const challenge = ONLINE_AVAILABLE ? parseChallengePath(location.pathname) : null;
    if (challenge) {
      this.guard(() => this.showChallenge(challenge.treeId, challenge.nodeId))();
      return;
    }
    this.showTitle();
  }

  private goTo(path: string): void {
    if (location.pathname !== path) history.pushState(null, "", path);
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
          if (err instanceof Redirected) return;
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
    if (ONLINE_AVAILABLE) this.goTo("/");
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
          ONLINE_AVAILABLE ? button("URLでリレー", () => this.showOnlineSetup()) : null,
          button(ONLINE_AVAILABLE ? "1台を回して遊ぶ" : "START", () => this.showSetup(), ONLINE_AVAILABLE ? "ghost" : "primary"),
          savedLabel ? button(savedLabel, this.guard(() => this.resume()), "ghost") : null,
          button("遊び方", () => this.showHowTo(), "ghost"),
          soundButton,
        ]),
      ]),
    );
  }

  private showHowTo(): void {
    const steps = [
      "「URLでリレー」は、撃った後の画像に挑戦するURLをSNSに投稿して、知らない人とつなぐ遊び方です。同じURLから何人でも挑戦でき、正解して撃った人の数だけ枝分かれします。挑戦できるのは1つの問題につき1回だけ。",
      "「1台を回して遊ぶ」は、1台のスマホを順番に回して遊びます。",
      "画像が出たら、読めた瞬間に「わかった！」。早く押すほど弾が大きくなります（0秒で12%、15秒で6%）。",
      "それから答えを入力。チャンスは1回。入力の速さは弾の大きさに関係ありません。",
      "正解したら撃つ番。左右に動く縦線をタップで止めて横位置を決め、次に上下に動く横線をタップで止めると発射。大きい弾ほど線が速く動きます。",
      "撃たれた所は白くなって、最初からそうだったように見えます。「犬」の点を消して「大」と読ませる、みたいな意地悪な一発を狙おう。",
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
    if (this.token && view.turnStatus === "claimed") return this.showAnswer(this.localTurn());
    if (this.token && view.turnStatus === "correct") return this.showShoot(this.localTurn());
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
        this.showAnswer(this.localTurn());
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

  /** ローカルモードの今のターン */
  private localTurn(): Turn {
    const { relay, source } = this.requireGame();
    const token = this.requireToken();
    return {
      source,
      view: () => relay.publicView(),
      startClock: () => {
        relay.startClock(token, Date.now());
        this.persist();
      },
      buzz: async () => {
        relay.buzz(token, Date.now());
        this.persist();
      },
      answer: async (input) => {
        const { correct } = relay.submitAnswer(token, input);
        if (!correct) this.token = null;
        this.persist();
        return correct;
      },
      giveUp: async () => {
        relay.giveUp(token);
        this.token = null;
        this.persist();
      },
      fire: async (point) => {
        const shot = relay.fireShot(token, point.x, point.y);
        this.token = null;
        this.persist();
        return shot;
      },
      afterShot: () => this.showHandoff(),
      afterFail: () => this.showEnd(),
      giveUpPrompt: "ギブアップするとゲームが終わります。いいですか？",
      note: "読めた瞬間に押す。入力の時間は数えません。",
    };
  }

  private showAnswer(turn: Turn): void {
    const { source } = turn;
    const view = turn.view();
    const meter = createMeter();
    const stage = createStage(source, view.shots, "paper");
    const buzzed = view.buzzedAt !== null && view.shownAt !== null;

    const giveUp = (): void => {
      if (!window.confirm(turn.giveUpPrompt)) return;
      this.guard(async () => {
        await turn.giveUp();
        playDead();
        turn.afterFail();
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
      this.mount(screen("answer", [header, stage.element, this.answerForm(turn, view.power, view.buzzedAt - view.shownAt), giveUpButton]));
      return;
    }

    const buzzButton = button("わかった！", () => buzz(), "primary");
    buzzButton.classList.add("btn-buzz");
    buzzButton.disabled = view.shownAt === null;
    const ticker = { frameId: 0 };
    const tick = (): void => {
      const shownAt = turn.view().shownAt;
      if (shownAt !== null) {
        const elapsed = Math.max(0, Date.now() - shownAt);
        meter.update(radiusFor(elapsed), elapsed);
      }
      ticker.frameId = requestAnimationFrame(tick);
    };
    meter.update(MAX_RADIUS, 0);

    const buzz = once(
      this.guard(async () => {
        playBuzz();
        await turn.buzz();
        this.showAnswer(turn);
      }),
    );

    const startClock = (): void => {
      turn.startClock();
      stage.element.classList.remove("is-covered");
      buzzButton.disabled = false;
      ticker.frameId = requestAnimationFrame(tick);
    };

    const view$ = screen("answer", [header, stage.element, buzzButton, h("p", { class: "note", text: turn.note }), giveUpButton]);
    if (view.shownAt === null) {
      // まだ見せていない：READY? の演出のあとで画像を出し、時計を動かす
      stage.element.classList.add("is-covered");
      const intro = readyIntro(view.turnNumber);
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
    // 再読み込みやオンラインの READY? のあと：時計は最初に見せた時刻から進んだまま
    this.mount(view$);
    this.cleanup = (): void => cancelAnimationFrame(ticker.frameId);
    startClock();
  }

  private answerForm(turn: Turn, power: number, elapsedMs: number): HTMLElement {
    const input = h("input", {
      class: "answer-input",
      attrs: { type: "text", autocomplete: "off", autocapitalize: "off", spellcheck: "false", enterkeyhint: "done", placeholder: "答えを入力", "aria-label": "回答", "data-autofocus": "" },
    });
    const submit = once(
      this.guard(async () => {
        if (await turn.answer(input.value)) {
          playPass();
          this.showShoot(turn);
          return;
        }
        playDead();
        turn.afterFail();
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

  private showShoot(turn: Turn): void {
    const { source } = turn;
    const view = turn.view();
    const power = view.power ?? MIN_RADIUS;
    const rank = rankOf(power);

    const stage = createStage(source, view.shots, "paper");
    const reticle = createReticle(power);
    stage.element.append(reticle);
    stage.element.classList.add("is-aiming");
    const burstCanvas = h("canvas", { class: "burst-canvas", attrs: { "aria-hidden": "true" } });
    const wrap = h("div", { class: "stage-wrap" }, [stage.element, burstCanvas]);
    const stepLabel = h("p", { class: "aim-step", attrs: { "aria-live": "polite" } });
    const tapPad = h("div", { class: "tap-pad", text: "TAP!", attrs: { "aria-hidden": "true" } });

    const target: { point: Point | null } = { point: null };
    const fire = once(
      this.guard(async () => {
        const point = target.point;
        if (!point) return;
        aim.stop();
        reticle.remove();
        stage.element.classList.remove("is-aiming");
        playShot(powerLevel(power));
        // オンラインでは撃った位置をサーバーに送ってから着弾させる（弾の大きさはサーバーが決める）
        const shot = await turn.fire(point);
        this.animateImpact(view$, stage.canvas, burstCanvas, source, view.shots, shot);
        await wait(AFTER_SHOT_MS);
        if (view$.isConnected) turn.afterShot();
      }),
    );

    const view$ = screen("shoot", [
      h("p", { class: `power-banner power-${rank}` }, [h("span", { class: "power-title", text: RANK_TITLE[rank] }), h("span", { class: "power-detail", text: `弾 ${percent(power)}` })]),
      stepLabel,
      wrap,
      tapPad,
    ]);
    const aim: AimController = startSweepAim({
      tapArea: view$,
      stage: stage.element,
      reticle,
      radius: power,
      onStep: (step) => {
        stepLabel.textContent = AIM_STEP_LABEL[step];
        tapPad.textContent = step === "done" ? "BANG!" : "TAP!";
        if (step === "y") playBuzz();
      },
      onFire: (point) => {
        target.point = point;
        fire();
      },
    });
    this.mount(view$);
    // mount() は前の画面の後片付けを呼ぶので、この画面の後片付けは mount の後に登録する
    this.cleanup = (): void => aim.stop();
  }

  /** 着弾：穴が広がる・一瞬だけ穴を見せる・衝撃波と破片・画面の揺れ・BANG! の文字 */
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
    // 当たった手応えのため、一瞬だけ穴を市松模様で見せてから白になじませる
    if (canvas.parentElement) revealHole(canvas.parentElement, shot, shot.radius, fx.hole.revealMs);

    const startedAt = performance.now();
    const frame = (now: number): void => {
      const elapsed = now - startedAt;
      // requestAnimationFrame の時刻は描き始めた時刻より少し前のことがあるので、0 未満にしない
      const grow = Math.min(1, Math.max(0, elapsed / fx.hole.growMs));
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
          shot ? button("この一発をシェア", () => this.showLocalShotShare(shot), "ghost") : null,
        ]),
      ]),
    );
  }

  private showLocalShotShare(shot: Shot): void {
    const { source, relay } = this.requireGame();
    const before = relay.publicView().shots.filter((other) => other.turnNumber < shot.turnNumber);
    const text = `${shotLabel(shot.turnNumber)} 💥 ${before.length + 1}発撃たれたこの画像、読める？\n次はあなたの番。 ${HASHTAG}`;
    this.showShotShare({ source, before, shot, text, url: siteUrl(), back: () => this.showHandoff() });
  }

  /** 1 発分の短い動画を作って共有する。答えは出さない。 */
  private showShotShare(options: {
    readonly source: HTMLCanvasElement;
    readonly before: readonly Shot[];
    readonly shot: Shot;
    readonly text: string;
    readonly url: string;
    readonly back: () => void;
  }): void {
    const { source, before, shot, text } = options;
    const shotCount = before.length + 1;
    const meta = { turnNumber: shot.turnNumber, shotCount };
    const canvas = createFrameCanvas();
    canvas.classList.add("replay-canvas");
    canvas.setAttribute("aria-label", `${shotLabel(shot.turnNumber)} の動画`);
    const composer = createShotClipComposer(source, before, shot, meta);
    const draw: Drawer = (elapsed) => composer(canvas, elapsed);

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
      url: options.url,
      back: options.back,
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
    /** 投稿文に添える URL（オンラインでは挑戦ページ） */
    readonly url: string;
    readonly back: () => void;
    readonly backLabel: string;
    /** 書き出しの間止めていたプレビューを再開する */
    readonly resume: () => void;
  }): { readonly element: HTMLElement; readonly isRecording: () => boolean } {
    const busy = { recording: false, sound: loadVideoSound() };
    const videoAvailable = canMakeVideo();
    const fullText = `${options.text}
${options.url}`;
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
      attrs: { href: xIntentUrl(options.text, options.url), target: "_blank", rel: "noopener" },
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
    const replay = (): void =>
      this.showReplay({
        source,
        shots: result.shots,
        meta,
        text: `READ OR DEAD 💀 ${result.survivors}人が読んで${result.shots.length}発で力尽きた。何発目で分かった？ ${HASHTAG}`,
        url: siteUrl(),
        back: () => this.showEnd(),
      });
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
          button("リプレイを見る", replay),
          button("もう一度遊ぶ", () => this.showSetup(), "ghost"),
          button("タイトルへ", () => this.showTitle(), "ghost"),
        ]),
      ]),
    );
  }

  // ---- 8. リプレイ ----

  private showReplay(options: {
    readonly source: HTMLCanvasElement;
    readonly shots: readonly Shot[];
    readonly meta: ReplayMeta;
    readonly text: string;
    readonly url: string;
    readonly back: () => void;
  }): void {
    const { source, meta } = options;
    const result = { shots: options.shots };
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
      text: options.text,
      url: options.url,
      back: options.back,
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

  // ---- 9. URL リレー（オンライン） ----

  private showOnlineSetup(): void {
    const pick = (pool: OnlinePool): (() => void) =>
      once(
        this.guard(async () => {
          const tree = await createTree(pool);
          this.goTo(challengePath(tree.treeId, tree.nodeId));
          await this.showChallenge(tree.treeId, tree.nodeId);
        }),
      );
    const choices = ONLINE_POOLS.map((pool) => {
      const choice = button(POOLS[pool].label, pick(pool));
      choice.append(h("span", { class: "choice-count", text: `${POOLS[pool].questions.length}問` }));
      return choice;
    });
    this.mount(
      screen("setup", [
        h("h2", { class: "heading", text: "URLでリレー" }),
        h("p", { class: "lead", text: "問題はおまかせで選ばれます。あなたも答えを知らないまま、1人目として挑戦します。" }),
        h("p", { class: "note", text: "正解して撃ったら、その一発のURLをSNSに投稿。開いた人が続きに挑戦します。" }),
        h("div", { class: "choices" }, choices),
        h("div", { class: "actions" }, [button("戻る", () => this.showTitle(), "ghost")]),
      ]),
    );
  }

  private showLoading(text: string): void {
    this.mount(screen("receive", [h("p", { class: "lead", text })]));
  }

  private showOnlineMessage(title: string, text: string): void {
    this.mount(
      screen("receive", [
        h("h2", { class: "heading", text: title }),
        h("p", { class: "lead", text }),
        h("div", { class: "actions" }, [
          button("新しい問題でリレーを始める", () => this.showOnlineSetup()),
          button("タイトルへ", () => this.showTitle(), "ghost"),
        ]),
      ]),
    );
  }

  /** 挑戦ページ（/r/<木>/<ノード>）。SNS から来た人が最初に見る。問題の中身はまだ見せない */
  private async showChallenge(treeId: string, nodeId: string): Promise<void> {
    this.showLoading("読み込んでいます…");
    const node = await fetchNode(treeId, nodeId).catch((err: unknown) => {
      if (err instanceof OnlineError && err.code !== "network") {
        this.showOnlineMessage("見つかりません", errorMessage(err));
        throw new Redirected();
      }
      throw err;
    });
    const mine = node.myAttempt;
    if (mine && mine.status !== "claimed") {
      const saved = savedAttempt(treeId);
      if (!saved || saved.attemptId !== mine.attemptId) {
        this.showOnlineMessage("挑戦済み", "この問題には1回挑戦できます。もう挑戦しました。");
        return;
      }
      await this.resumeOnline(treeId, saved);
      return;
    }

    const turnNumber = node.depth + 1;
    const challenge = once(
      this.guard(async () => {
        await claim(treeId, nodeId);
        const saved = savedAttempt(treeId);
        if (!saved) throw new OnlineError("network");
        await this.startOnline(treeId, saved, turnNumber);
      }),
    );
    const steps = ["読めたらタップ", "答える", "撃って次へ"];
    this.mount(
      screen("challenge", [
        h("p", { class: "kicker", text: `${turnLabel(turnNumber)}｜${node.depth ? `${node.depth}発撃たれた画像` : "まだ無傷の画像"}` }),
        h("h2", { class: "posted-title", text: "あなたは読める？" }),
        cardImage(treeId, nodeId),
        h(
          "ol",
          { class: "steps" },
          steps.map((step) => h("li", { text: step })),
        ),
        h("div", { class: "actions" }, [
          button("挑戦する", challenge),
          h("p", { class: "fine", text: `1回だけ・制限時間${ANSWER_LIMIT_MS / MS_PER_SECOND}秒` }),
          h("div", { class: "text-links" }, [textButton("遊び方", () => this.showHowTo()), textButton("タイトルへ", () => this.showTitle())]),
        ]),
      ]),
    );
  }

  /** READY? の演出のあとでサーバーの時計を動かし、問題を受け取ってから見せる */
  private async startOnline(treeId: string, attempt: SavedAttempt, turnNumber: number): Promise<void> {
    const view$ = screen("answer", [readyIntro(turnNumber)]);
    this.mount(view$);
    playReady();
    await wait(prefersReducedMotion() ? REDUCED_INTRO_MS : INTRO_MS);
    const state = await act(treeId, attempt, "start");
    await this.resumeOnline(treeId, attempt, state, Date.now());
  }

  /**
   * 挑戦の状態に合わせて画面を選ぶ（再読み込みで戻ってきたときも）。
   * startedAt：READY? のあと問題を受け取った時刻。このときは画像を描いて画面に出した瞬間から時計を数える。
   */
  private async resumeOnline(treeId: string, attempt: SavedAttempt, known?: AttemptState, startedAt?: number): Promise<void> {
    const state = known ?? (await act(treeId, attempt, "state"));
    const receivedAt = startedAt ?? Date.now();
    const question = state.questionKey ? findQuestion(state.questionKey) : undefined;
    if (state.status === "claimed" || !question) {
      await this.showChallenge(treeId, state.nodeId);
      return;
    }
    const source = await createSource(question);
    const now = Date.now();
    // 再読み込みで戻ってきたときは、サーバーの時計のまま進める
    const shownAt = startedAt === undefined ? receivedAt - (state.elapsedMs ?? 0) : now;
    const run: OnlineRun = { treeId, attempt, state, source, shownAt, renderMs: startedAt === undefined ? 0 : now - receivedAt };
    if (state.status === "started" || state.status === "buzzed") this.showAnswer(this.onlineTurn(run));
    if (state.status === "correct") this.showShoot(this.onlineTurn(run));
    if (state.status === "shot") this.showPosted(run);
    if (isFailure(state.status)) this.showOnlineEnd(run);
  }

  private onlineTurn(run: OnlineRun): Turn {
    // サーバーから返ってきた最新の状態
    const live = { state: run.state };
    const latest = (): OnlineRun => ({ ...run, state: live.state });
    const update = async (action: "buzz" | "answer" | "give-up" | "shoot", extra: object = {}): Promise<AttemptState> => {
      try {
        live.state = await act(run.treeId, run.attempt, action, extra);
        return live.state;
      } catch (err) {
        if (!(err instanceof OnlineError) || err.code !== "expired") throw err;
        // 制限時間を過ぎていたら、結果の画面へ
        live.state = await act(run.treeId, run.attempt, "state");
        playDead();
        this.showOnlineEnd(latest());
        throw new Redirected();
      }
    };
    return {
      source: run.source,
      view: () => ({
        turnNumber: live.state.turnNumber,
        shots: live.state.shots,
        shownAt: run.shownAt,
        buzzedAt: live.state.buzzMs === null ? null : run.shownAt + live.state.buzzMs,
        power: live.state.radius,
      }),
      startClock: () => undefined,
      buzz: async () => {
        await update("buzz", { clientMs: Date.now() - run.shownAt, renderMs: run.renderMs });
      },
      answer: async (input) => (await update("answer", { answer: input })).status === "correct",
      giveUp: async () => {
        await update("give-up");
      },
      fire: async (point) => {
        const { shot } = await update("shoot", { x: point.x, y: point.y });
        if (!shot) throw new OnlineError("bad-state");
        return shot;
      },
      afterShot: () => this.showPosted(latest()),
      afterFail: () => this.showOnlineEnd(latest()),
      giveUpPrompt: "ギブアップすると、この問題には挑戦できなくなります。いいですか？",
      note: `読めた瞬間に押す。入力の時間は数えません。答えるまでの制限時間は${ANSWER_LIMIT_MS / MS_PER_SECOND}秒。`,
    };
  }

  /** 撃ったあと：自分の一発の挑戦 URL を投稿する。主役はリンクカードと「X で投稿」の 1 つだけ */
  private showPosted(run: OnlineRun): void {
    const { state } = run;
    const shot = state.shot;
    const childId = state.childNodeId;
    if (!shot || !childId) {
      this.showTitle();
      return;
    }
    const url = new URL(challengePath(run.treeId, childId), location.origin).href;
    const text = postText(state.turnNumber, state.buzzMs);
    const fullText = `${text}\n${url}`;

    const copy = this.guard(async () => {
      await copyText(fullText);
      this.toast("コピーしました");
    });
    const shareLink = this.guard(async () => {
      try {
        await navigator.share({ text, url });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        await copyText(fullText);
        this.toast("共有できなかったので、コピーしました");
      }
    });
    const xLink = h("a", { class: "btn btn-primary btn-link", text: "X に投稿", attrs: { href: xIntentUrl(text, url), target: "_blank", rel: "noopener" } });
    const video = (): void =>
      this.showShotShare({ source: run.source, before: state.shots, shot, text, url, back: () => this.showPosted(run) });

    this.mount(
      screen("posted", [
        h("p", { class: "kicker", text: `${shotLabel(state.turnNumber)}　弾 ${percent(shot.radius)}` }),
        h("h2", { class: "posted-title", text: "次の人に読ませよう" }),
        cardImage(run.treeId, childId),
        h("p", { class: "fine", text: "投稿にはこのカードが付きます。答えは出ません。" }),
        h("div", { class: "actions" }, [
          xLink,
          h("div", { class: "actions-row" }, [
            typeof navigator.share === "function" ? button("ほかで共有", shareLink, "ghost") : null,
            button("コピー", copy, "ghost"),
          ]),
          h("div", { class: "text-links" }, [textButton("撃った瞬間を動画にする", video), textButton("タイトルへ", () => this.showTitle())]),
        ]),
      ]),
    );
  }

  /** 失敗で終わった：答えと、根から自分までの枝の逆再生 */
  private showOnlineEnd(run: OnlineRun): void {
    const { state } = run;
    const status = state.status === "give-up" || state.status === "expired" ? state.status : "wrong";
    const answer = state.answer ?? "";
    const meta: ReplayMeta = { answer, shotCount: state.shots.length, survivors: state.turnNumber - 1 };
    const url = new URL(challengePath(run.treeId, state.nodeId), location.origin).href;
    const text = `${turnLabel(state.turnNumber)} で力尽きた💀\nあなたは読める？（答えはリプに書かないで） ${HASHTAG}`;
    const stats: readonly (readonly [string, string])[] = [
      ["あなたの番", turnLabel(state.turnNumber)],
      ["撃たれていた数", `${state.shots.length}発`],
      ["あなたの回答", state.submittedAnswer ?? "（なし）"],
    ];
    const replay = (): void => this.showReplay({ source: run.source, shots: state.shots, meta, text, url, back: () => this.showOnlineEnd(run) });
    this.mount(
      screen("end", [
        h("p", { class: "verdict verdict-dead", text: FAILURE_HEADLINE[status] }),
        createStage(run.source, state.shots).element,
        h("p", { class: "reveal" }, [h("span", { class: "reveal-label", text: "こたえ" }), h("span", { class: "reveal-answer", text: answer })]),
        h(
          "dl",
          { class: "stats" },
          stats.flatMap(([label, value]) => [h("dt", { text: label }), h("dd", { text: value })]),
        ),
        h("p", { class: "note", text: "同じURLからほかの人も挑戦できます。答えは言わずに、結果だけ投稿しよう。" }),
        h("div", { class: "actions" }, [
          h("a", { class: "btn btn-primary btn-link", text: "結果を X で投稿", attrs: { href: xIntentUrl(text, url), target: "_blank", rel: "noopener" } }),
          button("リプレイを見る", replay, "ghost"),
          button("新しい問題でリレーを始める", () => this.showOnlineSetup(), "ghost"),
          button("タイトルへ", () => this.showTitle(), "ghost"),
        ]),
      ]),
    );
  }
}
