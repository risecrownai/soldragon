// Cloudflare Pages Functions용 API. 모든 권한 확인은 여기(서버)에서 한다.
// 브라우저의 화면 잠금과 달리, 이 코드의 검사는 개발자 도구로 우회할 수 없다.
import { DEFAULT_SUTRA_IDS } from "./defaults.js";
import { verifyGoogleIdToken } from "./google.js";
import { clearCookie, COOKIE, createSession, parseCookies, readSession, sessionCookie } from "./session.js";
import { displayName, LIMITS, validateComment, validateSutra } from "./validate.js";
import { addressToKey, newNonce, NONCE_TTL_MS, verifyWalletSignature, walletMessage } from "./wallet.js";

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
const err = (status, code) => new HttpError(status, code);

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers },
  });

const MAX_BODY = 400_000;
const RATE = { commentsPerMinute: 5, commentsPerDay: 100, sutrasPerHour: 20 };

async function readJson(request) {
  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().startsWith("application/json")) throw err(415, "json_required");
  const text = await request.text();
  if (text.length > MAX_BODY) throw err(413, "too_large");
  try {
    return JSON.parse(text);
  } catch {
    throw err(400, "invalid_json");
  }
}

const isAdmin = (env, user) =>
  !!user?.email &&
  String(env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(user.email.toLowerCase());

const sutraRow = (r, userId) => ({
  id: r.id,
  title: r.title,
  lang: r.lang,
  paragraphs: JSON.parse(r.paragraphs),
  isPublic: !!r.is_public,
  mine: r.owner_id === userId,
  author: displayName(r.owner_name, r.owner_email),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// ---------- 인증 ----------

async function currentUser(env, request) {
  const token = parseCookies(request.headers.get("cookie"))[COOKIE];
  const uid = await readSession(env.SESSION_SECRET, token);
  if (!uid) return null;
  const user = await env.DB.prepare("SELECT id, email, name FROM users WHERE id = ?").bind(uid).first();
  if (!user) return null;
  const w = await env.DB.prepare("SELECT address FROM wallets WHERE user_id = ?").bind(uid).first();
  return { ...user, wallet: w ? w.address : null };
}

const requireUser = (ctx) => {
  if (!ctx.user) throw err(401, "login_required");
  return ctx.user;
};
const requireWallet = (ctx) => {
  const u = requireUser(ctx);
  if (!u.wallet) throw err(403, "wallet_required");
  return u;
};

const meBody = (u) => ({
  user: u ? { name: displayName(u.name, u.email), email: u.email } : null,
  wallet: u?.wallet ? { address: u.wallet } : null,
  limits: { comment: LIMITS.comment, sutrasPerUser: LIMITS.sutrasPerUser },
});

async function loginGoogle(ctx) {
  const { env, request, url } = ctx;
  const body = await readJson(request);
  let info;
  try {
    info = await verifyGoogleIdToken(body.credential, env);
  } catch (e) {
    console.warn("google token rejected:", e.message);
    throw err(401, "invalid_google_token");
  }
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name`,
  ).bind(info.sub, info.email, info.name, now).run();
  const token = await createSession(env.SESSION_SECRET, info.sub, now);
  const user = await currentUserById(env, info.sub);
  return json(meBody(user), 200, { "set-cookie": sessionCookie(token, url.protocol === "https:") });
}

async function currentUserById(env, uid) {
  const user = await env.DB.prepare("SELECT id, email, name FROM users WHERE id = ?").bind(uid).first();
  const w = await env.DB.prepare("SELECT address FROM wallets WHERE user_id = ?").bind(uid).first();
  return { ...user, wallet: w ? w.address : null };
}

async function deleteAccount(ctx) {
  const u = requireUser(ctx);
  const db = ctx.env.DB;
  await db.batch([
    db.prepare("DELETE FROM comments WHERE sutra_id IN (SELECT id FROM sutras WHERE owner_id = ?)").bind(u.id),
    db.prepare("DELETE FROM reactions WHERE sutra_id IN (SELECT id FROM sutras WHERE owner_id = ?)").bind(u.id),
    db.prepare("DELETE FROM comments WHERE user_id = ?").bind(u.id),
    db.prepare("DELETE FROM reactions WHERE user_id = ?").bind(u.id),
    db.prepare("DELETE FROM sutras WHERE owner_id = ?").bind(u.id),
    db.prepare("DELETE FROM nonces WHERE user_id = ?").bind(u.id),
    db.prepare("DELETE FROM wallets WHERE user_id = ?").bind(u.id),
    db.prepare("DELETE FROM users WHERE id = ?").bind(u.id),
  ]);
  return json({ ok: true }, 200, { "set-cookie": clearCookie(ctx.url.protocol === "https:") });
}

// ---------- 지갑 묶기 ----------

async function walletChallenge(ctx) {
  const u = requireUser(ctx);
  const { address } = await readJson(ctx.request);
  if (!addressToKey(address)) throw err(400, "invalid_address");
  const other = await ctx.env.DB.prepare("SELECT user_id FROM wallets WHERE address = ?").bind(address).first();
  if (other && other.user_id !== u.id) throw err(409, "wallet_taken");
  const now = Date.now();
  const nonce = newNonce();
  const message = walletMessage({ address, userId: u.id, nonce, issuedAt: now, origin: ctx.url.origin });
  await ctx.env.DB.batch([
    ctx.env.DB.prepare("DELETE FROM nonces WHERE expires_at < ? OR user_id = ?").bind(now, u.id),
    ctx.env.DB.prepare("INSERT INTO nonces (nonce, user_id, address, message, expires_at) VALUES (?, ?, ?, ?, ?)")
      .bind(nonce, u.id, address, message, now + NONCE_TTL_MS),
  ]);
  return json({ nonce, message });
}

async function walletLink(ctx) {
  const u = requireUser(ctx);
  const { address, nonce, signature } = await readJson(ctx.request);
  if (typeof nonce !== "string" || typeof signature !== "string" || !addressToKey(address)) throw err(400, "invalid_request");
  const db = ctx.env.DB;
  const row = await db.prepare("SELECT * FROM nonces WHERE nonce = ? AND user_id = ? AND address = ?").bind(nonce, u.id, address).first();
  // 1회용: 성공/실패와 상관없이 지금 지운다(재사용 방지)
  await db.prepare("DELETE FROM nonces WHERE nonce = ?").bind(nonce).run();
  if (!row || row.expires_at < Date.now()) throw err(400, "challenge_expired");
  if (!(await verifyWalletSignature(address, row.message, signature))) throw err(400, "bad_signature");
  const other = await db.prepare("SELECT user_id FROM wallets WHERE address = ?").bind(address).first();
  if (other && other.user_id !== u.id) throw err(409, "wallet_taken");
  await db.batch([
    db.prepare("DELETE FROM wallets WHERE user_id = ?").bind(u.id),
    db.prepare("INSERT INTO wallets (address, user_id, linked_at) VALUES (?, ?, ?)").bind(address, u.id, Date.now()),
  ]);
  return json(meBody({ ...u, wallet: address }));
}

async function walletUnlink(ctx) {
  const u = requireUser(ctx);
  await ctx.env.DB.prepare("DELETE FROM wallets WHERE user_id = ?").bind(u.id).run();
  return json(meBody({ ...u, wallet: null }));
}

// ---------- 경전 ----------

const SELECT_SUTRA =
  "SELECT s.*, u.name AS owner_name, u.email AS owner_email FROM sutras s JOIN users u ON u.id = s.owner_id";

async function listSutras(ctx) {
  const uid = ctx.user?.id ?? "";
  const { results } = await ctx.env.DB
    .prepare(`${SELECT_SUTRA} WHERE s.is_public = 1 OR s.owner_id = ? ORDER BY s.updated_at DESC LIMIT 300`)
    .bind(uid).all();
  return json({ sutras: results.map((r) => sutraRow(r, uid)) });
}

async function loadVisibleSutra(ctx, id) {
  const r = await ctx.env.DB.prepare(`${SELECT_SUTRA} WHERE s.id = ?`).bind(id).first();
  if (!r || (!r.is_public && r.owner_id !== ctx.user?.id)) throw err(404, "sutra_not_found");
  return r;
}

async function assertQuota(ctx, user, adding) {
  const db = ctx.env.DB;
  const { n } = await db.prepare("SELECT COUNT(*) AS n FROM sutras WHERE owner_id = ?").bind(user.id).first();
  if (n + adding > LIMITS.sutrasPerUser) throw err(409, "sutra_limit");
  const { m } = await db.prepare("SELECT COUNT(*) AS m FROM sutras WHERE owner_id = ? AND created_at > ?")
    .bind(user.id, Date.now() - 3600_000).first();
  if (m + adding > RATE.sutrasPerHour) throw err(429, "rate_limited");
}

const newId = () => "s_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);

function insertStmt(db, user, v, now, id = newId()) {
  return db.prepare(
    "INSERT INTO sutras (id, owner_id, title, lang, paragraphs, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(id, user.id, v.title, v.lang, JSON.stringify(v.paragraphs), v.isPublic ? 1 : 0, now, now);
}

async function createSutra(ctx) {
  const u = requireWallet(ctx);
  const { value, error } = validateSutra(await readJson(ctx.request));
  if (error) throw err(400, error);
  await assertQuota(ctx, u, 1);
  const id = newId();
  await insertStmt(ctx.env.DB, u, value, Date.now(), id).run();
  const r = await ctx.env.DB.prepare(`${SELECT_SUTRA} WHERE s.id = ?`).bind(id).first();
  return json({ sutra: sutraRow(r, u.id) }, 201);
}

async function updateSutra(ctx, id) {
  const u = requireWallet(ctx);
  const cur = await ctx.env.DB.prepare("SELECT owner_id FROM sutras WHERE id = ?").bind(id).first();
  if (!cur || cur.owner_id !== u.id) throw err(404, "sutra_not_found");
  const { value, error } = validateSutra(await readJson(ctx.request));
  if (error) throw err(400, error);
  await ctx.env.DB.prepare("UPDATE sutras SET title=?, lang=?, paragraphs=?, is_public=?, updated_at=? WHERE id=? AND owner_id=?")
    .bind(value.title, value.lang, JSON.stringify(value.paragraphs), value.isPublic ? 1 : 0, Date.now(), id, u.id).run();
  const r = await ctx.env.DB.prepare(`${SELECT_SUTRA} WHERE s.id = ?`).bind(id).first();
  return json({ sutra: sutraRow(r, u.id) });
}

async function deleteSutra(ctx, id) {
  const u = requireWallet(ctx);
  const cur = await ctx.env.DB.prepare("SELECT owner_id FROM sutras WHERE id = ?").bind(id).first();
  if (!cur || cur.owner_id !== u.id) throw err(404, "sutra_not_found");
  const db = ctx.env.DB;
  await db.batch([
    db.prepare("DELETE FROM comments WHERE sutra_id = ?").bind(id),
    db.prepare("DELETE FROM reactions WHERE sutra_id = ?").bind(id),
    db.prepare("DELETE FROM sutras WHERE id = ? AND owner_id = ?").bind(id, u.id),
  ]);
  return json({ ok: true });
}

// 브라우저(localStorage)에 있던 경전을 올린다. 기본은 비공개.
async function importSutras(ctx) {
  const u = requireWallet(ctx);
  const body = await readJson(ctx.request);
  if (!Array.isArray(body.sutras) || body.sutras.length < 1 || body.sutras.length > 50) throw err(400, "invalid_import");
  const values = [];
  for (const s of body.sutras) {
    const { value, error } = validateSutra({ ...s, isPublic: false });
    if (error) throw err(400, error);
    values.push(value);
  }
  await assertQuota(ctx, u, values.length);
  const now = Date.now();
  await ctx.env.DB.batch(values.map((v) => insertStmt(ctx.env.DB, u, v, now)));
  return json({ imported: values.length }, 201);
}

// ---------- 좋아요 · 점수 · 댓글 ----------

// 기본 경전이거나, 공개된 경전이어야 한다(비공개는 소셜 기능 없음).
async function socialTarget(ctx, id) {
  if (DEFAULT_SUTRA_IDS.includes(id)) return;
  const r = await ctx.env.DB.prepare("SELECT is_public FROM sutras WHERE id = ?").bind(id).first();
  if (!r || !r.is_public) throw err(404, "sutra_not_found");
}

async function socialBody(ctx, id) {
  const db = ctx.env.DB;
  const uid = ctx.user?.id ?? "";
  const agg = await db.prepare(
    `SELECT COALESCE(SUM(vote = 1), 0) AS likes, COALESCE(SUM(vote = -1), 0) AS dislikes,
            AVG(score) AS avg, COUNT(score) AS cnt FROM reactions WHERE sutra_id = ?`,
  ).bind(id).first();
  const mine = uid ? await db.prepare("SELECT vote, score FROM reactions WHERE sutra_id = ? AND user_id = ?").bind(id, uid).first() : null;
  const { results } = await db.prepare(
    `SELECT c.id, c.body, c.created_at, c.user_id, u.name, u.email FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.sutra_id = ? ORDER BY c.id DESC LIMIT 100`,
  ).bind(id).all();
  const { n } = await db.prepare("SELECT COUNT(*) AS n FROM comments WHERE sutra_id = ?").bind(id).first();
  const admin = isAdmin(ctx.env, ctx.user);
  return {
    likes: agg.likes,
    dislikes: agg.dislikes,
    scoreAvg: agg.cnt ? Math.round(agg.avg * 10) / 10 : null,
    scoreCount: agg.cnt,
    my: mine ? { vote: mine.vote, score: mine.score } : { vote: 0, score: null },
    commentCount: n,
    comments: results.map((c) => ({
      id: c.id,
      author: displayName(c.name, c.email),
      body: c.body,
      createdAt: c.created_at,
      mine: c.user_id === uid,
      canDelete: c.user_id === uid || admin,
    })),
  };
}

async function getSocial(ctx, id) {
  await socialTarget(ctx, id);
  return json(await socialBody(ctx, id));
}

async function react(ctx, id) {
  const u = requireUser(ctx);
  await socialTarget(ctx, id);
  const body = await readJson(ctx.request);
  const hasVote = body.vote !== undefined;
  const hasScore = body.score !== undefined;
  if (!hasVote && !hasScore) throw err(400, "invalid_request");
  if (hasVote && ![-1, 0, 1].includes(body.vote)) throw err(400, "invalid_vote");
  if (hasScore && !(body.score === 0 || (Number.isInteger(body.score) && body.score >= 1 && body.score <= 5))) throw err(400, "invalid_score");
  const db = ctx.env.DB;
  const cur = await db.prepare("SELECT vote, score FROM reactions WHERE sutra_id = ? AND user_id = ?").bind(id, u.id).first();
  const vote = hasVote ? body.vote : cur?.vote ?? 0;
  const score = hasScore ? (body.score === 0 ? null : body.score) : cur?.score ?? null;
  await db.prepare(
    `INSERT INTO reactions (sutra_id, user_id, vote, score, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(sutra_id, user_id) DO UPDATE SET vote = excluded.vote, score = excluded.score, updated_at = excluded.updated_at`,
  ).bind(id, u.id, vote, score, Date.now()).run();
  return json(await socialBody(ctx, id));
}

async function addComment(ctx, id) {
  const u = requireUser(ctx);
  await socialTarget(ctx, id);
  const { value, error } = validateComment((await readJson(ctx.request)).body);
  if (error) throw err(400, error);
  const db = ctx.env.DB;
  const now = Date.now();
  const { a } = await db.prepare("SELECT COUNT(*) AS a FROM comments WHERE user_id = ? AND created_at > ?").bind(u.id, now - 60_000).first();
  const { b } = await db.prepare("SELECT COUNT(*) AS b FROM comments WHERE user_id = ? AND created_at > ?").bind(u.id, now - 86400_000).first();
  if (a >= RATE.commentsPerMinute || b >= RATE.commentsPerDay) throw err(429, "rate_limited");
  await db.prepare("INSERT INTO comments (sutra_id, user_id, body, created_at) VALUES (?, ?, ?, ?)").bind(id, u.id, value, now).run();
  return json(await socialBody(ctx, id), 201);
}

async function deleteComment(ctx, cid) {
  const u = requireUser(ctx);
  const c = await ctx.env.DB.prepare("SELECT id, sutra_id, user_id FROM comments WHERE id = ?").bind(cid).first();
  if (!c) throw err(404, "comment_not_found");
  if (c.user_id !== u.id && !isAdmin(ctx.env, u)) throw err(403, "forbidden");
  await ctx.env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(cid).run();
  return json(await socialBody(ctx, c.sutra_id));
}

// ---------- 라우터 ----------

async function route(ctx, segs, method) {
  const { url } = ctx;
  const [a, b, c] = segs;

  if (a === "me" && !b) {
    if (method === "GET") return json(meBody(ctx.user));
    if (method === "DELETE") return deleteAccount(ctx);
  }
  if (a === "auth" && b === "google" && method === "POST") return loginGoogle(ctx);
  if (a === "auth" && b === "logout" && method === "POST") {
    return json({ ok: true }, 200, { "set-cookie": clearCookie(url.protocol === "https:") });
  }
  if (a === "wallet") {
    if (b === "challenge" && method === "POST") return walletChallenge(ctx);
    if (b === "link" && method === "POST") return walletLink(ctx);
    if (!b && method === "DELETE") return walletUnlink(ctx);
  }
  if (a === "import" && method === "POST") return importSutras(ctx);
  if (a === "comments" && b && !c && method === "DELETE" && /^\d+$/.test(b)) return deleteComment(ctx, Number(b));
  if (a === "sutras") {
    if (!b) {
      if (method === "GET") return listSutras(ctx);
      if (method === "POST") return createSutra(ctx);
    } else if (!c) {
      if (method === "GET") return json({ sutra: sutraRow(await loadVisibleSutra(ctx, b), ctx.user?.id ?? "") });
      if (method === "PUT") return updateSutra(ctx, b);
      if (method === "DELETE") return deleteSutra(ctx, b);
    } else if (c === "social" && method === "GET") return getSocial(ctx, b);
    else if (c === "react" && method === "PUT") return react(ctx, b);
    else if (c === "comments" && method === "POST") return addComment(ctx, b);
  }
  throw err(404, "not_found");
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  const segs = url.pathname.split("/").filter(Boolean).slice(1); // "api" 제거
  const method = request.method.toUpperCase();
  try {
    // 설정이 끝났는지 알려 준다(프런트는 이 값으로 클라우드 기능을 켠다).
    if (method === "GET" && segs.length === 1 && segs[0] === "config") {
      const ready = !!(env.DB && env.GOOGLE_CLIENT_ID && env.SESSION_SECRET && env.SESSION_SECRET.length >= 32);
      return json({ ready, googleClientId: ready ? env.GOOGLE_CLIENT_ID : null });
    }
    if (!env.DB || !env.SESSION_SECRET || !env.GOOGLE_CLIENT_ID) throw err(503, "not_configured");

    // CSRF 방어: 상태를 바꾸는 요청은 같은 출처에서, 직접 단 헤더와 함께 와야 한다.
    if (!["GET", "HEAD"].includes(method)) {
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin) throw err(403, "bad_origin");
      if (request.headers.get("x-requested-with") !== "soldragon") throw err(403, "bad_request");
    }

    const ctx = { env, request, url, user: await currentUser(env, request) };
    // 반드시 await: 처리기가 던진 오류가 아래 catch에서 잡혀 올바른 상태 코드로 응답된다.
    return await route(ctx, segs, method);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code }, e.status);
    console.error("api error:", e && e.stack ? e.stack : e);
    return json({ error: "server_error" }, 500);
  }
}
