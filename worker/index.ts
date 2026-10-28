// READ OR DEAD の Worker。静的ファイル（SPA）・挑戦ページのリンクカード・カード画像・API を返す。

import { ALL_QUESTIONS, KANJI_QUESTIONS, SILHOUETTE_QUESTIONS, WORD_QUESTIONS } from "../src/game/questions";
import type { Question } from "../src/game/types";
import {
  DEVICE_HEADER,
  MAX_ANSWER_LENGTH,
  ROOT_NODE,
  TREE_ID_LENGTH,
  challengePath,
  isBase62,
  isNodeId,
  type ApiError,
  type ClaimResult,
  type CreatedTree,
  type OnlinePool,
  type TreeErrorCode,
} from "../src/online/protocol";
import { renderCard } from "./card";
import { randomBase62, randomHex, sha256 } from "./ids";
import { Tree, type Outcome } from "./tree";

export { Tree };

const POOLS: Readonly<Record<OnlinePool, readonly Question[]>> = {
  kanji: KANJI_QUESTIONS,
  word: WORD_QUESTIONS,
  silhouette: SILHOUETTE_QUESTIONS,
  all: ALL_QUESTIONS,
};

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_GONE = 410;
/** 端末 ID は 128bit の 16 進表記 */
const DEVICE_ID_LENGTH = 32;
const TOKEN_LENGTH = 32;
const ATTEMPT_ID_LENGTH = 32;
const HEX = "0123456789abcdef";
const TURN_DIGITS = 3;
/** ノードは作ったあと変わらないので、カード画像はずっと同じでよい */
const CARD_CACHE = "public, max-age=31536000, immutable";

const STATUS_OF: Readonly<Record<TreeErrorCode, number>> = {
  "tree-not-found": HTTP_NOT_FOUND,
  "node-not-found": HTTP_NOT_FOUND,
  "attempt-not-found": HTTP_NOT_FOUND,
  "already-played": HTTP_CONFLICT,
  "tree-full": HTTP_CONFLICT,
  "bad-state": HTTP_CONFLICT,
  "invalid-token": HTTP_FORBIDDEN,
  expired: HTTP_GONE,
  "out-of-bounds": HTTP_BAD_REQUEST,
  "bad-request": HTTP_BAD_REQUEST,
};

const ROUTES = {
  create: new URLPattern({ pathname: "/api/trees" }),
  node: new URLPattern({ pathname: "/api/trees/:tree/nodes/:node" }),
  claim: new URLPattern({ pathname: "/api/trees/:tree/nodes/:node/attempts" }),
  attempt: new URLPattern({ pathname: "/api/trees/:tree/attempts/:attempt/:action" }),
  challenge: new URLPattern({ pathname: "/r/:tree/:node" }),
  card: new URLPattern({ pathname: "/card/:tree/:node.png" }),
};

type TreeStub = DurableObjectStub<Tree>;

interface Body {
  readonly token?: unknown;
  readonly clientMs?: unknown;
  readonly answer?: unknown;
  readonly x?: unknown;
  readonly y?: unknown;
  readonly pool?: unknown;
}

function isHex(text: string, length: number): boolean {
  return text.length === length && Array.from(text).every((ch) => HEX.includes(ch));
}

function json(value: unknown, status = HTTP_OK): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function fail(code: TreeErrorCode): Response {
  const body: ApiError = { error: code };
  return json(body, STATUS_OF[code]);
}

function reply<T>(outcome: Outcome<T>): Response {
  return outcome.ok ? json(outcome.value) : fail(outcome.code);
}

