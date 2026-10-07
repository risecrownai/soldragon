// 서버의 순수 함수 테스트. 실행: node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { base58Decode, base58Encode, b64urlEncode, utf8 } from "../src/util.js";
import { createSession, readSession, parseCookies, sessionCookie } from "../src/session.js";
import { addressToKey, verifyWalletSignature, walletMessage } from "../src/wallet.js";
import { verifyGoogleIdToken, _resetJwksCache } from "../src/google.js";
import { validateSutra, validateComment, displayName, charLength } from "../src/validate.js";
import { DEFAULT_SUTRA_IDS } from "../src/defaults.js";

const SECRET = "x".repeat(40);

test("base58: 알려진 값과 왕복 변환", () => {
  assert.deepEqual([...base58Decode("11111111111111111111111111111111")], new Array(32).fill(0)); // System Program
  const wsol = base58Decode("So11111111111111111111111111111111111111112");
  assert.equal(Buffer.from(wsol).toString("hex"), "069b8857feab8184fb687f634618c035dac439dc1aeb3b5598a0f00000000001");
  assert.equal(base58Encode(wsol), "So11111111111111111111111111111111111111112");
  for (let i = 0; i < 20; i++) {
    const k = crypto.getRandomValues(new Uint8Array(32));
    assert.deepEqual(base58Decode(base58Encode(k)), k);
  }
  assert.throws(() => base58Decode("0OIl")); // 알파벳에 없는 문자
  assert.throws(() => base58Decode(""));
  assert.equal(addressToKey("not-an-address"), null);
  assert.equal(addressToKey("1111"), null); // 길이가 32바이트가 아님
});

test("세션: 만들고 읽기, 변조·만료·다른 키 거부", async () => {
  const now = Date.now();
  const tok = await createSession(SECRET, "user-1", now);
  assert.equal(await readSession(SECRET, tok, now + 1000), "user-1");
  assert.equal(await readSession(SECRET, tok, now + 31 * 86400000), null); // 30일 지남
  assert.equal(await readSession("y".repeat(40), tok, now), null);
  const [p, s] = tok.split(".");
  const forged = b64urlEncode(utf8(JSON.stringify({ u: "admin", exp: now + 1e9 }))) + "." + s;
  assert.equal(await readSession(SECRET, forged, now), null);
  assert.equal(await readSession(SECRET, p + ".AAAA", now), null);
  assert.equal(await readSession(SECRET, "", now), null);
  assert.equal(await readSession("short", tok, now), null); // 짧은 비밀 키는 거부
  await assert.rejects(() => createSession("short", "u"));
  assert.deepEqual(parseCookies("a=1; sid=abc.def; b=2"), { a: "1", sid: "abc.def", b: "2" });
  assert.match(sessionCookie("v", true), /HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
  assert.doesNotMatch(sessionCookie("v", false), /Secure/);
});

async function newWallet() {
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  return { address: base58Encode(raw), sign: async (m) => Buffer.from(await crypto.subtle.sign({ name: "Ed25519" }, kp.privateKey, utf8(m))).toString("base64") };
}

test("지갑 서명: 맞는 서명만 통과", async () => {
  const w = await newWallet();
  const msg = walletMessage({ address: w.address, userId: "u1", nonce: "n1", issuedAt: 0, origin: "https://x.test" });
  assert.match(msg, /Wallet: .+\nAccount: u1\nNonce: n1\nIssued: 1970-01-01T00:00:00.000Z\nOrigin: https:\/\/x.test$/);
  const sig = await w.sign(msg);
  assert.equal(await verifyWalletSignature(w.address, msg, sig), true);
  assert.equal(await verifyWalletSignature(w.address, msg + "!", sig), false); // 다른 문구
  const other = await newWallet();
  assert.equal(await verifyWalletSignature(other.address, msg, sig), false); // 다른 사람의 주소
  assert.equal(await verifyWalletSignature(w.address, msg, "AAAA"), false);
  assert.equal(await verifyWalletSignature("bad", msg, sig), false);
  assert.equal(await verifyWalletSignature(w.address, msg, "!!!"), false);
});

async function googleSetup(extra = {}) {
  const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const mint = async (claims = {}, header = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const h = b64urlEncode(utf8(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT", ...header })));
    const p = b64urlEncode(utf8(JSON.stringify({ iss: "https://accounts.google.com", aud: "cid", sub: "123", email: "a@b.c", email_verified: true, name: "홍길동", iat: now, exp: now + 3600, ...claims })));
    const sig = b64urlEncode(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, utf8(`${h}.${p}`))));
    return `${h}.${p}.${sig}`;
  };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });
  _resetJwksCache();
  return { mint, fetchImpl, env: { GOOGLE_CLIENT_ID: "cid", GOOGLE_JWKS_URL: "http://jwks.test/" + Math.random(), ...extra } };
}

