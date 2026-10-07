import { b64Decode, b64urlEncode, hmacSign, hmacVerify, utf8 } from "./util.js";

export const COOKIE = "sid";
export const SESSION_DAYS = 30;

const MIN_SECRET = 32;
export function assertSecret(secret) {
  if (typeof secret !== "string" || secret.length < MIN_SECRET) throw new Error("SESSION_SECRET must be at least 32 characters");
}

// 세션 값 = base64url(JSON{u,exp}) + "." + base64url(HMAC)
export async function createSession(secret, userId, now = Date.now()) {
  assertSecret(secret);
  const payload = b64urlEncode(utf8(JSON.stringify({ u: userId, exp: now + SESSION_DAYS * 86400000 })));
  const sig = b64urlEncode(await hmacSign(secret, payload));
  return `${payload}.${sig}`;
}

export async function readSession(secret, token, now = Date.now()) {
  try {
    assertSecret(secret);
    const [payload, sig] = String(token || "").split(".");
    if (!payload || !sig) return null;
    if (!(await hmacVerify(secret, payload, b64Decode(sig)))) return null;
    const data = JSON.parse(new TextDecoder().decode(b64Decode(payload)));
    if (!data || typeof data.u !== "string" || typeof data.exp !== "number" || data.exp <= now) return null;
    return data.u;
  } catch {
    return null;
  }
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function sessionCookie(value, secure, maxAgeSeconds = SESSION_DAYS * 86400) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
}
export const clearCookie = (secure) => sessionCookie("", secure, 0);
