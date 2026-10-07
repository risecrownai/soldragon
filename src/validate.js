// 입력 검증. 길이는 글자(코드 포인트) 수로 센다. 한글·한자도 1글자로 센다.
export const LIMITS = {
  title: 100,
  field: 4000,        // 문단의 원문/영어/한국어 각각
  paragraphs: 300,
  totalBytes: 300_000,
  comment: 100,
  sutrasPerUser: 100,
};

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

export const charLength = (s) => [...s].length;

function cleanText(v, max, { multiline }) {
  if (typeof v !== "string") return null;
  let s = v.replace(CONTROL, "");
  if (!multiline) s = s.replace(/[\r\n\t]+/g, " ");
  s = s.trim();
  return charLength(s) <= max ? s : null;
}

// 새 경전/수정 입력을 검증하고 정리한다. 실패하면 { error: 코드 }
export function validateSutra(input) {
  if (!input || typeof input !== "object") return { error: "invalid_sutra" };
  const title = cleanText(input.title, LIMITS.title, { multiline: false });
  if (!title) return { error: "invalid_title" };
  if (typeof input.lang !== "string" || !LANG_RE.test(input.lang)) return { error: "invalid_lang" };
  if (!Array.isArray(input.paragraphs) || input.paragraphs.length < 1 || input.paragraphs.length > LIMITS.paragraphs) {
    return { error: "invalid_paragraphs" };
  }
  const paragraphs = [];
  for (const p of input.paragraphs) {
    if (!p || typeof p !== "object") return { error: "invalid_paragraphs" };
    const out = {};
    for (const k of ["orig", "en", "ko"]) {
      const v = p[k] === undefined || p[k] === null ? "" : cleanText(p[k], LIMITS.field, { multiline: true });
      if (v === null) return { error: "invalid_paragraphs" };
      out[k] = v;
    }
    paragraphs.push(out);
  }
  if (!paragraphs.some((p) => p.orig || p.en || p.ko)) return { error: "invalid_paragraphs" };
  if (new TextEncoder().encode(JSON.stringify(paragraphs)).length > LIMITS.totalBytes) return { error: "too_large" };
  if (typeof input.isPublic !== "boolean") return { error: "invalid_visibility" };
  return { value: { title, lang: input.lang, paragraphs, isPublic: input.isPublic } };
}

export function validateComment(body) {
  const s = cleanText(body, LIMITS.comment, { multiline: false });
  return s ? { value: s } : { error: "invalid_comment" };
}

// 공개되는 이름: 구글 이름(30자까지), 없으면 이메일 앞부분을 가려서
export function displayName(name, email) {
  const n = typeof name === "string" ? cleanText(name, 30, { multiline: false }) : null;
  if (n) return n;
  const local = typeof email === "string" ? email.split("@")[0] : "";
  return local ? `${[...local].slice(0, 2).join("")}***` : "user";
}
