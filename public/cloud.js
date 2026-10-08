// 클라우드 기능(지갑 서명 로그인, 공개/비공개 경전, 좋아요·점수·댓글)의 브라우저 쪽 코드.
// /api 가 설정되어 있지 않으면 ready=false 로 남아, 사이트는 예전처럼 브라우저 저장만 쓴다.
// 사용자가 쓴 글(제목·본문·댓글·작성자 이름)은 반드시 textContent 로만 화면에 넣는다.
window.Cloud = (() => {
  const state = { ready: false, me: { user: null, limits: { comment: 100, sutrasPerUser: 100 } }, sutras: [] };
  let tr = (k) => k; // app.js 가 init 에서 번역 함수를 넣어 준다

  class ApiError extends Error {
    constructor(status, code) { super(code); this.status = status; this.code = code; }
  }

  async function api(method, path, body) {
    const init = { method, credentials: "same-origin", headers: { "x-requested-with": "soldragon" } };
    if (body !== undefined) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(body); }
    let res;
    try { res = await fetch("/api" + path, init); } catch { throw new ApiError(0, "network"); }
    let data = null;
    try { data = await res.json(); } catch { /* 본문 없음 */ }
    if (!res.ok) throw new ApiError(res.status, (data && data.error) || "server_error");
    return data;
  }

  // 사용자에게 보여 줄 오류 문구
  function errText(e) {
    const code = e && e.code ? e.code : "server_error";
    const key = "err_" + code;
    const v = window.I18N && window.I18N.ko && key in window.I18N.ko ? tr(key) : null;
    return v || tr("errGeneric") + ` (${code})`;
  }

  const isLoggedIn = () => !!state.me.user;
    const canWrite = () => state.ready && isLoggedIn();

  async function refreshMe() {
    state.me = await api("GET", "/me");
  }
  async function refreshSutras() {
    state.sutras = (await api("GET", "/sutras")).sutras.map((s) => ({ ...s, custom: true, cloud: true }));
  }

  async function init(translate) {
    tr = translate;
    try {
      const res = await fetch("/api/config", { credentials: "same-origin" });
      if (!res.ok || !(res.headers.get("content-type") || "").includes("json")) return state;
      const cfg = await res.json();
      if (!cfg.ready) return state;
      state.ready = true;
      await Promise.all([refreshMe(), refreshSutras()]);
    } catch {
      state.ready = false;
    }
    return state;
  }

  // ---------- 지갑 서명 로그인: 서버가 준 문구에 지갑으로 서명하면 그 지갑 주소가 계정이 된다(거래 아님, 수수료 없음) ----------
  const toB64 = (bytes) => {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  };

  async function login(wallet) {
    if (!wallet || typeof wallet.signMessage !== "function") throw new ApiError(0, "sign_unsupported");
    const { nonce, message } = await api("POST", "/auth/challenge", { address: wallet.addr });
    const sig = await wallet.signMessage(new TextEncoder().encode(message));
    state.me = await api("POST", "/auth/login", { address: wallet.addr, nonce, signature: toB64(sig) });
    await refreshSutras();
  }

  async function logout() {
    await api("POST", "/auth/logout");
    state.me = { ...state.me, user: null };
    await refreshSutras();
  }

  async function deleteAccount() {
    await api("DELETE", "/me");
    state.me = { ...state.me, user: null };
    await refreshSutras();
  }

  // ---------- 경전 ----------
  async function saveSutra(id, data) {
    const r = id ? await api("PUT", "/sutras/" + encodeURIComponent(id), data) : await api("POST", "/sutras", data);
    await refreshSutras();
    return r.sutra;
  }
  async function removeSutra(id) {
    await api("DELETE", "/sutras/" + encodeURIComponent(id));
    await refreshSutras();
  }
  async function importSutras(list) {
    const r = await api("POST", "/import", { sutras: list });
    await refreshSutras();
    return r.imported;
  }

  // ---------- 좋아요 · 점수 · 댓글 패널 ----------
  let draft = "";
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  async function mountSocial(box, sutraId, { socialAllowed }) {
    box.textContent = "";
    if (!state.ready) { box.hidden = true; return; }
    box.hidden = false;
    if (!socialAllowed) {
      box.append(el("p", "note", tr("socialPrivate")));
      return;
    }
    let data;
    const flash = el("p", "note social-msg");
    flash.setAttribute("role", "status");
    const show = (d) => {
      if (box.dataset.sutra !== sutraId) return; // 그새 다른 경전으로 옮겼다면 그리지 않는다
      draw(d);
    };
    const act = async (fn) => {
      try { show(await fn()); } catch (e) { flash.textContent = errText(e); }
    };
    const path = "/sutras/" + encodeURIComponent(sutraId);
    box.dataset.sutra = sutraId;

    function draw(d) {
      const keep = box.querySelector("textarea");
      if (keep) draft = keep.value;
      box.textContent = "";
      box.append(el("h3", "", tr("socialTitle")));
      const logged = isLoggedIn();

      const row = el("div", "social-row");
      const like = el("button", "btn small" + (d.my.vote === 1 ? " on" : ""), `👍 ${tr("like")} ${d.likes}`);
      const dis = el("button", "btn small" + (d.my.vote === -1 ? " on" : ""), `👎 ${tr("dislike")} ${d.dislikes}`);
      for (const [b, v] of [[like, 1], [dis, -1]]) {
        b.type = "button";
        b.disabled = !logged;
        b.setAttribute("aria-pressed", String(d.my.vote === v));
        b.onclick = () => act(() => api("PUT", path + "/react", { vote: d.my.vote === v ? 0 : v }));
      }
      row.append(like, dis);

      const stars = el("span", "stars");
      stars.setAttribute("role", "group");
      stars.setAttribute("aria-label", tr("scoreLabel"));
      for (let n = 1; n <= 5; n++) {
        const b = el("button", "star" + (d.my.score && n <= d.my.score ? " on" : ""), d.my.score && n <= d.my.score ? "★" : "☆");
        b.type = "button";
        b.disabled = !logged;
        b.setAttribute("aria-label", tr("scoreN", n));
        b.setAttribute("aria-pressed", String(d.my.score === n));
        b.onclick = () => act(() => api("PUT", path + "/react", { score: d.my.score === n ? 0 : n }));
        stars.append(b);
      }
      row.append(stars);
      row.append(el("span", "note", d.scoreCount ? tr("scoreAvg", d.scoreAvg, d.scoreCount) : tr("scoreNone")));
      box.append(row);
      if (!logged) box.append(el("p", "note", tr("loginToReact")));

      box.append(el("h4", "", tr("commentsN", d.commentCount)));
      const form = el("form", "comment-form");
      const ta = el("textarea");
      ta.rows = 2;
      ta.placeholder = tr("commentPh");
      ta.setAttribute("aria-label", tr("commentPh"));
      ta.disabled = !logged;
      ta.value = draft;
      const max = state.me.limits.comment;
      const counter = el("span", "note");
      const syncCounter = () => { counter.textContent = `${[...ta.value].length}/${max}`; };
      ta.addEventListener("input", () => {
        // 코드 포인트 기준으로 자른다(서버도 같은 기준으로 검사한다)
        const cps = [...ta.value];
        if (cps.length > max) ta.value = cps.slice(0, max).join("");
        draft = ta.value;
        syncCounter();
      });
      syncCounter();
      const send = el("button", "btn small primary", tr("commentSend"));
      send.type = "submit";
      send.disabled = !logged;
      form.append(ta, counter, send);
      form.onsubmit = (ev) => {
        ev.preventDefault();
        const body = ta.value.trim();
        if (!body) return;
        send.disabled = true;
        act(async () => {
          const r = await api("POST", path + "/comments", { body });
          draft = "";
          return r;
        }).finally(() => { send.disabled = !isLoggedIn(); });
      };
      box.append(form);
      box.append(flash);

      const ul = el("ul", "comments");
      for (const c of d.comments) {
        const li = el("li");
        const head = el("div", "c-head");
        head.append(el("strong", "", c.author), el("span", "note", " · " + new Date(c.createdAt).toLocaleString()));
        if (c.canDelete) {
          const del = el("button", "btn small ghost", tr("commentDel"));
          del.type = "button";
          del.onclick = () => { if (confirm(tr("commentDelConfirm"))) act(() => api("DELETE", "/comments/" + c.id)); };
          head.append(del);
        }
        li.append(head, el("p", "c-body", c.body));
        ul.append(li);
      }
      box.append(ul);
    }

    box.append(el("p", "note", "…"));
    try { data = await api("GET", path + "/social"); } catch (e) { box.textContent = ""; box.append(el("p", "note", errText(e))); return; }
    show(data);
  }

  return {
    state, init, api, errText, isLoggedIn, canWrite, ApiError,
    refreshMe, refreshSutras, login, logout, deleteAccount,
    saveSutra, removeSutra, importSutras, mountSocial,
  };
})();