test("구글 ID 토큰: 정상 토큰 통과, 위조·잘못된 대상·만료 등 거부", async () => {
  const g = await googleSetup();
  const ok = await verifyGoogleIdToken(await g.mint(), g.env, g.fetchImpl);
  assert.deepEqual(ok, { sub: "123", email: "a@b.c", name: "홍길동" });
  const cases = [
    [{ aud: "other-client" }, {}], [{ iss: "https://evil.example" }, {}], [{ exp: Math.floor(Date.now() / 1000) - 3600 }, {}],
    [{ sub: "" }, {}], [{ email_verified: false }, {}], [{}, { alg: "none" }], [{}, { kid: "unknown" }],
  ];
  for (const [claims, header] of cases) {
    const token = await g.mint(claims, header);
    await assert.rejects(() => verifyGoogleIdToken(token, g.env, g.fetchImpl), `거부되어야 함: ${JSON.stringify([claims, header])}`);
  }
  // 페이로드 변조(서명은 그대로)
  const [h, , s] = (await g.mint()).split(".");
  const evil = b64urlEncode(utf8(JSON.stringify({ iss: "https://accounts.google.com", aud: "cid", sub: "attacker", exp: 9e9 })));
  await assert.rejects(() => verifyGoogleIdToken(`${h}.${evil}.${s}`, g.env, g.fetchImpl));
  await assert.rejects(() => verifyGoogleIdToken("a.b", g.env, g.fetchImpl));
  const valid = await g.mint();
  await assert.rejects(() => verifyGoogleIdToken(valid, { ...g.env, GOOGLE_CLIENT_ID: "" }, g.fetchImpl));
});

test("입력 검증: 경전", () => {
  const good = { title: " 내 경전 ", lang: "ko-KR", isPublic: false, paragraphs: [{ orig: "가", en: "a", ko: "나" }] };
  assert.deepEqual(validateSutra(good).value, { title: "내 경전", lang: "ko-KR", isPublic: false, paragraphs: [{ orig: "가", en: "a", ko: "나" }] });
  assert.equal(validateSutra({ ...good, title: "가".repeat(100) }).error, undefined);
  assert.equal(validateSutra({ ...good, title: "가".repeat(101) }).error, "invalid_title");
  assert.equal(validateSutra({ ...good, title: "   " }).error, "invalid_title");
  assert.equal(validateSutra({ ...good, lang: "<script>" }).error, "invalid_lang");
  assert.equal(validateSutra({ ...good, isPublic: "yes" }).error, "invalid_visibility");
  assert.equal(validateSutra({ ...good, paragraphs: [] }).error, "invalid_paragraphs");
  assert.equal(validateSutra({ ...good, paragraphs: [{ orig: "", en: "", ko: "" }] }).error, "invalid_paragraphs");
  assert.equal(validateSutra({ ...good, paragraphs: [{ orig: "x".repeat(4001) }] }).error, "invalid_paragraphs");
  assert.equal(validateSutra({ ...good, paragraphs: Array(301).fill({ orig: "x" }) }).error, "invalid_paragraphs");
  assert.equal(validateSutra({ ...good, paragraphs: Array(100).fill({ orig: "x".repeat(4000), en: "y".repeat(4000) }) }).error, "too_large");
  assert.equal(validateSutra(null).error, "invalid_sutra");
  assert.equal(validateSutra({ ...good, paragraphs: [{ orig: "a\u0000b" }] }).value.paragraphs[0].orig, "ab"); // 제어문자 제거
});

test("입력 검증: 댓글은 100자(코드 포인트) 이내", () => {
  assert.equal(validateComment("좋은 경전입니다").value, "좋은 경전입니다");
  assert.equal(validateComment("가".repeat(100)).error, undefined);
  assert.equal(validateComment("가".repeat(101)).error, "invalid_comment");
  assert.equal(validateComment("🙏".repeat(100)).error, undefined); // 이모지도 1글자
  assert.equal(charLength("🙏"), 1);
  assert.equal(validateComment("   ").error, "invalid_comment");
  assert.equal(validateComment(5).error, "invalid_comment");
  assert.equal(validateComment("줄\n바꿈").value, "줄 바꿈");
});

test("공개 이름은 이메일을 그대로 드러내지 않는다", () => {
  assert.equal(displayName("홍길동", "a@b.c"), "홍길동");
  assert.equal(displayName(null, "johndoe@gmail.com"), "jo***");
  assert.equal(displayName(null, null), "user");
});

test("기본 경전 id 목록이 public/sutras.js와 같다", () => {
  const window = {};
  new Function("window", fs.readFileSync(new URL("../public/sutras.js", import.meta.url), "utf8"))(window);
  assert.deepEqual(window.DEFAULT_SUTRAS.map((s) => s.id), DEFAULT_SUTRA_IDS);
});
