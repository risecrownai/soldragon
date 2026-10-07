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
    const base = [...window.DEFAULT_SUTRAS, ...(cloudOn() ? Cloud.state.sutras : []), ...custom];
    const rank = (s) => { const i = order.indexOf(s.id); return i === -1 ? Infinity : i; };
    return base
      .map((s, i) => [s, i])
      .sort((a, b) => (rank(a[0]) - rank(b[0])) || (a[1] - b[1]))
      .map(([s]) => s);
  };

  let selectedId = null; // 순서 변경 모드에서 고른 경전

  // 클라우드가 설정되어 있으면(/api 준비 완료) 구글 로그인 + 서버가 확인한 지갑이 있어야 추가·수정·삭제할 수 있다.
  // 설정이 없으면 예전처럼 지갑이 연결된 때만 브라우저에 저장하게 한다.
  const cloudOn = () => !!(window.Cloud && Cloud.state.ready);
  const canEdit = () => (cloudOn() ? Cloud.canWrite() : !!wallet);
  // 이 경전을 내가 고칠 수 있는가: 클라우드 경전은 내 것만, 브라우저 경전은 지갑 연결 시
  const canEditItem = (s) => (s.cloud ? s.mine && canEdit() : !!wallet);
  const lockHint = () => t(cloudOn() ? "editLockedCloud" : "editLocked");
  const findCustom = (id) => custom.find((c) => c.id === id) || (cloudOn() ? Cloud.state.sutras.find((c) => c.id === id) : null);
  const cloudErr = (e) => alert(Cloud.errText(e));

  const indexOfId = (id) => all().findIndex((s) => s.id === id);

  function moveTo(id, newIdx, refocus) {
    const ids = all().map((s) => s.id);
    const i = ids.indexOf(id);
    const j = Math.max(0, Math.min(ids.length - 1, newIdx));
    if (i < 0 || i === j) return;
    ids.splice(j, 0, ids.splice(i, 1)[0]);
    order = ids;
    lsSet(ORDER_KEY, JSON.stringify(order));
    renderList();
    const el = document.querySelector("#sutraList li.selected");
    if (el) {
      el.scrollIntoView({ block: "nearest" });
      if (refocus) el.querySelector("button.item").focus();
    }
  }

  function renderReorderBar() {
    const last = all().length - 1;
    const i = selectedId ? indexOfId(selectedId) : -1;
    $("reorderBar").hidden = !reorderMode;
    $("mvTop").disabled = $("mvUp").disabled = i <= 0;
    $("mvDown").disabled = $("mvBottom").disabled = i < 0 || i >= last;
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
      if (reorderMode) {
        const picked = selectedId === s.id;
        if (picked) li.classList.add("selected");
        b.setAttribute("aria-pressed", String(picked));
      }
      b.onclick = () => {
        if (reorderMode) {
          // 순서 변경 모드: 경전을 고른다(다시 누르면 선택 해제)
          selectedId = selectedId === s.id ? null : s.id;
          renderList();
          const el = document.querySelector("#sutraList li.selected button.item");
          if (el) el.focus();
          return;
        }
        open(s.id, true);
        $("sidebar").classList.remove("open");
      };
      b.onkeydown = (ev) => {
        if (!reorderMode || selectedId !== s.id) return;
        if (ev.key === "ArrowUp") { ev.preventDefault(); moveTo(s.id, idx - 1, true); }
        else if (ev.key === "ArrowDown") { ev.preventDefault(); moveTo(s.id, idx + 1, true); }
      };
      if (s.custom && cloudOn()) {
        const badge = document.createElement("span");
        badge.className = "badge" + (s.cloud ? (s.isPublic ? " pub" : " priv") : " loc");
        badge.textContent = s.cloud ? t(s.isPublic ? "badgePublic" : "badgePrivate") : t("badgeLocal");
        if (s.cloud && !s.mine) badge.title = t("authorBy", s.author);
        else if (s.cloud) badge.title = t(s.isPublic ? "visPublic" : "visPrivate");
        b.append(" ", badge);
      }
      li.append(b);
      if (s.custom && !reorderMode && (!s.cloud || s.mine)) {
        const ok = canEditItem(s);
        const ed = document.createElement("button");
        ed.className = "edit";
        ed.textContent = "✎";
        ed.title = ok ? t("edit") : lockHint();
        ed.setAttribute("aria-label", `${t("edit")}: ${titleOf(s)}`);
        ed.disabled = !ok;
        ed.onclick = () => openEditor(s.id);
        const d = document.createElement("button");
        d.className = "del";
        d.textContent = "✕";
        d.title = ok ? t("del") : lockHint();
        d.setAttribute("aria-label", `${t("del")}: ${titleOf(s)}`);
        d.disabled = !ok;
        d.onclick = async () => {
          if (!canEditItem(s)) return;
          if (!confirm(t("delConfirm", titleOf(s)))) return;
          if (s.cloud) {
            try { await Cloud.removeSutra(s.id); } catch (e) { cloudErr(e); return; }
          } else {
            custom = custom.filter((c) => c.id !== s.id);
            saveCustom(custom);
          }
          if (current && current.id === s.id) { stop(); current = null; $("reader").hidden = true; $("homeHero").hidden = false; $("empty").hidden = false; }
          renderList();
        };
        const extra = [];
        if (!s.cloud && cloudOn()) {
          // 이 브라우저의 경전을 클라우드(비공개)로 옮긴다
          const mv = document.createElement("button");
          mv.className = "edit";
          mv.textContent = "☁";
          mv.title = canEdit() ? t("moveToCloud") : lockHint();
          mv.setAttribute("aria-label", `${t("moveToCloud")}: ${titleOf(s)}`);
          mv.disabled = !canEdit();
          mv.onclick = async () => {
            if (!canEdit() || !confirm(t("moveConfirm", titleOf(s)))) return;
            try {
              await Cloud.importSutras([{ title: s.title, lang: s.lang, paragraphs: s.paragraphs }]);
            } catch (e) { cloudErr(e); return; }
            custom = custom.filter((c) => c.id !== s.id);
            saveCustom(custom);
            if (current && current.id === s.id) goHome();
            renderList();
            alert(t("movedToCloud", 1));
          };
          extra.push(mv);
        }
        li.append(...extra, ed, d);
      }
      ul.append(li);
    });
    renderReorderBar();
  }

  $("reorderBtn").onclick = () => {
    reorderMode = !reorderMode;
    selectedId = null;
    $("reorderBtn").textContent = t(reorderMode ? "reorderDone" : "reorder");
    $("resetOrderBtn").hidden = !reorderMode;
    renderList();
  };
  $("resetOrderBtn").onclick = () => {
    order = [];
    lsSet(ORDER_KEY, "[]");
    renderList();
  };
  $("mvTop").onclick = () => moveTo(selectedId, 0);
  $("mvUp").onclick = () => moveTo(selectedId, indexOfId(selectedId) - 1);
  $("mvDown").onclick = () => moveTo(selectedId, indexOfId(selectedId) + 1);
  $("mvBottom").onclick = () => moveTo(selectedId, all().length - 1);

  // 지갑 연결 여부에 따라 추가·가져오기 버튼과 수정·삭제 버튼을 잠그거나 푼다.
  function updateEditLock() {
    const ok = canEdit();
    $("addBtn").disabled = !ok;
    $("importFile").disabled = !ok;
    $("importLabel").classList.toggle("disabled", !ok);
    $("addBtn").title = $("importLabel").title = ok ? "" : lockHint();
    $("editHint").textContent = lockHint();
    $("editHint").hidden = ok;
    if (!ok && $("addDialog").open) $("addDialog").close();
    renderList();
  }

  // 홈 화면: 낭독을 멈추고 경전 선택을 해제한다.
  function goHome() {
    stop();
    current = null;
    $("reader").hidden = true;
    $("homeHero").hidden = false;
    $("empty").hidden = false;
    $("sidebar").classList.remove("open");
    renderList();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  document.addEventListener("click", (ev) => {
    if (ev.target.closest("[data-home]")) goHome();
  });

  function open(id, fromUser) {
    stop();
    current = all().find((s) => s.id === id);
    if (!current) return;
    $("empty").hidden = true;
    $("homeHero").hidden = true; // 경전 화면에서는 경전별 그림만 보여 준다
    $("reader").hidden = false;
    renderParas();
    renderList();
    populateVoiceNames();
    mountSocial();
    // 브라우저 정책상 사용자 클릭 이후에만 자동 재생이 가능합니다.
    if (fromUser && $("auto").checked) play(0);
  }

  // 좋아요·점수·댓글: 기본 경전과 공개된 클라우드 경전에만 붙는다(브라우저에만 있는 경전은 제외).
  function mountSocial() {
    const box = $("social");
    if (!cloudOn() || !current || (current.custom && !current.cloud)) { box.hidden = true; box.textContent = ""; return; }
    Cloud.mountSocial(box, current.id, { socialAllowed: !current.cloud || current.isPublic });
  }

  // 경전에 맞는 상단 그림(부처님, 비로자나불, 관세음보살, 연꽃, 용, 태양 중 선택)
  function renderHero() {
    const hero = $("readerHero");
    hero.textContent = "";
    hero.dataset.theme = current.heroTheme || "gold";
    for (const key of current.hero || ["dragon", "sun", "lotus"]) {
      const img = document.createElement("img");
      img.src = `images/${key}.svg`;
      if (key === "sun") {
        // 상단의 태양 그림을 누르면 홈 화면으로 돌아간다
        const btn = document.createElement("button");
        btn.className = "home-sun";
        btn.dataset.home = "";
        btn.title = t("goHome");
        btn.setAttribute("aria-label", t("goHome"));
        img.alt = "";
        btn.append(img);
        hero.append(btn);
        continue;
      }
      img.alt = t("alt" + key.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(""));
      hero.append(img);
    }
  }

  function renderParas() {
    if (!current) return;
    $("title").textContent = titleOf(current);
    renderHero();
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
  const FEMALE_RE = /\bfemale\b|woman|여성|女|sun-?hi|yuna|heami|seoyeon|seo-?hyeon|ji-?min|soon-?bok|yu-?jin|ting-?ting|mei-?jia|sin-?ji|yu-?shu|xiao|hui-?hui|yaoyao|zira|jenny|aria|sara\b|nancy|amber|ashley|jane\b|michelle|samantha|karen|moira|tessa|victoria|fiona|susan|hazel|libby|sonia|emma|ava\b|allison|kathy|joanna|salli|kendra|kimberly|ivy|zoe|kate\b|serena|nicky|catherine|lekha|swara|kalpana|heera|priya|veena|google (한국어|korean|普通话|中文|hindi|हिन्दी|us english)/i;
  const MALE_RE = /\bmale\b|남성|男|in-?joon|hyun-?su|bongjin|gookmin|kang-?kang|li-?mu|yun-?(yang|xi|jian|feng|hao|ye|ze)|david|\bmark\b|alex\b|daniel|\bfred\b|\bguy\b|davis|jason|tony|ryan|george|james|richard|\btom\b|aaron|arthur|oliver|evan|gordon|brandon|christopher|eric\b|roger|steffan|hemant|madhur|ravi\b|rishi/i;

  // 이름으로 성별을 추정한다. 구분할 수 없으면 null.
  function genderOf(name) {
    const f = FEMALE_RE.test(name);
    const m = MALE_RE.test(name);
    if (f && !m) return "f";
    if (m && !f) return "m";
    return null;
  }

  // 읽을 언어에 맞는 음성. 사용자가 목록에서 직접 고른 음성이 있으면 그것을, 없으면 기기의 기본 음성을 쓴다.
  function pickVoice(lang) {
    const voices = tts.getVoices();
    const base = lang.split("-")[0];
    const cands = [...voices.filter((v) => v.lang === lang), ...voices.filter((v) => v.lang !== lang && v.lang.startsWith(base))];
    if (!cands.length) return null;
    const saved = lsGet(NAME_KEY + lang);
    return (saved && cands.find((v) => v.name === saved)) || cands[0];
  }
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
      const voice = pickVoice(lang);
      if (voice) u.voice = voice;
      // 원하는 성별의 음성이 이 기기에 없으면 음높이로 근사한다.
      u.pitch = Math.min(2, Math.max(0.1, parseFloat($("pitch").value)));
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
    showNote(langs.some((l) => !pickVoice(l)) ? "noVoice" : "");
  }
  if (tts) tts.onvoiceschanged = () => { populateVoiceNames(); if (player.state !== "idle") refreshVoiceNote(); };

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
    if (!tts || !lang) { $("voiceNameLabel").hidden = true; return; }
    const base = lang.split("-")[0];
    // 성별을 이름으로 구분할 수 없는 음성은 목록에 보이지 않게 한다.
    const list = tts.getVoices()
      .filter((v) => v.lang === lang || v.lang.startsWith(base))
      .map((v) => [v, genderOf(v.name)])
      .filter(([, g]) => g);
    for (const [v, g] of list) {
      const o = document.createElement("option");
      o.value = v.name;
      o.textContent = `${t(g === "f" ? "voiceFemale" : "voiceMale")} · ${v.name}`;
      sel.append(o);
    }
    // 고를 수 있는 음성이 없으면 메뉴 자체를 숨긴다(기본 음성으로 읽는다).
    $("voiceNameLabel").hidden = !list.length;
    const saved = lsGet(NAME_KEY + lang);
    sel.value = saved && list.some(([v]) => v.name === saved) ? saved : "";
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

  // ---------- 경전 추가·수정 / 내보내기 / 가져오기 ----------
  const dlg = $("addDialog");
  let editingId = null; // null이면 새 경전 추가, 아니면 수정 중인 경전 id
  const BLANK = "-"; // 번역이 없는 문단을 표시하는 한 줄(수정 창에서 문단 위치를 유지하기 위해)
  const paras = (s) => s.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  const clean = (v) => (v === BLANK ? "" : v);
  // 뒤쪽의 빈 문단은 버리고, 중간에 낀 빈 문단은 BLANK로 채워 위치가 어긋나지 않게 한다.
  const joinParas = (arr) => {
    let last = arr.length - 1;
    while (last >= 0 && !arr[last]) last--;
    return arr.slice(0, last + 1).map((x) => x || BLANK).join("\n\n");
  };

  function openEditor(id) {
    if (!canEdit()) return;
    const sutra = id ? findCustom(id) : null;
    if (id && !sutra) return;
    if (sutra && !canEditItem(sutra)) return;
    editingId = sutra ? sutra.id : null;
    $("addForm").reset();
    const f = $("addForm").elements;
    // 클라우드에 저장하는 경전(새로 추가하거나 클라우드 경전을 고칠 때)만 공개 범위를 고른다.
    const toCloud = cloudOn() && (!sutra || sutra.cloud);
    $("visLabel").hidden = !toCloud;
    f.visibility.value = sutra && sutra.cloud && sutra.isPublic ? "public" : "private";
    if (sutra) {
      f.title.value = sutra.title;
      if (![...f.lang.options].some((o) => o.value === sutra.lang)) f.lang.append(new Option(sutra.lang, sutra.lang));
      f.lang.value = sutra.lang;
      f.orig.value = joinParas(sutra.paragraphs.map((p) => p.orig));
      f.en.value = joinParas(sutra.paragraphs.map((p) => p.en));
      f.ko.value = joinParas(sutra.paragraphs.map((p) => p.ko));
    }
    const titleKey = editingId ? "editTitle" : "addTitle";
    const submitKey = editingId ? "save" : "add";
    $("addDialogTitle").dataset.i18n = titleKey;
    $("addDialogTitle").textContent = t(titleKey);
    $("addSubmit").dataset.i18n = submitKey;
    $("addSubmit").textContent = t(submitKey);
    dlg.showModal();
  }
  $("addBtn").onclick = () => openEditor(null);
  $("cancelAdd").onclick = () => dlg.close();
  dlg.addEventListener("close", () => { editingId = null; });

  $("addForm").addEventListener("submit", async (ev) => {
    if (!canEdit()) return;
    const f = new FormData($("addForm"));
    const o = paras(f.get("orig")).map(clean);
    const e = paras(f.get("en")).map(clean);
    const k = paras(f.get("ko")).map(clean);
    if (!o.length) return;
    const data = {
      title: f.get("title").trim(),
      lang: f.get("lang"),
      paragraphs: o.map((orig, i) => ({ orig, en: e[i] || "", ko: k[i] || "" })),
    };
    const editId = editingId;
    const target = editId ? findCustom(editId) : null;
    if (cloudOn() && (!editId || (target && target.cloud))) {
      // 클라우드 저장: 서버가 성공해야 창을 닫는다(실패하면 입력 내용을 그대로 둔다).
      ev.preventDefault();
      $("addSubmit").disabled = true;
      try {
        const saved = await Cloud.saveSutra(editId, { ...data, isPublic: f.get("visibility") === "public" });
        dlg.close();
        const wasOpen = current && current.id === saved.id;
        renderList();
        if (wasOpen || !editId) open(saved.id, false);
      } catch (e) { cloudErr(e); } finally { $("addSubmit").disabled = false; }
      return;
    }
    if (editingId) {
      const sutra = custom.find((c) => c.id === editingId);
      if (!sutra) return;
      Object.assign(sutra, data);
      saveCustom(custom);
      const wasOpen = current && current.id === sutra.id;
      renderList();
      if (wasOpen) open(sutra.id, false); // 수정한 내용으로 다시 그린다(낭독은 멈춘다)
      return;
    }
    const sutra = { id: "c" + Date.now().toString(36), custom: true, ...data };
    custom.push(sutra);
    saveCustom(custom);
    renderList();
    open(sutra.id, false);
  });

  // 내보내기: 고른 경전만 JSON 파일로 저장한다(직접 추가한 경전만 대상).
  // 내보낼 수 있는 경전: 내 클라우드 경전 + 이 브라우저의 경전
  const exportable = () => [...(cloudOn() ? Cloud.state.sutras.filter((x) => x.mine) : []), ...custom];
  const exportBoxes = () => [...$("exportList").querySelectorAll("input")];
  function syncExport() {
    const boxes = exportBoxes();
    const n = boxes.filter((x) => x.checked).length;
    $("exportAll").checked = boxes.length > 0 && n === boxes.length;
    $("exportAll").indeterminate = n > 0 && n < boxes.length;
    $("exportGo").disabled = n === 0;
    $("exportCount").textContent = boxes.length ? t("exportCount", n) : "";
  }
  $("exportBtn").onclick = () => {
    const ul = $("exportList");
    ul.textContent = "";
    for (const s of exportable()) {
      const li = document.createElement("li");
      const label = document.createElement("label");
      label.className = "check";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = s.id;
      box.checked = true;
      box.onchange = syncExport;
      const name = document.createElement("span");
      name.textContent = titleOf(s);
      label.append(box, name);
      li.append(label);
      ul.append(li);
    }
    const none = exportable().length === 0;
    $("exportEmpty").hidden = !none;
    $("exportAllLabel").hidden = none;
    syncExport();
    $("exportDialog").showModal();
  };
  $("exportAll").onchange = () => {
    for (const b of exportBoxes()) b.checked = $("exportAll").checked;
    syncExport();
  };
  $("cancelExport").onclick = () => $("exportDialog").close();
  $("exportForm").addEventListener("submit", () => {
    const ids = new Set(exportBoxes().filter((x) => x.checked).map((x) => x.value));
    const picked = exportable().filter((s) => ids.has(s.id)).map((s) => ({ title: s.title, lang: s.lang, paragraphs: s.paragraphs }));
    if (!picked.length) return;
    const blob = new Blob([JSON.stringify(picked, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "my-sutras.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("importFile").onchange = async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = "";
    if (!file || !canEdit()) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data)) throw new Error();
      const list = [];
      for (const s of data) {
        if (!s || typeof s.title !== "string" || !Array.isArray(s.paragraphs)) continue;
        const ps = s.paragraphs
          .filter((p) => p && typeof p.orig === "string")
          .map((p) => ({
            orig: p.orig,
            en: typeof p.en === "string" ? p.en : "",
            ko: typeof p.ko === "string" ? p.ko : "",
          }));
        if (!ps.length) continue;
        list.push({ title: s.title.slice(0, 100), lang: typeof s.lang === "string" ? s.lang : "en-US", paragraphs: ps });
      }
      if (cloudOn()) {
        // 클라우드에는 항상 비공개로 올린다(공개는 경전을 열어 직접 바꾼다).
        let n = 0;
        if (list.length) {
          try { n = await Cloud.importSutras(list.slice(0, 50)); } catch (e) { cloudErr(e); return; }
        }
        renderList();
        alert(t("imported", n));
        return;
      }
      list.forEach((s, n) => custom.push({ id: "c" + Date.now().toString(36) + n, custom: true, ...s }));
      saveCustom(custom);
      renderList();
      alert(t("imported", list.length));
    } catch {
      alert(t("badJson"));
    }
  };

  $("menuBtn").onclick = () => $("sidebar").classList.toggle("open");

  // ---------- 솔라나 지갑 (Jupiter, Backpack, MetaMask) ----------
  // Wallet Standard: 지갑이 스스로 등록하는 방식. 이 사이트는 Jupiter, Backpack, MetaMask만 지원한다.
  const ALLOWED = /jupiter|backpack|metamask/i;
  const standardWallets = [];
  const registry = {
    register(...ws) {
      for (const w of ws) if (!standardWallets.includes(w)) standardWallets.push(w);
      refreshWalletDialog(); // 늦게 등록되는 지갑도 열려 있는 창에 반영한다
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

  // 표준을 아직 따르지 않는 구형 주입 provider (Backpack)
  const legacyProvidersFor = (name) => {
    if (!/backpack/i.test(name) || !window.backpack) return [];
    // Backpack은 버전에 따라 window.backpack 또는 window.backpack.solana에 연결 함수가 있다.
    return [window.backpack, window.backpack.solana].filter((p) => p && typeof p.connect === "function");
  };
  const legacy = () => [
    ["Backpack", window.backpack && window.backpack.isBackpack ? window.backpack : null],
  ].filter(([, p]) => p);

  // 같은 이름의 솔라나 지갑이 여러 개 등록될 수 있다(예: MetaMask 확장 프로그램이 직접 등록한 것 + 이 사이트가 SDK로 등록한 것).
  // 이름별로 묶어 두고, 하나가 실패하면(거절이 아니라면) 다음 것으로 이어서 시도한다.
  function detectedWallets() {
    const groups = new Map();
    for (const w of standardWallets.filter(isSolana)) {
      if (!ALLOWED.test(w.name)) continue;
      const key = w.name.toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(w);
    }

    const viaStandard = async (w) => {
      const r = await w.features["standard:connect"].connect();
      const acct = (r && r.accounts && r.accounts[0]) || (w.accounts && w.accounts[0]);
      if (!acct) { const err = new Error(t("walletNoAccount")); err.noAccount = true; throw err; }
      const ev = w.features["standard:events"];
      if (ev) ev.on("change", ({ accounts }) => { if (accounts && !accounts.length) onDisconnect(); });
      return acct;
    };

    const list = [];
    for (const ws of groups.values()) {
      const lps = legacyProvidersFor(ws[0].name);
      let connectedWith = null; // 연결에 성공한 방식(해제할 때 사용)
      let connectedAcct = null;
      list.push({
        name: ws[0].name,
        icon: ws[0].icon,
        async connect() {
          let first = null;
          for (const w of ws) {
            try {
              const acct = await viaStandard(w);
              connectedWith = w;
              connectedAcct = acct;
              return acct.address;
            } catch (e) {
              if (isRejection(e)) throw e; // 사용자가 거절했으면 다른 방식을 더 시도하지 않는다
              if (!first) first = e;
              else first.fallbackError = e;
            }
          }
          // 그래도 안 되면 같은 지갑의 구형 주입 provider로 시도한다.
          for (const lp of lps) {
            try {
              const r = await lp.connect();
              const pk = (r && r.publicKey) || lp.publicKey;
              if (!pk) throw new Error("no publicKey");
              connectedWith = lp;
              return pk.toString();
            } catch (e2) {
              if (isRejection(e2)) throw e2;
              first.fallbackError = e2;
            }
          }
          throw first;
        },
        // 클라우드 계정에 지갑을 묶을 때 쓰는 메시지 서명(거래가 아니다)
        async signMessage(bytes) {
          const w = connectedWith;
          const f = w && w.features && w.features["solana:signMessage"];
          if (f) {
            const [out] = await f.signMessage({ account: connectedAcct, message: bytes });
            return out.signature;
          }
          if (w && typeof w.signMessage === "function") {
            const r = await w.signMessage(bytes, "utf8");
            return (r && r.signature) || r;
          }
          const err = new Error("sign unsupported");
          err.code = "sign_unsupported";
          throw err;
        },
        async disconnect() {
          const w = connectedWith;
          if (!w) return;
          const d = w.features && w.features["standard:disconnect"];
          if (d) await d.disconnect();
          else if (w.disconnect) await w.disconnect();
        },
      });
    }
    for (const [name, p] of legacy()) {
      if (list.some((x) => x.name.toLowerCase() === name.toLowerCase())) continue;
      list.push({
        name,
        async connect() {
          const r = await p.connect();
          const pk = (r && r.publicKey) || p.publicKey;
          if (!pk) { const err = new Error(t("walletNoAccount")); err.noAccount = true; throw err; }
          if (p.on) p.on("disconnect", onDisconnect);
          return pk.toString();
        },
        async signMessage(bytes) {
          if (typeof p.signMessage !== "function") { const err = new Error("sign unsupported"); err.code = "sign_unsupported"; throw err; }
          const r = await p.signMessage(bytes, "utf8");
          return (r && r.signature) || r;
        },
        disconnect: () => p.disconnect(),
      });
    }
    return list;
  }

  // MetaMask는 사이트가 공식 SDK(@metamask/connect-solana)를 불러와야 솔라나 지갑으로 등록된다.
  // 용량(약 630KB) 때문에 지갑 창을 처음 열 때만 불러온다(vendor/metamask-solana.js).
  let mmState = "idle"; // idle | loading | ready | failed
  async function loadMetaMask() {
    if (mmState !== "idle") return;
    mmState = "loading";
    refreshWalletDialog();
    try {
      const mod = await import("./vendor/metamask-solana.js");
      const client = await mod.createSolanaClient({
        dapp: { name: t("siteTitle"), url: location.origin },
        api: { supportedNetworks: { mainnet: "https://api.mainnet-beta.solana.com", devnet: "https://api.devnet.solana.com" } },
        analytics: { enabled: false },
      });
      registry.register(client.getWallet());
      mmState = "ready";
    } catch (e) {
      console.error("MetaMask SDK 불러오기 실패", e);
      mmState = "failed";
    }
    refreshWalletDialog();
  }

  // 지갑 설치 페이지와, 스마트폰에서 MetaMask 앱의 내장 브라우저로 이 사이트를 여는 딥링크.
  const KNOWN = [
    { key: "jupiter", name: "Jupiter", url: "https://docs.jup.ag/user-docs/manage/extension-wallet" },
    { key: "backpack", name: "Backpack", url: "https://backpack.app/download" },
    { key: "metamask", name: "MetaMask", url: "https://metamask.io/download",
      deeplink: () => `https://link.metamask.io/dapp/${location.host}${location.pathname}` },
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
    updateEditLock();
  }

  // 연결 실패의 실제 원인을 사용자가 볼 수 있게 한다(거절/취소와 그 밖의 실패를 구분하고, 원본 오류도 함께 보여 준다).
  const REJECT_RE = /reject|denied|declin|cancel|closed|dismiss|refus|거절|취소/i;
  const errMessage = (e) => String((e && (e.message || (e.error && e.error.message))) || e || "").slice(0, 200);
  const errCode = (e) => (e && (e.code !== undefined ? e.code : e.error && e.error.code));
  function isRejection(e) {
    return errCode(e) === 4001 || REJECT_RE.test(String(e && e.name) + " " + errMessage(e));
  }
  function rawError(e) {
    const parts = [e && e.name, errCode(e) !== undefined ? `code ${errCode(e)}` : null, errMessage(e)].filter(Boolean);
    if (e && e.fallbackError) parts.push(`(fallback: ${errMessage(e.fallbackError)})`);
    return parts.join(" · ");
  }
  function describeError(e) {
    if (e && e.noAccount) return { text: errMessage(e), detail: "" };
    // 지갑이 "Not Connected"라고만 답하면: 잠겨 있거나 계정이 선택되지 않았거나 다른 지갑 확장과 충돌한 경우가 많다.
    const hint = /not connected/i.test(errMessage(e) + " " + errMessage(e && e.fallbackError)) ? t("walletHintNotConnected") : "";
    return { text: isRejection(e) ? t("walletRejected") : t("walletFailed"), detail: rawError(e), hint };
  }

  function setWalletMsg(text, detail, hint) {
    const m = $("walletMsg");
    m.textContent = text || "";
    if (text && detail) {
      const s = document.createElement("small");
      s.className = "wdetail";
      s.textContent = detail;
      m.append(s);
    }
    if (text && hint) {
      const h = document.createElement("small");
      h.className = "wdetail whint";
      h.textContent = hint;
      m.append(h);
    }
    m.hidden = !text;
  }

  let lastError = null; // 진단 정보용
  // 가장 중요한 정보(마지막 오류, 등록된 지갑)를 맨 위에 둔다. 일부만 복사해도 원인이 들어가도록.
  function diagText() {
    const bp = window.backpack;
    const lines = [];
    lines.push(lastError ? `last error (${lastError.wallet}): ${lastError.raw}` : "last error: (none)");
    lines.push("registered wallets:");
    for (const w of standardWallets) {
      lines.push(`- ${w.name} | chains: ${(w.chains || []).join(",")} | features: ${Object.keys(w.features || {}).join(",")}`);
    }
    if (!standardWallets.length) lines.push("- (none)");
    lines.push(`legacy: window.backpack=${!!bp} (isBackpack=${!!(bp && bp.isBackpack)}, connect=${typeof (bp && bp.connect)}, solana=${typeof (bp && bp.solana)}) window.ethereum.isMetaMask=${!!(window.ethereum && window.ethereum.isMetaMask)}`);
    lines.push(`metamask sdk: ${mmState}`);
    lines.push(`site: ${location.origin}`);
    lines.push(`ua: ${navigator.userAgent}`);
    return lines.join("\n");
  }
  let diagOpen = false;

  let connecting = false; // 연결 요청이 진행 중이면 다른 지갑 버튼을 잠근다
  const setBusy = (on) => {
    connecting = on;
    $("walletChoices").querySelectorAll("button[data-w]").forEach((b) => { b.disabled = on; });
  };

  // 지갑이 오래 응답하지 않으면(창을 그냥 닫은 경우 등) 다시 시도할 수 있게 풀어 준다.
  const WALLET_WAIT_MS = 30000;
  let attempt = 0;

  async function connectWith(w) {
    const mine = ++attempt;
    setBusy(true);
    setWalletMsg(t("walletConnecting", w.name));
    const slow = setTimeout(() => {
      if (mine !== attempt || wallet) return;
      setBusy(false);
      setWalletMsg(`${w.name}: ${t("walletSlow")}`);
    }, WALLET_WAIT_MS);
    try {
      const addr = await w.connect();
      wallet = { name: w.name, disconnect: w.disconnect, signMessage: w.signMessage, addr };
      clearTimeout(slow);
      setWalletMsg("");
      setBusy(false);
      closeWalletDialog();
      $("walletBtn").textContent = t("walletDisconnect");
      updateEditLock();
      await refreshInfo();
    } catch (e) {
      clearTimeout(slow);
      console.error("지갑 연결 실패:", w.name, e);
      lastError = { wallet: w.name, raw: rawError(e) };
      if (mine === attempt) {
        const d = describeError(e);
        setWalletMsg(`${w.name}: ${d.text}`, d.detail, d.hint);
        setBusy(false);
        diagOpen = true; // 실패하면 진단 정보를 바로 펼쳐 복사할 수 있게 한다
        renderWalletChoices();
      }
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

  // 지갑 선택 창은 showModal()이 아니라 show()로 띄운다. 모달이면 창 밖의 모든 요소가 비활성(inert)이 되어
  // MetaMask SDK가 페이지에 띄우는 안내·QR 창을 누를 수 없고 창 뒤에 가려지기 때문이다.
  function openWalletDialog() {
    $("walletBackdrop").hidden = false;
    $("walletDialog").show();
    const first = $("walletChoices").querySelector("button:not(:disabled), a");
    if (first) first.focus();
  }
  function closeWalletDialog() {
    $("walletDialog").close();
    $("walletBackdrop").hidden = true;
  }

  function refreshDiag() {
    const pre = $("walletDiagText");
    if (pre) pre.textContent = diagText();
  }

  function refreshWalletDialog() {
    const d = $("walletDialog");
    if (d && d.open) renderWalletChoices();
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
    for (const w of detected) {
      let icon;
      if (w.icon && /^data:image\//.test(w.icon)) { icon = document.createElement("img"); icon.src = w.icon; icon.alt = ""; }
      else { icon = document.createElement("span"); icon.className = "ph"; }
      const label = document.createElement("span");
      label.textContent = w.name;
      const row = walletRow("button", [icon, label], { type: "button", disabled: connecting });
      row.firstChild.dataset.w = w.name;
      row.firstChild.onclick = () => connectWith(w);
      dUl.append(row);
    }
    const hasMM = detected.some((w) => /metamask/i.test(w.name));
    if (!hasMM && mmState === "loading") {
      const ph = document.createElement("span");
      ph.className = "ph";
      dUl.append(walletRow("button", [ph, document.createTextNode(t("walletMMLoading"))], { type: "button", disabled: true }));
    }
    if (!dUl.children.length) {
      const p = document.createElement("p");
      p.className = "note";
      p.textContent = t("walletNoneDetected");
      dUl.replaceWith(p);
    }

    if (isMobile()) {
      const mm = KNOWN.find((k) => k.key === "metamask");
      const p = document.createElement("p");
      p.className = "note";
      p.textContent = t("walletMobileHint");
      const mUl = section("walletMobile");
      mUl.before(p);
      mUl.append(walletRow("a", [document.createTextNode(t("walletOpenIn", mm.name))], { href: mm.deeplink(), rel: "noopener" }));
    }

    // 감지되지 않은 지갑의 설치 링크. MetaMask는 SDK가 불러와지지 않았을 때만 보여 준다.
    const has = (k) => detected.some((w) => w.name.toLowerCase().includes(k));
    const missing = KNOWN.filter((k) => !has(k.key) && (k.key !== "metamask" || mmState === "failed"));
    if (missing.length) {
      const oUl = section("walletOther");
      for (const k of missing) {
        oUl.append(walletRow("a", [document.createTextNode(`${k.name} · ${t("walletInstall")}`)],
          { href: k.url, target: "_blank", rel: "noopener noreferrer" }));
      }
    }
    if (mmState === "failed") {
      const p = document.createElement("p");
      p.className = "note";
      p.textContent = t("walletMMFail");
      box.append(p);
    }

    // 연결이 계속 실패할 때 원인을 알 수 있도록 진단 정보를 보여 준다.
    const det = document.createElement("details");
    det.className = "wdiag";
    det.open = diagOpen;
    det.addEventListener("toggle", () => { diagOpen = det.open; });
    const sum = document.createElement("summary");
    sum.textContent = t("walletDiag");
    const hint = document.createElement("p");
    hint.className = "note small";
    hint.textContent = t("walletDiagHint");
    const pre = document.createElement("pre");
    pre.id = "walletDiagText";
    pre.textContent = diagText();
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "btn small ghost";
    copy.textContent = t("copy");
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(pre.textContent); copy.textContent = t("copied"); } catch { /* 복사 불가 환경 */ }
    };
    det.append(sum, hint, pre, copy);
    box.append(det);
  }

  $("walletBtn").onclick = async () => {
    if (wallet) {
      try { await wallet.disconnect(); } catch { /* ignore */ }
      onDisconnect();
    } else {
      setWalletMsg("");
      renderWalletChoices();
      openWalletDialog();
      loadMetaMask();
    }
  };
  $("closeWallet").onclick = closeWalletDialog;
  $("walletDialog").addEventListener("close", () => { $("walletBackdrop").hidden = true; });
  $("walletBackdrop").addEventListener("click", closeWalletDialog);
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && $("walletDialog").open) closeWalletDialog();
  });
  $("network").onchange = refreshInfo;

  // ---------- 클라우드 계정 (구글 로그인 + 지갑 묶기) ----------
  const accountDlg = $("accountDialog");
  const accMsg = (text) => { $("accountMsg").textContent = text || ""; $("accountMsg").hidden = !text; };

  function refreshAccountButton() {
    const b = $("accountBtn");
    b.hidden = !cloudOn();
    if (!cloudOn()) return;
    b.textContent = Cloud.isLoggedIn() ? Cloud.state.me.user.name : t("accountBtn");
    b.title = Cloud.isLoggedIn() ? Cloud.state.me.user.email || "" : "";
  }

  function afterCloudChange() {
    refreshAccountButton();
    updateEditLock(); // 목록도 다시 그린다
    if (current && (current.cloud || !current.custom)) {
      const fresh = all().find((x) => x.id === current.id);
      if (!fresh) goHome(); else { current = fresh; mountSocial(); }
    }
    if (accountDlg.open) renderAccount();
  }

  const mkBtn = (key, onclick, cls = "btn") => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = t(key);
    b.onclick = onclick;
    return b;
  };
  const para = (text, cls = "note") => {
    const p = document.createElement("p");
    p.className = cls;
    p.textContent = text;
    return p;
  };

  function renderAccount() {
    const body = $("accountBody");
    body.textContent = "";
    if (!Cloud.isLoggedIn()) {
      body.append(para(t("loginLead")));
      const holder = document.createElement("div");
      holder.className = "gsi-holder";
      body.append(holder);
      Cloud.renderLoginButton(holder, () => { accMsg(""); afterCloudChange(); }, (e) => accMsg(Cloud.errText(e)));
      return;
    }
    const me = Cloud.state.me;
    body.append(para(t("loggedInAs", me.user.name + (me.user.email ? ` (${me.user.email})` : "")), ""));
    if (me.wallet) {
      body.append(para(t("walletLinkedAs", short(me.wallet.address)), ""));
      body.append(mkBtn("walletUnlink", async () => {
        try { await Cloud.unlinkWallet(); accMsg(""); afterCloudChange(); } catch (e) { accMsg(Cloud.errText(e)); }
      }, "btn small ghost"));
    } else {
      body.append(para(t("walletNotLinked")));
      if (!wallet) {
        body.append(mkBtn("walletLinkConnect", () => { accountDlg.close(); $("walletBtn").click(); }, "btn primary"));
      } else {
        body.append(mkBtn("walletLinkSign", async () => {
          // 지갑의 서명 창이 가려지지 않도록 이 창은 잠시 닫고, 끝나면 다시 연다.
          accountDlg.close();
          const note = $("walletInfo");
          note.hidden = false;
          note.textContent = t("signing");
          try {
            await Cloud.linkWallet(wallet);
            accMsg(t("linkedOk"));
          } catch (e) {
            console.error("지갑 묶기 실패", e);
            accMsg(e && e.code ? Cloud.errText(e) : `${t("errGeneric")} (${errMessage(e)})`);
          }
          refreshInfo();
          afterCloudChange();
          accountDlg.show();
          renderAccount();
        }, "btn primary"));
      }
    }
    const row = document.createElement("div");
    row.className = "acc-actions";
    row.append(
      mkBtn("logout", async () => {
        try { await Cloud.logout(); accMsg(""); afterCloudChange(); } catch (e) { accMsg(Cloud.errText(e)); }
      }),
      mkBtn("deleteAccount", async () => {
        if (!confirm(t("deleteAccountConfirm"))) return;
        try { await Cloud.deleteAccount(); accMsg(""); afterCloudChange(); } catch (e) { accMsg(Cloud.errText(e)); }
      }, "btn ghost"),
    );
    body.append(row);
  }

  $("accountBtn").onclick = () => { accMsg(""); accountDlg.show(); renderAccount(); };
  $("closeAccount").onclick = () => accountDlg.close();
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && accountDlg.open) accountDlg.close();
  });

  // ---------- 화면 언어 전환 / 시작 ----------
  $("uiLang").onchange = () => {
    uiLang = $("uiLang").value;
    lsSet(UI_KEY, uiLang);
    applyUiText();
    updateEditLock();
    renderParas();
    populateVoiceNames();
    showNote(noteKey);
    if ($("walletDialog").open) renderWalletChoices();
    refreshAccountButton();
    if (accountDlg.open) renderAccount();
    mountSocial();
  };

  applyUiText();
  updateEditLock();
  // 서버(/api)가 준비된 경우에만 클라우드 기능을 켠다. 아니면 예전처럼 브라우저 저장만 쓴다.
  if (window.Cloud) Cloud.init(t).then(() => { if (cloudOn()) afterCloudChange(); });
})();
