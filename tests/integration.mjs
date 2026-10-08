// 실행 중인 `wrangler pages dev`(로컬 D1)를 상대로 API 전체를 검사한다. 외부 서비스는 필요 없다.
// 사용: .dev.vars 에 SESSION_SECRET(32자 이상)과 ADMIN_WALLETS=<ADMIN_ADDR 출력값> 을 넣고 서버를 띄운 뒤
//       node tests/integration.mjs   (ADMIN 지갑은 아래 고정 시드로 만든다)
import assert from "node:assert/strict";
import { base58Encode, utf8 } from "../src/util.js";

const BASE = process.env.BASE || "http://127.0.0.1:8788";

class Client {
  constructor() { this.cookie = ""; }
  async req(method, path, body, { headers = {}, raw = false } = {}) {
    const h = { origin: BASE, "x-requested-with": "soldragon", ...headers };
    if (body !== undefined && !raw) h["content-type"] = "application/json";
    if (this.cookie) h.cookie = this.cookie;
    const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    const sc = res.headers.get("set-cookie");
    if (sc) { const v = sc.split(";")[0]; this.cookie = v.endsWith("=") ? "" : v; }
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data, res, setCookie: sc };
  }
  // 지갑 서명으로 로그인
  async login(w) {
    const ch = await this.req("POST", "/api/auth/challenge", { address: w.address });
    assert.equal(ch.status, 200, JSON.stringify(ch.data));
    return this.req("POST", "/api/auth/login", { address: w.address, nonce: ch.data.nonce, signature: await w.sign(ch.data.message) });
  }
}

async function walletFrom(seed) {
  // Ed25519 PKCS8 = 고정 접두어 + 32바이트 시드 (관리자 지갑을 재현 가능하게 만들 때 사용)
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const priv = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, true, ["sign"]);
  const jwk = await crypto.subtle.exportKey("jwk", priv);
  const address = base58Encode(Buffer.from(jwk.x, "base64url"));
  return { address, sign: async (m) => Buffer.from(await crypto.subtle.sign({ name: "Ed25519" }, priv, utf8(m))).toString("base64") };
}
const newWallet = async () => {
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const address = base58Encode(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)));
  return { address, sign: async (m) => Buffer.from(await crypto.subtle.sign({ name: "Ed25519" }, kp.privateKey, utf8(m))).toString("base64") };
};
const ADMIN_SEED = Buffer.alloc(32, 7);
if (process.argv[2] === "admin-addr") { console.log((await walletFrom(ADMIN_SEED)).address); process.exit(0); }

const run = Date.now().toString(36);
const SUTRA = (extra = {}) => ({ title: "테스트 경전", lang: "ko-KR", isPublic: false, paragraphs: [{ orig: "原文", en: "english", ko: "한국어" }], ...extra });
let passed = 0;
const t = async (name, fn) => { try { await fn(); passed++; console.log("  ok  ", name); } catch (e) { console.log("  FAIL", name, "\n      ", e.message.split("\n").slice(0, 4).join("\n       ")); process.exitCode = 1; } };

const anon = new Client();
const alice = new Client(), bob = new Client(), admin = new Client();
const aw = await newWallet(), bw = await newWallet(), adminW = await walletFrom(ADMIN_SEED);
const short = (a) => a.slice(0, 4) + "…" + a.slice(-4);

