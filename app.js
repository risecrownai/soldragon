(() => {
  const $ = (id) => document.getElementById(id);
  const STORE = "sutras.custom.v1";

  // ---------- 경전 데이터 ----------
  const loadCustom = () => {
    try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch { return []; }
  };
  const saveCustom = (list) => {
    try { localStorage.setItem(STORE, JSON.stringify(list)); } catch { alert("브라우저 저장소를 사용할 수 없습니다."); }
  };
  let custom = loadCustom();
  const all = () => [...window.DEFAULT_SUTRAS, ...custom];
  let current = null;

  function renderList() {
    const ul = $("sutraList");
    ul.textContent = "";
    for (const s of all()) {
      const li = document.createElement("li");
      if (current && current.id === s.id) li.classList.add("active");
      const b = document.createElement("button");
      b.className = "item";
      b.textContent = s.title;
      b.onclick = () => { open(s.id, true); $("sidebar").classList.remove("open"); };
      li.append(b);
      if (s.custom) {
        const d = document.createElement("button");
        d.className = "del";
        d.textContent = "✕";
        d.title = "삭제";
        d.setAttribute("aria-label", `${s.title} 삭제`);
        d.onclick = () => {
          if (!confirm(`'${s.title}' 경전을 삭제할까요?`)) return;
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
    $("title").textContent = current.title;
    const box = $("paras");
    box.textContent = "";
    current.paragraphs.forEach((p, i) => {
      const d = document.createElement("div");
      d.className = "para";
      d.id = "p" + i;
      const label = document.createElement("div");
      label.className = "orig-label";
      label.textContent = current.origLabel || "원문";
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
      d.append(label, o, e, k);
      box.append(d);
    });
    applyMode();
    renderList();
    // 브라우저 정책상 사용자 클릭 이후에만 자동 재생이 가능합니다.
    if (fromUser && $("auto").checked) play();
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

  async function play() {
    if (!tts) { showNote("이 브라우저는 음성 낭독을 지원하지 않습니다."); return; }
    if (!current) return;
    stop();
    const my = ++token;
    const mode = $("mode").value;
    const rate = parseFloat($("rate").value);
    const wantOrig = mode === "all" || mode === "orig";
    if (wantOrig && !pickVoice(current.lang)) {
      showNote("이 기기에 원문 언어의 음성이 없어 기본 음성으로 읽을 수 있습니다. 영어·한국어 낭독은 해당 음성이 있으면 정상 작동합니다.");
    } else showNote("");
    for (let i = 0; i < current.paragraphs.length; i++) {
      if (my !== token) return;
      const p = current.paragraphs[i];
      const el = $("p" + i);
      el.classList.add("playing");
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      // 볼륨은 낭독 도중에도 조절할 수 있도록 매번 읽는다.
      const vol = () => parseFloat($("volume").value);
      if (wantOrig && p.orig) await speak(p.orig, p.lang || current.lang, rate, vol());
      if (my !== token) return;
      if ((mode === "all" || mode === "en") && p.en) await speak(p.en, "en-US", rate, vol());
      if (my !== token) return;
      if ((mode === "all" || mode === "ko") && p.ko) await speak(p.ko, "ko-KR", rate, vol());
      el.classList.remove("playing");
    }
  }

  function stop() {
    token++;
    if (tts) tts.cancel();
    document.querySelectorAll(".para.playing").forEach((e) => e.classList.remove("playing"));
  }

  function showNote(msg) {
    const n = $("ttsNote");
    n.textContent = msg;
    n.hidden = !msg;
  }

  if (tts) tts.onvoiceschanged = () => {};
  function applyMode() {
    $("paras").dataset.mode = $("mode").value;
  }
  $("mode").onchange = () => { applyMode(); if (token && tts && tts.speaking) play(); };

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

  $("playBtn").onclick = play;
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
      origLabel: "원문",
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
          origLabel: "원문",
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
      alert(`${n}개 경전을 가져왔습니다.`);
    } catch {
      alert("올바른 JSON 파일이 아닙니다.");
    }
  };

  $("menuBtn").onclick = () => $("sidebar").classList.toggle("open");

  // ---------- 솔라나 지갑 (외부 라이브러리 없이 주입된 provider 사용) ----------
  const providers = () => [
    ["Phantom", window.phantom && window.phantom.solana && window.phantom.solana.isPhantom ? window.phantom.solana : null, "https://phantom.app/"],
    ["Solflare", window.solflare && window.solflare.isSolflare ? window.solflare : null, "https://solflare.com/"],
    ["Backpack", window.backpack && window.backpack.isBackpack ? window.backpack : null, "https://backpack.app/"],
  ];
  let wallet = null;

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
    $("walletBtn").textContent = "지갑 연결";
  }

  async function connect() {
    const found = providers().filter(([, p]) => p);
    if (!found.length) {
      alert("솔라나 지갑이 감지되지 않았습니다. Phantom, Solflare, Backpack 중 하나를 설치한 뒤 새로고침하세요.");
      window.open(providers()[0][2], "_blank", "noopener");
      return;
    }
    let pick = found[0];
    if (found.length > 1) {
      const names = found.map(([n], i) => `${i + 1}. ${n}`).join("\n");
      const n = parseInt(prompt(`연결할 지갑 번호를 입력하세요:\n${names}`, "1"), 10);
      if (!found[n - 1]) return;
      pick = found[n - 1];
    }
    const provider = pick[1];
    try {
      const r = await provider.connect();
      const pk = (r && r.publicKey) || provider.publicKey;
      wallet = { name: pick[0], provider, addr: pk.toString() };
      $("walletBtn").textContent = "연결 해제";
      provider.on && provider.on("disconnect", onDisconnect);
      await refreshInfo();
    } catch (e) {
      alert("지갑 연결이 취소되었거나 실패했습니다.");
    }
  }

  $("walletBtn").onclick = async () => {
    if (wallet) {
      try { await wallet.provider.disconnect(); } catch { /* ignore */ }
      onDisconnect();
    } else connect();
  };
  $("network").onchange = refreshInfo;

  // ---------- 시작 ----------
  renderList();
})();
