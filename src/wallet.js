import { b64Decode, base58Decode, randomHex, utf8, verifyEd25519 } from "./util.js";

export const NONCE_TTL_MS = 5 * 60_000;

// 주소가 올바른 솔라나 공개키(32바이트)면 그 바이트를, 아니면 null
export function addressToKey(address) {
  try {
    const key = base58Decode(address);
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

// 서버가 만드는 서명 문구. 사용자가 자기 키로 이 문구에 서명하면 지갑 소유가 증명된다.
export function walletMessage({ address, nonce, issuedAt, origin }) {
  return [
    "Sign in to Sutra Reader. This is not a transaction and costs nothing.",
    "",
    `Wallet: ${address}`,
    `Nonce: ${nonce}`,
    `Issued: ${new Date(issuedAt).toISOString()}`,
    `Origin: ${origin}`,
  ].join("\n");
}

export const newNonce = () => randomHex(16);

export async function verifyWalletSignature(address, message, signatureB64) {
  const key = addressToKey(address);
  if (!key) return false;
  let sig;
  try { sig = b64Decode(signatureB64); } catch { return false; }
  if (sig.length !== 64) return false;
  try { return await verifyEd25519(key, utf8(message), sig); } catch { return false; }
}
