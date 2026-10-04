(() => {
  const $ = (id) => document.getElementById(id);
  const STORE = "sutras.custom.v1";

  // ---------- 화면 언어 (i18n) ----------
  const UI_KEY = "sutras.uiLang";
  const detectLang = () => {
    try {
      const saved = localStorage.getItem(UI_KEY);
      if (saved === "ko" || saved === "en") return saved;
    } catch { /* 저장소 사용 불가 */ }
    return (navigator.language || "").toLowerCase().startsWith("ko") ? "ko" : "en";
  };
  let uiLang = detectLang();
  const t = (key, ...args) => {
    const v = window.I18N[uiLang][key];
    return typeof v === "function" ? v(...args) : v;
  };
  const titleOf = (s) => (s.custom ? s.title : s["title_" + uiLang] || s.title_ko || s.title);

  function applyUiText() {
    document.documentElement.lang = uiLang;
    document.title = t("siteTitle");
    document.querySelector('meta[name="description"]').content = t("siteDesc");
    document.querySelectorAll("[data-i18n]").forEach((e) => { e.textContent = t(e.dataset.i18n); });
    document.querySelectorAll("[data-i18n-aria]").forEach((e) => e.setAttribute("aria-label", t(e.dataset.i18nAria)));
    document.querySelectorAll("[data-i18n-title]").forEach((e) => { e.title = t(e.dataset.i18nTitle); });
    document.querySelectorAll("[data-i18n-alt]").forEach((e) => { e.alt = t(e.dataset.i18nAlt); });
    $("uiLang").value = uiLang;
    $("walletBtn").textContent = t(wallet ? "walletDisconnect" : "walletConnect");
  }

  // ---------- 경전 데이터 ----------
  const loadCustom = () => {
    try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch { return []; }
  };
  const saveCustom = (list) => {
    try { localStorage.setItem(STORE, JSON.stringify(list)); } catch { alert(t("noStorage")); }
  };
  let custom = loadCustom();
  const all = () => [...window.DEFAULT_SUTRAS, ...custom];
  let current = null;
  let wallet = null;

  function renderList() {
    const ul = $("sutraList");
    ul.textContent = "";
    for (const s of all()) {
      const li = document.createElement("li");
      if (current && current.id === s.id) li.classList.add("active");
      const b = document.createElement("button");
      b.className = "item";
      b.textContent = titleOf(s);
      b.onclick = () => { open(s.id, true); $("sidebar").classList.remove("open"); };
      li.append(b);
      if (s.custom) {
        const d = document.createElement("button");
        d.className = "del";
        d.textContent = "✕";
        d.title = t("del");
        d.setAttribute("aria-label", `${t("del")}: ${titleOf(s)}`);
        d.onclick = () => {
          if (!confirm(t("delConfirm", titleOf(s)))) return;
          custom = custom.filter((c) => c.id !== s.id);
          saveCustom(custom);
          if (current && current.id === s.id) { stop(); current = null; $("reader").hidden = true; $("empty").hidden = false; }
          renderList();
        };
        li.append(d);
      }
      ul.append(li);
    }
  }

  function open(id, fromUser) {
    stop();
    current = all().find((s) => s.id === id);
    if (!current) return;
    $("empty").hidden = true;
    $("reader").hidden = false;
    renderParas();
    renderList();
    // 브라우저 정책상 사용자 클릭 이후에만 자동 재생이 가능합니다.
    if (fromUser && $("auto").checked) play();
  }

  function renderParas() {
    if (!current) return;
    $("title").textContent = titleOf(current);
    const box = $("paras");
    box.textContent = "";
    current.paragraphs.forEach((p, i) => {
      const d = document.createElement("div");
      d.className = "para";
      d.id = "p" + i;
      const label = document.createElement("div");
      label.className = "orig-label";
      label.textContent = (!current.custom && current.origLabel) || t("origin");
      const o = document.createElement("p");
      o.className = "orig";
      o.lang = current.lang;
      o.textContent = p.orig;
      o.hidden = !p.orig;
      label.hidden = !p.orig;
      const e = document.createElement("p");
      e.className = "en";
      e.lang = "en";
      e.textContent = p.en || "";
      e.hidden = !p.en;
      const k = document.createElement("p");
      k.className = "ko";
      k.lang = "ko";
      k.textContent = p.ko || "";
      k.hidden = !p.ko;
      const go = document.createElement("button");
      go.className = "go";
      go.textContent = t("fromHere");
      go.setAttribute("aria-label", t("fromHereAria", i + 1));
      go.onclick = () => play(i);
      d.append(label, o, e, k, go);
      box.append(d);
    });
    applyMode();
  }

  // ---------- 낭독 (Web Speech API) ----------
  const tts = window.speechSynthesis;
  let token = 0;

  function pickVoice(lang) {
    const voices = tts.getVoices();
    const base = lang.split("-")[0];
    return voices.find((v) => v.lang === lang) || voices.find((v) => v.lang.startsWith(base)) || null;
  }

  function speak(text, lang, rate, volume) {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = rate;
      u.volume = volume;
      const v = pickVoice(lang);
      if (v) u.voice = v;
      u.onend = u.onerror = () => resolve();
      tts.speak(u);
    });
  }

  let curIdx = 0;

  async function play(start) {
    // onclick 핸들러가 이벤트 객체를 넘겨도 숫자일 때만 시작 위치로 쓴다.
    const from = Number.isInteger(start) ? start : 0;
    if (!tts) { showNote("ttsUnsupported"); return; }
    if (!current) return;
    stop();
    const my = ++token;
    const mode = $("mode").value;
    const rate = parseFloat($("rate").value);
    // "원문 + 영어 + 한국어"는 세 언어를 보여 주되 원문만 낭독한다.
    const wantOrig = mode === "all" || mode === "orig";
    const wantEn = mode === "en";
    const wantKo = mode === "ko";
    const needed = [wantOrig && current.lang, wantEn && "en-US", wantKo && "ko-KR"].filter(Boolean);
    showNote(needed.some((l) => !pickVoice(l)) ? "noVoice" : "");
    // 볼륨은 낭독 도중에도 조절할 수 있도록 매번 읽는다.
    const vol = () => parseFloat($("volume").value);
    for (let i = from; i < current.paragraphs.length; i++) {
      if (my !== token) return;
      const p = current.paragraphs[i];
      const parts = [];
      if (wantOrig && p.orig) parts.push([p.orig, p.lang || current.lang]);
      if (wantEn && p.en) parts.push([p.en, "en-US"]);
      if (wantKo && p.ko) parts.push([p.ko, "ko-KR"]);
      if (!parts.length) continue;
      curIdx = i;
      const el = $("p" + i);
      el.classList.add("playing");
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      for (const [text, lang] of parts) {
        if (my !== token) return;
        await speak(text, lang, rate, vol());
      }
      el.classList.remove("playing");
    }
  }

  function stop() {
    token++;
    if (tts) tts.cancel();
    document.querySelectorAll(".para.playing").forEach((e) => e.classList.remove("playing"));
  }

  // 안내 문구는 키로 보관해 두었다가 화면 언어가 바뀌면 다시 그린다.
  let noteKey = "";
  function showNote(key) {
    noteKey = key;
    const n = $("ttsNote");
    n.textContent = key ? t(key) : "";
    n.hidden = !key;
  }

  if (tts) tts.onvoiceschanged = () => {};
  function applyMode() {
    $("paras").dataset.mode = $("mode").value;
  }
  // 낭독 중 읽기 설정을 바꾸면 지금 읽던 문단부터 다시 읽는다.
  $("mode").onchange = () => {
    applyMode();
    if (tts && (tts.speaking || document.querySelector(".para.playing"))) play(curIdx);
  };

  try {
    const v = localStorage.getItem("sutras.volume");
    if (v !== null) $("volume").value = v;
  } catch { /* 저장소 사용 불가 */ }
  const showVolume = () => { $("volumeOut").textContent = Math.round($("volume").value * 100) + "%"; };
  $("volume").oninput = () => {
    showVolume();
    try { localStorage.setItem("sutras.volume", $("volume").value); } catch { /* ignore */ }
  };
  showVolume();

  $("playBtn").onclick = () => play(0);
  $("stopBtn").onclick = stop;
  window.addEventListener("pagehide", stop);

  // ---------- 경전 추가 / 내보내기 / 가져오기 ----------
  const dlg = $("addDialog");
  $("addBtn").onclick = () => { $("addForm").reset(); dlg.showModal(); };
  $("cancelAdd").onclick = () => dlg.close();
  const paras = (t) => t.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);

  $("addForm").addEventListener("submit", () => {
    const f = new FormData($("addForm"));
    const o = paras(f.get("orig"));
    const e = paras(f.get("en"));
    const k = paras(f.get("ko"));
    if (!o.length) return;
    const sutra = {
      id: "c" + Date.now().toString(36),
      custom: true,
      title: f.get("title").trim(),
      lang: f.get("lang"),
      paragraphs: o.map((orig, i) => ({ orig, en: e[i] || "", ko: k[i] || "" })),
    };
    custom.push(sutra);
    saveCustom(custom);
    renderList();
    open(sutra.id, false);
  });

  $("exportBtn").onclick = () => {
    const blob = new Blob([JSON.stringify(custom, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "my-sutras.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  $("importFile").onchange = async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data)) throw new Error();
      let n = 0;
      for (const s of data) {
        if (typeof s.title !== "string" || !Array.isArray(s.paragraphs)) continue;
        custom.push({
          id: "c" + Date.now().toString(36) + n,
          custom: true,
          title: s.title.slice(0, 100),
          lang: typeof s.lang === "string" ? s.lang : "en-US",
          paragraphs: s.paragraphs
            .filter((p) => p && typeof p.orig === "string")
            .map((p) => ({
              orig: p.orig,
              en: typeof p.en === "string" ? p.en : "",
              ko: typeof p.ko === "string" ? p.ko : "",
            })),
        });
        n++;
      }
      saveCustom(custom);
      renderList();
      alert(t("imported", n));
    } catch {
      alert(t("badJson"));
    }
  };

  $("menuBtn").onclick = () => $("sidebar").classList.toggle("open");

  // ---------- 솔라나 지갑 (외부 라이브러리 없이 주입된 provider 사용) ----------
  const providers = () => [
    ["Phantom", window.phantom && window.phantom.solana && window.phantom.solana.isPhantom ? window.phantom.solana : null, "https://phantom.app/"],
    ["Solflare", window.solflare && window.solflare.isSolflare ? window.solflare : null, "https://solflare.com/"],
    ["Backpack", window.backpack && window.backpack.isBackpack ? window.backpack : null, "https://backpack.app/"],
  ];

  const short = (a) => a.slice(0, 4) + "…" + a.slice(-4);

  async function balance(addr) {
    const net = $("network").value;
    const res = await fetch(`https://api.${net}.solana.com`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [addr] }),
    });
    const j = await res.json();
    if (j.error) throw new Error(j.error.message);
    return j.result.value / 1e9;
  }

  async function refreshInfo() {
    if (!wallet) return;
    const info = $("walletInfo");
    info.hidden = false;
    info.textContent = short(wallet.addr);
    try {
      info.textContent = `${short(wallet.addr)} · ${(await balance(wallet.addr)).toFixed(4)} SOL`;
    } catch { /* 잔액 조회 실패 시 주소만 표시 */ }
  }

  function onDisconnect() {
    wallet = null;
    $("walletInfo").hidden = true;
    $("walletBtn").textContent = t("walletConnect");
  }

  async function connect() {
    const found = providers().filter(([, p]) => p);
    if (!found.length) {
      alert(t("walletNone"));
      window.open(providers()[0][2], "_blank", "noopener");
      return;
    }
    let pick = found[0];
    if (found.length > 1) {
      const names = found.map(([n], i) => `${i + 1}. ${n}`).join("\n");
      const n = parseInt(prompt(t("walletPick", names), "1"), 10);
      if (!found[n - 1]) return;
      pick = found[n - 1];
    }
    const provider = pick[1];
    try {
      const r = await provider.connect();
      const pk = (r && r.publicKey) || provider.publicKey;
      wallet = { name: pick[0], provider, addr: pk.toString() };
      $("walletBtn").textContent = t("walletDisconnect");
      provider.on && provider.on("disconnect", onDisconnect);
      await refreshInfo();
    } catch (e) {
      alert(t("walletFail"));
    }
  }

  $("walletBtn").onclick = async () => {
    if (wallet) {
      try { await wallet.provider.disconnect(); } catch { /* ignore */ }
      onDisconnect();
    } else connect();
  };
  $("network").onchange = refreshInfo;

  // ---------- 화면 언어 전환 / 시작 ----------
  $("uiLang").onchange = () => {
    uiLang = $("uiLang").value;
    try { localStorage.setItem(UI_KEY, uiLang); } catch { /* ignore */ }
    applyUiText();
    renderList();
    renderParas();
    showNote(noteKey);
  };

  applyUiText();
  renderList();
})();