async function readBody(request: Request): Promise<Body> {
  try {
    const parsed: unknown = await request.json();
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function pickQuestion(pool: OnlinePool): Question | undefined {
  const questions = POOLS[pool];
  const [value = 0] = crypto.getRandomValues(new Uint32Array(1));
  return questions[value % questions.length];
}

function isPool(value: unknown): value is OnlinePool {
  return typeof value === "string" && value in POOLS;
}

function turnLabel(depth: number): string {
  return `TURN ${String(depth + 1).padStart(TURN_DIGITS, "0")}`;
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const stubFor = (treeId: string): TreeStub => ctx.exports.Tree.get(ctx.exports.Tree.idFromName(treeId));
    const deviceHash = async (treeId: string): Promise<string | null> => {
      const device = request.headers.get(DEVICE_HEADER) ?? "";
      // 木ごとに別のハッシュにして、木をまたいで端末を追えないようにする
      return isHex(device, DEVICE_ID_LENGTH) ? sha256(`${treeId}:${device}`) : null;
    };

    if (request.method === "POST" && ROUTES.create.test(url)) {
      const body = await readBody(request);
      const question = pickQuestion(isPool(body.pool) ? body.pool : "all");
      if (!question) return fail("bad-request");
      const treeId = randomBase62(TREE_ID_LENGTH);
      const created = await stubFor(treeId).create(treeId, question.key);
      if (!created.ok) return fail(created.code);
      const tree: CreatedTree = { treeId, nodeId: ROOT_NODE };
      return json(tree);
    }

    const nodeMatch = ROUTES.node.exec(url)?.pathname.groups;
    if (request.method === "GET" && nodeMatch?.tree && nodeMatch.node) {
      if (!isBase62(nodeMatch.tree, TREE_ID_LENGTH) || !isNodeId(nodeMatch.node)) return fail("node-not-found");
      return reply(await stubFor(nodeMatch.tree).nodeView(nodeMatch.node, await deviceHash(nodeMatch.tree)));
    }

    const claimMatch = ROUTES.claim.exec(url)?.pathname.groups;
    if (request.method === "POST" && claimMatch?.tree && claimMatch.node) {
      if (!isBase62(claimMatch.tree, TREE_ID_LENGTH) || !isNodeId(claimMatch.node)) return fail("node-not-found");
      const device = await deviceHash(claimMatch.tree);
      if (!device) return fail("bad-request");
      const token = randomHex();
      const claimed = await stubFor(claimMatch.tree).claim(claimMatch.node, device, await sha256(token));
      if (!claimed.ok) return fail(claimed.code);
      const result: ClaimResult = { token, state: claimed.value };
      return json(result);
    }

    const attemptMatch = ROUTES.attempt.exec(url)?.pathname.groups;
    if (request.method === "POST" && attemptMatch?.tree && attemptMatch.attempt && attemptMatch.action) {
      const { tree, attempt, action } = attemptMatch;
      const body = await readBody(request);
      const token = typeof body.token === "string" ? body.token : "";
      if (!isBase62(tree, TREE_ID_LENGTH) || !isHex(attempt, ATTEMPT_ID_LENGTH)) return fail("attempt-not-found");
      if (!isHex(token, TOKEN_LENGTH)) return fail("invalid-token");
      const stub = stubFor(tree);
      const tokenHash = await sha256(token);
      if (action === "state") return reply(await stub.state(attempt, tokenHash));
      if (action === "start") return reply(await stub.start(attempt, tokenHash));
      if (action === "give-up") return reply(await stub.giveUp(attempt, tokenHash));
      if (action === "buzz") {
        if (typeof body.clientMs !== "number") return fail("bad-request");
        return reply(await stub.buzz(attempt, tokenHash, body.clientMs));
      }
      if (action === "answer") {
        if (typeof body.answer !== "string" || body.answer.length > MAX_ANSWER_LENGTH) return fail("bad-request");
        return reply(await stub.answer(attempt, tokenHash, body.answer));
      }
      if (action === "shoot") {
        if (typeof body.x !== "number" || typeof body.y !== "number") return fail("bad-request");
        return reply(await stub.shoot(attempt, tokenHash, body.x, body.y));
      }
      return fail("bad-request");
    }

    const cardMatch = ROUTES.card.exec(url)?.pathname.groups;
    if (request.method === "GET" && cardMatch?.tree && cardMatch.node) {
      if (!isBase62(cardMatch.tree, TREE_ID_LENGTH) || !isNodeId(cardMatch.node)) return new Response("not found", { status: HTTP_NOT_FOUND });
      const cache = caches.default;
      const cached = await cache.match(request);
      if (cached) return cached;
      const card = await stubFor(cardMatch.tree).card(cardMatch.node);
      if (!card.ok) return new Response("not found", { status: HTTP_NOT_FOUND });
      const png = await renderCard(card.value.depth, card.value.shots);
      const response = new Response(png, { headers: { "Content-Type": "image/png", "Cache-Control": CARD_CACHE } });
      ctx.waitUntil(cache.put(request, response.clone()));
      return response;
    }

    const challengeMatch = ROUTES.challenge.exec(url)?.pathname.groups;
    if (request.method === "GET" && challengeMatch?.tree && challengeMatch.node) {
      const page = await env.ASSETS.fetch(new Request(new URL("/", url)));
      const { tree, node } = challengeMatch;
      if (!isBase62(tree, TREE_ID_LENGTH) || !isNodeId(node)) return page;
      const view = await stubFor(tree).nodeView(node, null);
      if (!view.ok) return page;
      return withCardTags(page, {
        title: `READ OR DEAD｜${turnLabel(view.value.depth)} — 読める？`,
        description: view.value.depth
          ? `${view.value.depth}発撃たれた。あなたは読める？ 早く読めるほど大きい弾で次の人を撃てる。`
          : "まだ無傷の一枚。あなたが最初の挑戦者。早く読めるほど大きい弾で次の人を撃てる。",
        image: new URL(`/card/${tree}/${node}.png`, url).href,
        url: new URL(challengePath(tree, node), url).href,
      });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

interface CardTags {
  readonly title: string;
  readonly description: string;
  readonly image: string;
  readonly url: string;
}

/** 挑戦ページの index.html に、リンクカード（OGP）のタグを差し込む */
function withCardTags(page: Response, tags: CardTags): Response {
  const meta: readonly (readonly [string, string, string])[] = [
    ["property", "og:type", "website"],
    ["property", "og:site_name", "READ OR DEAD"],
    ["property", "og:title", tags.title],
    ["property", "og:description", tags.description],
    ["property", "og:image", tags.image],
    ["property", "og:url", tags.url],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", tags.title],
    ["name", "twitter:description", tags.description],
    ["name", "twitter:image", tags.image],
  ];
  const escape = (text: string): string => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
  const html = meta.map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escape(value)}" />`).join("");
  return new HTMLRewriter()
    .on("title", { element: (element) => void element.setInnerContent(tags.title) })
    .on("head", { element: (element) => void element.append(html, { html: true }) })
    .transform(page);
}
