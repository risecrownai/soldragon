(() => {
  const $ = (id) => document.getElementById(id);
  const STORE = "sutras.custom.v1";
  const ORDER_KEY = "sutras.order.v1";
  const UI_KEY = "sutras.uiLang";

  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };

  // ---------- 화면 언어 (i18n) ----------
  const detectLang = () => {
    const saved = lsGet(UI_KEY);
    if (saved === "ko" || saved === "en") return saved;
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
    $("reorderBtn").textContent = t(reorderMode ? "reorderDone" : "reorder");
    updateButtons();
  }

  // ---------- 경전 데이터 ----------
  const loadCustom = () => {
    try { return JSON.parse(lsGet(STORE)) || []; } catch { return []; }
  };
  const saveCustom = (list) => {
    if (!lsSet(STORE, JSON.stringify(list))) alert(t("noStorage"));
  };
  const loadOrder = () => {
    try {
      const o = JSON.parse(lsGet(ORDER_KEY));
      return Array.isArray(o) ? o.filter((x) => typeof x === "string") : [];
    } catch { return []; }
  };
  let custom = loadCustom();
  let order = loadOrder();
  let current = null;
  let wallet = null;
  let reorderMode = false;

  // 저장된 순서를 적용한다. 순서에 없는 경전(새로 추가된 것)은 뒤에 붙는다.
  const all = () => {
    const base = [...window.DEFAULT_SUTRAS, ...custom];
    const rank = (s) => { const i = order.indexOf(s.id); return i === -1 ? Infinity : i; };
    return base
      .map((s, i) => [s, i])
      .sort((a, b) => (rank(a[0]) - rank(b[0])) || (a[1] - b[1]))
      .map(([s]) => s);
  };

  function move(id, dir) {
    const ids = all().map((s) => s.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    order = ids;
    lsSet(ORDER_KEY, JSON.stringify(order));
    renderList();
  }

  function renderList() {
    const ul = $("sutraList");
    ul.textContent = "";
    const list = all();
    list.forEach((s, idx) => {
      const li = document.createElement("li");
      if (current && current.id === s.id) li.classList.add("active");
      if (reorderMode) li.classList.add("reordering");
      const b = document.createElement("button");
      b.className = "item";
      b.textContent = titleOf(s);
      b.onclick = () => {
        if (reorderMode) return;
        open(s.id, true);
        $("sidebar").classList.remove("open");
      };
      li.append(b);
      if (reorderMode) {
        const up = document.createElement("button");
        up.className = "mv";
        up.textContent = "▲";
        up.disabled = idx === 0;
        up.setAttribute("aria-label", t("moveUp", titleOf(s)));
        up.onclick = () => move(s.id, -1);
        const down = document.createElement("button");
        down.className = "mv";
        down.textContent = "▼";
        down.disabled = idx === list.length - 1;
        down.setAttribute("aria-label", t("moveDown", titleOf(s)));
        down.onclick = () => move(s.id, 1);
        li.append(up, down);
      }
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
    });
  }

  $("reorderBtn").onclick = () => {
    reorderMode = !reorderMode;
    $("reorderBtn").textContent = t(reorderMode ? "reorderDone" : "reorder");
    $("resetOrderBtn").hidden = !reorderMode;
    renderList();
  };
  $("resetOrderBtn").onclick = () => {
    order = [];
    lsSet(ORDER_KEY, "[]");
    renderList();
  };

  function open(id, fromUser) {
    stop();
    current = all().find((s) => s.id === id);
    if (!current) return;
    $("empty").hidden = true;
    $("reader").hidden = false;
    renderParas();
    renderList();
    populateVoiceNames();
    // 브라우저 정책상 사용자 클릭 이후에만 자동 재생이 가능합니다.
    if (fromUser && $("auto").checked) play(0);
  }

  function renderParas() {
    if (!current) return;
    $("title").textContent = titleOf(current);
    const intro = current["intro_" + uiLang] || current.intro_ko || "";
    $("intro").textContent = intro;
    $("intro").hidden = !intro;
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
    if (player.state !== "idle") markPlaying(player.para, false);
  }

  // ---------- 낭독 (Web Speech API) ----------
  const tts = window.speechSynthesis;
  // idle | playing | paused. para/unit: 지금 읽는 문단과 그 안의 조각, round: 끝낸 반복 횟수
  const player = { state: "idle", para: 0, unit: 0, round: 0, start: 0 };
  let token = 0; // 값이 바뀌면 진행 중이던 낭독 루프는 스스로 멈춘다
  let fails = 0;
  let noteKey = "";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Web Speech API는 목소리의 성별을 알려 주지 않으므로, 음성 이름으로 추정한다.
  // (Google/Microsoft/Apple 음성의 대표적인 이름. 추정 못 하면 기본 음성을 쓴다.)
  const FEMALE_RE = /female|woman|여성|女|sun-?hi|yuna|heami|seoyeon|ji-?min|soon-?bok|ting-?ting|mei-?jia|sin-?ji|xiao|hui-?hui|yaoyao|zira|jenny|aria|samantha|karen|moira|tessa|victoria|fiona|susan|hazel|libby|sonia|emma|ava\b|allison|kathy|joanna|salli|kendra|kimberly|ivy|lekha|swara|kalpana|priya|veena|google (한국어|korean|普通话|中文|hindi|हिन्दी|us english)/i;
  const MALE_RE = /\bmale\b|남성|男|in-?joon|bongjin|gookmin|kang-?kang|yun-?(yang|xi|jian|feng)|david|\bmark\b|alex|daniel|\bfred\b|\bguy\b|ryan|george|james|richard|\btom\b|aaron|arthur|hemant|madhur|rishi/i;

  // gender: "auto" | "f" | "m". matched=false면 원하는 성별의 음성을 찾지 못해 기본 음성을 쓴 것이다.
  function pickVoice(lang, gender = "auto") {
    const voices = tts.getVoices();
    const base = lang.split("-")[0];
    const cands = [...voices.filter((v) => v.lang === lang), ...voices.filter((v) => v.lang !== lang && v.lang.startsWith(base))];
    if (!cands.length) return { voice: null, matched: false };
    // 사용자가 목록에서 직접 고른 음성이 있으면 성별 추정보다 우선한다.
    const saved = lsGet(NAME_KEY + lang);
    const chosen = saved && cands.find((v) => v.name === saved);
    if (chosen) return { voice: chosen, matched: true };
    if (gender === "auto") return { voice: cands[0], matched: true };
    const re = gender === "f" ? FEMALE_RE : MALE_RE;
    const other = gender === "f" ? MALE_RE : FEMALE_RE;
    const hit = cands.find((v) => re.test(v.name) && !(other.test(v.name) && !re.test(v.name)));
    return hit ? { voice: hit, matched: true } : { voice: cands[0], matched: false };
  }
  const voiceChoice = () => $("voice").value;
  const NAME_KEY = "sutras.voiceName.";

  // 긴 문단은 브라우저가 중간에 끊거나 끝 이벤트를 놓치는 일이 있어 문장 단위로 나눠 읽는다.
  const CHUNK = 160;
  function chunkText(text) {
    const sentences = text.match(/[^。．.!?！？；;/\n]+[。．.!?！？；;/]*\s*/g) || [text];
    const pieces = [];
    for (let s of sentences) {
      while (s.length > CHUNK * 1.5) {
        let cut = Math.max(s.lastIndexOf("，", CHUNK), s.lastIndexOf(",", CHUNK), s.lastIndexOf(" ", CHUNK));
        if (cut < CHUNK / 2) cut = CHUNK;
        pieces.push(s.slice(0, cut + 1));
        s = s.slice(cut + 1);
      }
      pieces.push(s);
    }
    const out = [];
    let buf = "";
    for (const s of pieces) {
      if (buf && (buf + s).length > CHUNK) { out.push(buf.trim()); buf = s; } else buf += s;
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
  }

  // "원문 + 영어 + 한국어"는 세 언어를 보여 주되 원문만 낭독한다.
  function unitsFor(p) {
    const mode = $("mode").value;
    const parts = [];
    if ((mode === "all" || mode === "orig") && p.orig) parts.push([p.orig, p.lang || current.lang]);
    if (mode === "en" && p.en) parts.push([p.en, "en-US"]);
    if (mode === "ko" && p.ko) parts.push([p.ko, "ko-KR"]);
    return parts.flatMap(([text, lang]) => chunkText(text).map((c) => [c, lang]));
  }

  let utterRef = null; // 일부 브라우저는 참조를 잃은 utterance의 끝 이벤트를 보내지 않는다
  function speak(text, lang) {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      utterRef = u;
      u.lang = lang;
      u.rate = parseFloat($("rate").value);
      u.volume = parseFloat($("volume").value); // 조각마다 읽으므로 낭독 중에도 볼륨 조절이 반영된다
      const { voice, matched } = pickVoice(lang, voiceChoice());
      if (voice) u.voice = voice;
      // 원하는 성별의 음성이 이 기기에 없으면 음높이로 근사한다.
      const base = matched || voiceChoice() === "auto" ? 1 : voiceChoice() === "f" ? 1.1 : 0.9;
      u.pitch = Math.min(2, Math.max(0.1, base * parseFloat($("pitch").value)));
      u.onend = () => resolve(true);
      u.onerror = (ev) => resolve(ev && (ev.error === "interrupted" || ev.error === "canceled"));
      tts.speak(u);
    });
  }

  const repeatTotal = () => parseInt($("repeat").value, 10); // 0 = 무한

  // 다음 읽을 위치로 이동한다. 더 읽을 것이 없으면 false.
  function advance() {
    const n = current.paragraphs.length;
    const total = repeatTotal();
    player.unit = 0;
    if ($("scope").value === "para") {
      player.round++;
      if (total === 0 || player.round < total) return true;
      player.round = 0;
      player.para++;
      return player.para < n;
    }
    player.para++;
    if (player.para < n) return true;
    player.round++;
    if (total === 0 || player.round < total) { player.para = player.start; return true; }
    return false;
  }

  function markPlaying(i, scroll = true) {
    document.querySelectorAll(".para.playing").forEach((e) => e.classList.remove("playing"));
    const el = $("p" + i);
    if (!el) return;
    el.classList.add("playing");
    if (scroll) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function updateButtons() {
    $("pauseBtn").disabled = player.state === "idle";
    $("pauseBtn").textContent = t(player.state === "paused" ? "resume" : "pause");
    const total = repeatTotal();
    $("repeatInfo").textContent = player.state !== "idle" && total !== 1 ? t("repeatInfo", player.round + 1, total) : "";
  }

  async function run(my) {
    fails = 0;
    while (my === token) {
      const us = unitsFor(current.paragraphs[player.para]);
      if (us.length) {
        markPlaying(player.para);
        while (player.unit < us.length) {
          updateButtons();
          const [text, lang] = us[player.unit];
          const ok = await speak(text, lang);
          if (my !== token) return;
          if (!ok && ++fails >= 10) { showNote("ttsFailed"); return finish(); }
          if (ok) fails = 0;
          player.unit++;
        }
      }
      if (!advance()) break;
      await sleep(30);
    }
    if (my === token) finish();
  }

  function finish() {
    token++;
    player.state = "idle";
    document.querySelectorAll(".para.playing").forEach((e) => e.classList.remove("playing"));
    updateButtons();
  }

  // 지정한 문단부터 낭독을 시작한다(start가 숫자가 아니면 처음부터).
  function play(start) {
    if (!tts) { showNote("ttsUnsupported"); return; }
    if (!current) return;
    const from = Number.isInteger(start) ? start : 0;
    const my = ++token;
    // 읽는 중이던 것을 끊은 직후에는 잠깐 기다려야 새 낭독이 씹히지 않는다.
    // 아무것도 읽고 있지 않을 때는 기다리지 않아야 iOS에서도 클릭 동작 안에서 바로 시작한다.
    const interrupted = tts.speaking || tts.pending;
    tts.cancel();
    Object.assign(player, { state: "playing", para: from, unit: 0, round: 0, start: from });
    const mode = $("mode").value;
    const langs = [(mode === "all" || mode === "orig") && current.lang, mode === "en" && "en-US", mode === "ko" && "ko-KR"].filter(Boolean);
    refreshVoiceNote();
    updateButtons();
    if (interrupted) sleep(80).then(() => my === token && run(my));
    else run(my);
  }

  function pause() {
    if (player.state !== "playing") return;
    token++;
    tts.cancel();
    player.state = "paused";
    updateButtons();
  }

  function resume() {
    if (player.state !== "paused") return;
    player.state = "playing";
    updateButtons();
    const my = ++token;
    sleep(80).then(() => my === token && run(my));
  }

  function stop() {
    token++;
    if (tts) tts.cancel();
    if (player.state !== "idle") finish();
  }

  // 지금 읽을 언어들에 대해 음성이 없거나, 고른 성별의 음성이 없을 때 안내한다.
  function refreshVoiceNote() {
    if (!tts || !current) return;
    const mode = $("mode").value;
    const langs = [(mode === "all" || mode === "orig") && current.lang, mode === "en" && "en-US", mode === "ko" && "ko-KR"].filter(Boolean);
    const picks = langs.map((l) => pickVoice(l, voiceChoice()));
    if (picks.some((p) => !p.voice)) showNote("noVoice");
    else if (voiceChoice() !== "auto" && picks.some((p) => !p.matched)) showNote(voiceChoice() === "f" ? "noFemaleVoice" : "noMaleVoice");
    else showNote("");
  }
  if (tts) tts.onvoiceschanged = () => { populateVoiceNames(); if (player.state !== "idle") refreshVoiceNote(); };

  const savedVoice = lsGet("sutras.voice");
  if (savedVoice === "f" || savedVoice === "m") $("voice").value = savedVoice;
  // 바꾼 목소리는 다음 문장부터 적용된다.
  $("voice").onchange = () => { lsSet("sutras.voice", $("voice").value); refreshVoiceNote(); };

  // 지금 읽을 언어: 원문(+영어+한국어) 모드는 경전 원문 언어, 영어/한국어 모드는 해당 언어
  function readLang() {
    const mode = $("mode").value;
    return mode === "en" ? "en-US" : mode === "ko" ? "ko-KR" : current && current.lang;
  }

  // 이 기기에 설치된 실제 음성 중 읽을 언어에 맞는 것을 목록으로 보여 준다.
  function populateVoiceNames() {
    const sel = $("voiceName");
    sel.textContent = "";
    const auto = document.createElement("option");
    auto.value = "";
    auto.textContent = t("voiceNameAuto");
    sel.append(auto);
    const lang = readLang();
    if (!tts || !lang) return;
    const base = lang.split("-")[0];
    const list = tts.getVoices().filter((v) => v.lang === lang || v.lang.startsWith(base));
    for (const v of list) {
      const o = document.createElement("option");
      o.value = v.name;
      const g = FEMALE_RE.test(v.name) ? " ♀" : MALE_RE.test(v.name) ? " ♂" : "";
      o.textContent = `${v.name}${g}`;
      sel.append(o);
    }
    const saved = lsGet(NAME_KEY + lang);
    sel.value = saved && list.some((v) => v.name === saved) ? saved : "";
  }
  $("voiceName").onchange = () => {
    const lang = readLang();
    if (!lang) return;
    try {
      if ($("voiceName").value) localStorage.setItem(NAME_KEY + lang, $("voiceName").value);
      else localStorage.removeItem(NAME_KEY + lang);
    } catch { /* ignore */ }
    refreshVoiceNote();
  };

  const savedPitch = lsGet("sutras.pitch");
  if (savedPitch !== null) $("pitch").value = savedPitch;
  const showPitch = () => { $("pitchOut").textContent = parseFloat($("pitch").value).toFixed(2); };
  $("pitch").oninput = () => { showPitch(); lsSet("sutras.pitch", $("pitch").value); };
  showPitch();

  // 안내 문구는 키로 보관해 두었다가 화면 언어가 바뀌면 다시 그린다.
  function showNote(key) {
    noteKey = key;
    const n = $("ttsNote");
    n.textContent = key ? t(key) : "";
    n.hidden = !key;
  }

  function applyMode() {
    $("paras").dataset.mode = $("mode").value;
  }

  // 낭독 중 읽기 모드를 바꾸면 읽던 문단을 처음부터 다시 읽는다.
  $("mode").onchange = () => {
    applyMode();
    populateVoiceNames();
    refreshVoiceNote();
    if (player.state === "playing") {
      player.unit = 0;
      token++;
      tts.cancel();
      const my = ++token;
      sleep(80).then(() => my === token && run(my));
    } else if (player.state === "paused") player.unit = 0;
  };
  $("repeat").onchange = $("scope").onchange = updateButtons;

  const savedVol = lsGet("sutras.volume");
  if (savedVol !== null) $("volume").value = savedVol;
  const showVolume = () => { $("volumeOut").textContent = Math.round($("volume").value * 100) + "%"; };
  $("volume").oninput = () => { showVolume(); lsSet("sutras.volume", $("volume").value); };
  showVolume();

  $("playBtn").onclick = () => play(0);
  $("pauseBtn").onclick = () => (player.state === "paused" ? resume() : pause());
  $("stopBtn").onclick = stop;
  window.addEventListener("pagehide", stop);

  // ---------- 경전 추가 / 내보내기 / 가져오기 ----------
  const dlg = $("addDialog");
  $("addBtn").onclick = () => { $("addForm").reset(); dlg.showModal(); };
  $("cancelAdd").onclick = () => dlg.close();
  const paras = (s) => s.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);

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

  // ---------- 솔라나 지갑 ----------
  // Wallet Standard: 확장 프로그램/앱 내장 브라우저의 지갑이 스스로 등록한다.
  // Phantom, Solflare, Backpack, Jupiter, MetaMask 등 표준을 따르는 지갑이 자동으로 목록에 나타난다.
  const standardWallets = [];
  const registry = {
    register(...ws) {
      for (const w of ws) if (!standardWallets.includes(w)) standardWallets.push(w);
      return () => {};
    },
  };
  window.addEventListener("wallet-standard:register-wallet", (ev) => {
    try { ev.detail(registry); } catch { /* 잘못된 지갑 등록은 무시 */ }
  });
  try {
    window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: registry }));
  } catch { /* 지원하지 않는 환경 */ }

  const isSolana = (w) =>
    (w.chains || []).some((c) => String(c).startsWith("solana:")) && w.features && w.features["standard:connect"];

  // 표준을 아직 따르지 않는 구형 주입 provider
  const legacy = () => [
    ["Phantom", window.phantom && window.phantom.solana && window.phantom.solana.isPhantom ? window.phantom.solana : null],
    ["Solflare", window.solflare && window.solflare.isSolflare ? window.solflare : null],
    ["Backpack", window.backpack && window.backpack.isBackpack ? window.backpack : null],
  ].filter(([, p]) => p);

  function detectedWallets() {
    const list = standardWallets.filter(isSolana).map((w) => ({
      name: w.name,
      icon: w.icon,
      async connect() {
        const r = await w.features["standard:connect"].connect();
        const acct = (r && r.accounts && r.accounts[0]) || w.accounts[0];
        if (!acct) throw new Error("no account");
        const ev = w.features["standard:events"];
        if (ev) ev.on("change", ({ accounts }) => { if (accounts && !accounts.length) onDisconnect(); });
        return acct.address;
      },
      async disconnect() {
        const d = w.features["standard:disconnect"];
        if (d) await d.disconnect();
      },
    }));
    for (const [name, p] of legacy()) {
      if (list.some((x) => x.name.toLowerCase() === name.toLowerCase())) continue;
      list.push({
        name,
        async connect() {
          const r = await p.connect();
          const pk = (r && r.publicKey) || p.publicKey;
          if (p.on) p.on("disconnect", onDisconnect);
          return pk.toString();
        },
        disconnect: () => p.disconnect(),
      });
    }
    return list;
  }

  // 지갑 설치 페이지와, 스마트폰 지갑 앱의 내장 브라우저에서 이 사이트를 여는 딥링크.
  // 앱 내장 브라우저에서는 지갑이 위 방식으로 자동 감지된다.
  const here = () => location.origin + location.pathname;
  const KNOWN = [
    { key: "phantom", name: "Phantom", url: "https://phantom.app/download",
      deeplink: () => `https://phantom.app/ul/browse/${encodeURIComponent(here())}?ref=${encodeURIComponent(location.origin)}` },
    { key: "solflare", name: "Solflare", url: "https://solflare.com/download",
      deeplink: () => `https://solflare.com/ul/v1/browse/${encodeURIComponent(here())}?ref=${encodeURIComponent(location.origin)}` },
    { key: "metamask", name: "MetaMask", url: "https://metamask.io/download",
      deeplink: () => `https://link.metamask.io/dapp/${location.host}${location.pathname}` },
    { key: "backpack", name: "Backpack", url: "https://backpack.app/download" },
    { key: "jupiter", name: "Jupiter", url: "https://docs.jup.ag/user-docs/manage/extension-wallet" },
  ];
  const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

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

  async function connectWith(w) {
    try {
      const addr = await w.connect();
      wallet = { name: w.name, disconnect: w.disconnect, addr };
      $("walletDialog").close();
      $("walletBtn").textContent = t("walletDisconnect");
      await refreshInfo();
    } catch {
      alert(t("walletFail"));
    }
  }

  function walletRow(tag, children, props) {
    const li = document.createElement("li");
    const el = document.createElement(tag);
    Object.assign(el, props);
    el.append(...children);
    li.append(el);
    return li;
  }

  function renderWalletChoices() {
    const box = $("walletChoices");
    box.textContent = "";
    const detected = detectedWallets();
    const section = (titleKey) => {
      const h = document.createElement("h3");
      h.textContent = t(titleKey);
      const ul = document.createElement("ul");
      ul.className = "wlist";
      box.append(h, ul);
      return ul;
    };

    const dUl = section("walletDetected");
    if (!detected.length) {
      const p = document.createElement("p");
      p.className = "note";
      p.textContent = t("walletNoneDetected");
      dUl.replaceWith(p);
    }
    for (const w of detected) {
      let icon;
      if (w.icon && /^data:image\//.test(w.icon)) { icon = document.createElement("img"); icon.src = w.icon; icon.alt = ""; }
      else { icon = document.createElement("span"); icon.className = "ph"; }
      const label = document.createElement("span");
      label.textContent = w.name;
      const row = walletRow("button", [icon, label], { type: "button" });
      row.firstChild.onclick = () => connectWith(w);
      dUl.append(row);
    }

    const has = (k) => detected.some((w) => w.name.toLowerCase().includes(k));
    if (isMobile() && !detected.length) {
      const p = document.createElement("p");
      p.className = "note";
      p.textContent = t("walletMobileHint");
      const mUl = section("walletMobile");
      mUl.before(p);
      for (const k of KNOWN.filter((x) => x.deeplink)) {
        mUl.append(walletRow("a", [document.createTextNode(t("walletOpenIn", k.name))],
          { href: k.deeplink(), rel: "noopener" }));
      }
    }
    const missing = KNOWN.filter((k) => !has(k.key));
    if (missing.length) {
      const oUl = section("walletOther");
      for (const k of missing) {
        oUl.append(walletRow("a", [document.createTextNode(`${k.name} · ${t("walletInstall")}`)],
          { href: k.url, target: "_blank", rel: "noopener noreferrer" }));
      }
    }
  }

  $("walletBtn").onclick = async () => {
    if (wallet) {
      try { await wallet.disconnect(); } catch { /* ignore */ }
      onDisconnect();
    } else {
      renderWalletChoices();
      $("walletDialog").showModal();
    }
  };
  $("closeWallet").onclick = () => $("walletDialog").close();
  $("network").onchange = refreshInfo;

  // ---------- 화면 언어 전환 / 시작 ----------
  $("uiLang").onchange = () => {
    uiLang = $("uiLang").value;
    lsSet(UI_KEY, uiLang);
    applyUiText();
    renderList();
    renderParas();
    populateVoiceNames();
    showNote(noteKey);
    if ($("walletDialog").open) renderWalletChoices();
  };

  applyUiText();
  renderList();
})();
