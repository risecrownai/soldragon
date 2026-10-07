import { b64Decode, utf8 } from "./util.js";

const DEFAULT_JWKS = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const SKEW_MS = 60_000;

let cache = { url: "", keys: null, at: 0 };

async function loadKeys(url, fetchImpl, force) {
  const fresh = cache.keys && cache.url === url && Date.now() - cache.at < 3600_000;
  if (fresh && !force) return cache.keys;
  // 키를 찾지 못해 다시 받는 경우도 1분에 한 번만
  if (force && cache.url === url && Date.now() - cache.at < 60_000) return cache.keys;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error("jwks fetch failed");
  const { keys } = await res.json();
  cache = { url, keys, at: Date.now() };
  return keys;
}

const parseJson = (b64) => JSON.parse(new TextDecoder().decode(b64Decode(b64)));

// 구글 ID 토큰(JWT, RS256)을 검증한다: 서명, 발급자, 대상(내 클라이언트 ID), 만료.
// 실패하면 예외를 던진다. fetchImpl과 env.GOOGLE_JWKS_URL은 테스트에서 가짜 키를 쓰기 위한 것이다.
export async function verifyGoogleIdToken(token, env, fetchImpl = fetch, now = Date.now()) {
  if (!env.GOOGLE_CLIENT_ID) throw new Error("GOOGLE_CLIENT_ID not set");
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const header = parseJson(parts[0]);
  const payload = parseJson(parts[1]);
  if (header.alg !== "RS256" || !header.kid) throw new Error("unsupported alg");

  const url = env.GOOGLE_JWKS_URL || DEFAULT_JWKS;
  let keys = await loadKeys(url, fetchImpl, false);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) { keys = await loadKeys(url, fetchImpl, true); jwk = keys.find((k) => k.kid === header.kid); }
  if (!jwk) throw new Error("unknown key");

  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64Decode(parts[2]), utf8(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new Error("bad signature");

  if (!ISSUERS.has(payload.iss)) throw new Error("bad issuer");
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.GOOGLE_CLIENT_ID)) throw new Error("bad audience");
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= now - SKEW_MS) throw new Error("expired");
  if (typeof payload.iat === "number" && payload.iat * 1000 > now + SKEW_MS) throw new Error("issued in the future");
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("no subject");
  if (payload.email && payload.email_verified === false) throw new Error("email not verified");
  return { sub: payload.sub, email: payload.email || null, name: payload.name || null };
}

export const _resetJwksCache = () => { cache = { url: "", keys: null, at: 0 }; };