await t("설정과 비로그인 상태", async () => {
  const c = await anon.req("GET", "/api/config"); assert.equal(c.status, 200); assert.equal(c.data.ready, true);
  const me = await anon.req("GET", "/api/me"); assert.equal(me.data.user, null);
  assert.equal(me.res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(me.res.headers.get("cache-control"), "no-store");
  assert.equal((await anon.req("POST", "/api/sutras", SUTRA())).status, 401);
  assert.equal((await anon.req("PUT", "/api/sutras/heart/react", { vote: 1 })).status, 401);
  assert.equal((await anon.req("POST", "/api/sutras/heart/comments", { body: "x" })).status, 401);
  assert.equal((await anon.req("GET", "/api/nothing")).status, 404);
});

await t("CSRF 방어: 출처·헤더·JSON 형식", async () => {
  assert.equal((await anon.req("POST", "/api/auth/logout", {}, { headers: { "x-requested-with": "" } })).status, 403);
  assert.equal((await anon.req("POST", "/api/auth/logout", {}, { headers: { origin: "https://evil.example" } })).status, 403);
  assert.equal((await anon.req("POST", "/api/auth/login", "address=x", { raw: true, headers: { "content-type": "application/x-www-form-urlencoded" } })).status, 415);
  assert.equal((await anon.req("POST", "/api/auth/login", "{not json", { raw: true, headers: { "content-type": "application/json" } })).status, 400);
});

await t("지갑 서명 로그인: 틀린 서명·재사용·남의 nonce 거부, 맞는 서명은 쿠키 발급", async () => {
  const other = await newWallet();
  assert.equal((await anon.req("POST", "/api/auth/challenge", { address: "hello" })).status, 400);
  let ch = await new Client().req("POST", "/api/auth/challenge", { address: aw.address });
  assert.match(ch.data.message, /^Sign in to Sutra Reader/); assert.ok(ch.data.message.includes(`Origin: ${BASE}`)); assert.ok(ch.data.message.includes(aw.address));
  const c = new Client();
  // 다른 키로 서명
  let r = await c.req("POST", "/api/auth/login", { address: aw.address, nonce: ch.data.nonce, signature: await other.sign(ch.data.message) });
  assert.equal(r.data.error, "bad_signature"); assert.equal(r.setCookie, null);
  // 실패해도 nonce는 소멸 → 같은 nonce로 올바른 서명을 해도 거부(재사용 방지)
  r = await c.req("POST", "/api/auth/login", { address: aw.address, nonce: ch.data.nonce, signature: await aw.sign(ch.data.message) });
  assert.equal(r.data.error, "challenge_expired");
  // 다른 주소의 nonce로는 로그인 불가
  ch = await c.req("POST", "/api/auth/challenge", { address: aw.address });
  r = await c.req("POST", "/api/auth/login", { address: bw.address, nonce: ch.data.nonce, signature: await bw.sign(ch.data.message) });
  assert.equal(r.data.error, "challenge_expired");
  // 같은 주소로 문구를 다시 받으면 이전 문구는 무효
  const first = await c.req("POST", "/api/auth/challenge", { address: aw.address });
  await c.req("POST", "/api/auth/challenge", { address: aw.address });
  r = await c.req("POST", "/api/auth/login", { address: aw.address, nonce: first.data.nonce, signature: await aw.sign(first.data.message) });
  assert.equal(r.data.error, "challenge_expired");
  // 정상
  r = await alice.login(aw);
  assert.equal(r.status, 200); assert.equal(r.data.user.address, aw.address); assert.equal(r.data.user.name, short(aw.address));
  assert.match(r.setCookie, /sid=.+; Path=\/; HttpOnly; SameSite=Lax/);
  assert.equal((await alice.req("GET", "/api/me")).data.user.address, aw.address);
  assert.equal((await bob.login(bw)).status, 200);
  assert.equal((await admin.login(adminW)).status, 200);
});

await t("세션 쿠키 변조는 비로그인으로 취급", async () => {
  const c = new Client(); c.cookie = alice.cookie.slice(0, -3) + "AAA";
  assert.equal((await c.req("GET", "/api/me")).data.user, null);
  const forged = Buffer.from(JSON.stringify({ u: aw.address, exp: 9e12 })).toString("base64url");
  c.cookie = "sid=" + forged + ".AAAA";
  assert.equal((await c.req("GET", "/api/me")).data.user, null);
});

let aliceSutra, aliceId;
await t("경전 만들기(비공개) · 검증 · 가시성", async () => {
  for (const bad of [SUTRA({ lang: "<x>" }), SUTRA({ title: "" }), SUTRA({ isPublic: "yes" }), SUTRA({ paragraphs: [] }), SUTRA({ paragraphs: Array(301).fill({ orig: "x" }) })]) {
    assert.equal((await alice.req("POST", "/api/sutras", bad)).status, 400);
  }
  const r = await alice.req("POST", "/api/sutras", SUTRA({ title: `<img src=x onerror=alert(1)> '; DROP TABLE sutras;-- ${run}` }));
  assert.equal(r.status, 201); aliceSutra = r.data.sutra; aliceId = aliceSutra.id;
  assert.equal(aliceSutra.isPublic, false); assert.equal(aliceSutra.mine, true);
  assert.ok(aliceSutra.title.includes("DROP TABLE sutras")); // 그대로 저장(SQL 주입 안 됨, 화면은 textContent로 표시)
  assert.ok((await alice.req("GET", "/api/sutras")).data.sutras.some((s) => s.id === aliceId));
  assert.ok(!(await bob.req("GET", "/api/sutras")).data.sutras.some((s) => s.id === aliceId), "비공개가 남에게 보임");
  assert.ok(!(await anon.req("GET", "/api/sutras")).data.sutras.some((s) => s.id === aliceId));
  assert.equal((await bob.req("GET", `/api/sutras/${aliceId}`)).status, 404);
  assert.equal((await alice.req("GET", `/api/sutras/${aliceId}`)).status, 200);
  assert.equal((await alice.req("GET", "/api/sutras/x'%20OR%20'1'='1")).status, 404);
});

await t("공개로 바꾸면 남도 보고, 남은 수정·삭제할 수 없다", async () => {
  assert.equal((await bob.req("PUT", `/api/sutras/${aliceId}`, SUTRA({ title: "해킹" }))).status, 404);
  assert.equal((await bob.req("DELETE", `/api/sutras/${aliceId}`)).status, 404);
  const r = await alice.req("PUT", `/api/sutras/${aliceId}`, SUTRA({ title: "공개 경전 " + run, isPublic: true }));
  assert.equal(r.status, 200); assert.equal(r.data.sutra.isPublic, true);
  const seen = (await bob.req("GET", "/api/sutras")).data.sutras.find((s) => s.id === aliceId);
  assert.ok(seen); assert.equal(seen.mine, false); assert.equal(seen.author, short(aw.address));
  assert.ok(!JSON.stringify(seen).includes(aw.address), "전체 주소가 공개됨");
  assert.ok((await anon.req("GET", "/api/sutras")).data.sutras.some((s) => s.id === aliceId));
  assert.equal((await bob.req("PUT", `/api/sutras/${aliceId}`, SUTRA({ title: "해킹" }))).status, 404);
});

await t("좋아요·싫어요·점수", async () => {
  const get = async (c, id = "heart") => (await c.req("GET", `/api/sutras/${id}/social`)).data;
  const base = await get(anon);
  assert.equal((await anon.req("GET", "/api/sutras/nope/social")).status, 404);
  let r = await alice.req("PUT", "/api/sutras/heart/react", { vote: 1 }); assert.equal(r.status, 200);
  assert.equal(r.data.likes, base.likes + 1); assert.deepEqual(r.data.my, { vote: 1, score: null });
  r = await alice.req("PUT", "/api/sutras/heart/react", { score: 5 }); assert.deepEqual(r.data.my, { vote: 1, score: 5 }); // 점수만 바꿔도 좋아요 유지
  r = await bob.req("PUT", "/api/sutras/heart/react", { vote: -1, score: 4 });
  assert.equal(r.data.dislikes, base.dislikes + 1); assert.equal(r.data.scoreCount, base.scoreCount + 2);
  const avg = (5 + 4 + (base.scoreAvg ?? 0) * base.scoreCount) / (base.scoreCount + 2);
  assert.ok(Math.abs(r.data.scoreAvg - avg) <= 0.06, `평균 ${r.data.scoreAvg} vs ${avg}`);
  r = await alice.req("PUT", "/api/sutras/heart/react", { vote: -1 }); // 좋아요 → 싫어요로 바꿈(한 사람은 한 표)
  assert.equal(r.data.likes, base.likes); assert.equal(r.data.dislikes, base.dislikes + 2);
  r = await alice.req("PUT", "/api/sutras/heart/react", { vote: 0, score: 0 }); // 취소
  assert.deepEqual(r.data.my, { vote: 0, score: null });
  for (const bad of [{ vote: 2 }, { vote: "1" }, { score: 6 }, { score: 2.5 }, { score: -1 }, {}, { score: "5" }]) {
    assert.equal((await alice.req("PUT", "/api/sutras/heart/react", bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await alice.req("PUT", `/api/sutras/${aliceId}/react`, { vote: 1 })).status, 200); // 공개 경전
  // 비공개 경전엔 소셜 기능 없음
  const priv = await alice.req("POST", "/api/sutras", SUTRA({ title: "비공개 " + run }));
  assert.equal((await alice.req("PUT", `/api/sutras/${priv.data.sutra.id}/react`, { vote: 1 })).status, 404);
  assert.equal((await anon.req("GET", `/api/sutras/${priv.data.sutra.id}/social`)).status, 404);
  assert.equal((await alice.req("DELETE", `/api/sutras/${priv.data.sutra.id}`)).status, 200);
});

await t("댓글: 100자 제한, 속도 제한, 삭제 권한", async () => {
  const commenter = new Client(), cw = await newWallet(); await commenter.login(cw);
  assert.equal((await commenter.req("POST", "/api/sutras/heart/comments", { body: "가".repeat(101) })).data.error, "invalid_comment");
  assert.equal((await commenter.req("POST", "/api/sutras/heart/comments", { body: "   " })).data.error, "invalid_comment");
  assert.equal((await commenter.req("POST", "/api/sutras/heart/comments", { body: 5 })).data.error, "invalid_comment");
  let r = await commenter.req("POST", "/api/sutras/heart/comments", { body: "가".repeat(100) });
  assert.equal(r.status, 201); const first = r.data.comments[0];
  assert.equal(first.body.length, 100); assert.equal(first.mine, true); assert.equal(first.canDelete, true); assert.equal(first.author, short(cw.address));
  assert.ok(!JSON.stringify(first).includes("@"), "이메일 노출");
  const xss = await commenter.req("POST", "/api/sutras/heart/comments", { body: "<script>alert(1)</script>" });
  assert.equal(xss.data.comments[0].body, "<script>alert(1)</script>"); // 저장은 그대로, 화면에서 textContent로 표시
  // 속도 제한: 1분에 5개
  let limited = 0;
  for (let i = 0; i < 6; i++) { const x = await commenter.req("POST", "/api/sutras/heart/comments", { body: "n" + i }); if (x.status === 429) limited++; }
  assert.ok(limited >= 1, "속도 제한이 동작하지 않음");
  // 삭제 권한
  const view = (await bob.req("GET", "/api/sutras/heart/social")).data.comments.find((c) => c.id === first.id);
  assert.equal(view.canDelete, false); assert.equal(view.mine, false);
  assert.equal((await bob.req("DELETE", `/api/comments/${first.id}`)).status, 403);
  assert.equal((await anon.req("DELETE", `/api/comments/${first.id}`)).status, 401);
  assert.equal((await admin.req("GET", "/api/sutras/heart/social")).data.comments.find((c) => c.id === first.id).canDelete, true);
  r = await admin.req("DELETE", `/api/comments/${first.id}`); assert.equal(r.status, 200);
  assert.ok(!r.data.comments.some((c) => c.id === first.id));
  assert.equal((await commenter.req("DELETE", `/api/comments/999999`)).status, 404);
  const mine = (await commenter.req("GET", "/api/sutras/heart/social")).data.comments.find((c) => c.mine);
  assert.equal((await commenter.req("DELETE", `/api/comments/${mine.id}`)).status, 200); // 본인 삭제
});

await t("가져오기(import): 비공개로 올라가고 한도를 지킨다", async () => {
  const r = await bob.req("POST", "/api/import", { sutras: [SUTRA({ title: "로컬1", isPublic: true }), { title: "로컬2", lang: "en-US", paragraphs: [{ orig: "hi" }] }] });
  assert.equal(r.status, 201); assert.equal(r.data.imported, 2);
  const mine = (await bob.req("GET", "/api/sutras")).data.sutras.filter((s) => s.title.startsWith("로컬"));
  assert.equal(mine.length, 2); assert.ok(mine.every((s) => s.isPublic === false), "가져오기는 항상 비공개");
  assert.equal((await bob.req("POST", "/api/import", { sutras: [] })).status, 400);
  assert.equal((await bob.req("POST", "/api/import", { sutras: Array(51).fill(SUTRA()) })).status, 400);
  assert.equal((await bob.req("POST", "/api/import", { sutras: [{ title: "", lang: "x" }] })).status, 400);
});

await t("경전 생성 속도 제한(시간당 20개)", async () => {
  const dave = new Client(); await dave.login(await newWallet());
  let created = 0, limited = 0;
  for (let i = 0; i < 22; i++) { const x = await dave.req("POST", "/api/sutras", SUTRA({ title: "r" + i })); if (x.status === 201) created++; else if (x.status === 429) limited++; }
  assert.equal(created, 20); assert.equal(limited, 2);
});

await t("로그아웃", async () => {
  const c = new Client(); await c.login(await newWallet());
  assert.ok((await c.req("GET", "/api/me")).data.user);
  const r = await c.req("POST", "/api/auth/logout", {}); assert.match(r.setCookie, /Max-Age=0/);
  assert.equal((await c.req("GET", "/api/me")).data.user, null);
});

await t("계정 삭제: 내 경전·댓글·표가 사라진다", async () => {
  const frank = new Client(), fw = await newWallet(); await frank.login(fw);
  const s = await frank.req("POST", "/api/sutras", SUTRA({ title: "삭제될 경전", isPublic: true }));
  await frank.req("PUT", `/api/sutras/${s.data.sutra.id}/react`, { vote: 1, score: 3 });
  await bob.req("POST", `/api/sutras/${s.data.sutra.id}/comments`, { body: "남의 경전에 단 댓글" });
  const cm = await frank.req("POST", "/api/sutras/heart/comments", { body: "프랭크의 댓글" });
  assert.equal(cm.status, 201);
  assert.equal((await frank.req("DELETE", "/api/me")).status, 200);
  assert.equal((await frank.req("GET", "/api/me")).data.user, null); // 쿠키가 지워짐
  assert.ok(!(await bob.req("GET", "/api/sutras")).data.sutras.some((x) => x.id === s.data.sutra.id));
  assert.ok(!(await bob.req("GET", "/api/sutras/heart/social")).data.comments.some((c) => c.body === "프랭크의 댓글"));
  // 같은 지갑으로 다시 로그인하면 빈 새 계정이 된다(이전 데이터는 복구되지 않음)
  const again = new Client(); assert.equal((await again.login(fw)).status, 200);
  assert.equal((await again.req("GET", "/api/sutras")).data.sutras.filter((x) => x.mine).length, 0);
});

console.log(`\n${passed} 개 통과${process.exitCode ? " (실패 있음)" : ""}`);
