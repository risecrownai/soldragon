// 암호·인코딩 도구. Workers와 Node 모두에서 동작하는 Web Crypto만 사용한다.
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const enc = new TextEncoder();

export const utf8 = (s) => enc.encode(s);

export function base58Decode(str) {
  if (typeof str !== "string" || str.length === 0 || str.length > 64) throw new Error("bad base58");
  let n = 0n;
  for (const ch of str) {
    const v = B58.indexOf(ch);
    if (v < 0) throw new Error("bad base58");
    n = n * 58n + BigInt(v);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const body = n === 0n ? [] : hex.match(/../g).map((h) => parseInt(h, 16));
  let zeros = 0;
  while (zeros < str.length && str[zeros] === "1") zeros++;
  return Uint8Array.from([...new Array(zeros).fill(0), ...body]);
}

export function base58Encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b === 0) out = "1" + out; else break; }
  return out;
}

export function b64urlEncode(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64Decode(str) {
  const s = String(str).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export const randomHex = (bytes = 16) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

const hmacKey = (secret, usage) =>
  crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, usage);

export async function hmacSign(secret, data) {
  return new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret, ["sign"]), utf8(data)));
}

export async function hmacVerify(secret, data, sig) {
  return crypto.subtle.verify("HMAC", await hmacKey(secret, ["verify"]), sig, utf8(data));
}

export async function verifyEd25519(publicKey32, message, signature64) {
  const key = await crypto.subtle.importKey("raw", publicKey32, { name: "Ed25519" }, false, ["verify"]);
  return crypto.subtle.verify({ name: "Ed25519" }, key, signature64, message);
}
