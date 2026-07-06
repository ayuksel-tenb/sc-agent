// SC Agent — content script.
// Shows a floating chat launcher when the current URL matches a configured
// keyword, scrapes vulnerability context from the page, and streams replies
// from the Anthropic API via the background service worker.

(() => {
  const GREETING = "How can I help?";
  let settings = null;
  let host = null; // shadow host element
  let ui = {}; // cached shadow-root nodes
  let chatHistory = []; // API messages: {role, content}
  let streaming = false;

  const STYLES = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    .launcher {
      position: fixed; right: 20px; bottom: 20px; width: 56px; height: 56px;
      border-radius: 50%; border: none; cursor: pointer; z-index: 2147483000;
      background: #0b7285; color: #fff; box-shadow: 0 6px 20px rgba(0,0,0,.28);
      display: flex; align-items: center; justify-content: center; font-size: 24px;
      transition: transform .15s ease, background .15s ease;
    }
    .launcher:hover { transform: translateY(-2px); background: #0c8599; }
    .launcher.hidden { display: none; }

    .panel {
      position: fixed; right: 20px; bottom: 88px; width: 400px; height: 560px;
      max-height: calc(100vh - 108px); z-index: 2147483000;
      background: #fff; color: #1a1a1a; border-radius: 14px; overflow: hidden;
      box-shadow: 0 12px 40px rgba(0,0,0,.32); display: none; flex-direction: column;
    }
    .panel.open { display: flex; }
    .panel.expanded {
      right: 24px; bottom: 24px; top: 24px; width: min(880px, calc(100vw - 48px));
      height: auto; max-height: none;
    }

    .header {
      display: flex; align-items: center; gap: 10px; padding: 12px 14px;
      background: #0b7285; color: #fff; flex-shrink: 0;
    }
    .header .title { font-weight: 600; font-size: 14px; }
    .header .sub { font-size: 11px; opacity: .85; margin-top: 1px;
      max-width: 190px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .header .spacer { flex: 1; }
    .header button {
      background: rgba(255,255,255,.15); border: none; color: #fff; cursor: pointer;
      width: 30px; height: 30px; border-radius: 8px; font-size: 16px; line-height: 1;
      display: flex; align-items: center; justify-content: center;
    }
    .header button:hover { background: rgba(255,255,255,.28); }

    .messages { flex: 1; overflow-y: auto; padding: 14px; background: #f6f8fa; }
    .msg { margin-bottom: 12px; display: flex; }
    .msg.user { justify-content: flex-end; }
    .bubble {
      max-width: 82%; padding: 9px 12px; border-radius: 12px; font-size: 13.5px;
      line-height: 1.5; white-space: pre-wrap; word-wrap: break-word;
    }
    .msg.assistant .bubble { background: #fff; border: 1px solid #e3e6ea; border-bottom-left-radius: 3px; }
    .msg.user .bubble { background: #0b7285; color: #fff; border-bottom-right-radius: 3px; }
    .bubble.error { background: #fff0f0; border-color: #ffc9c9; color: #a61e1e; }
    .cursor::after { content: "▋"; opacity: .5; animation: blink 1s steps(2) infinite; }
    @keyframes blink { 50% { opacity: 0; } }

    .composer { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #e3e6ea; background: #fff; flex-shrink: 0; }
    .composer textarea {
      flex: 1; resize: none; border: 1px solid #d0d7de; border-radius: 10px; padding: 9px 11px;
      font-size: 13.5px; max-height: 120px; outline: none; font-family: inherit;
    }
    .composer textarea:focus { border-color: #0b7285; }
    .composer button {
      background: #0b7285; color: #fff; border: none; border-radius: 10px; padding: 0 16px;
      cursor: pointer; font-size: 13.5px; font-weight: 600;
    }
    .composer button:disabled { background: #9bb; cursor: default; }
    .hint { font-size: 11px; color: #8a94a0; padding: 0 12px 10px; background: #fff; }
    .hint a { color: #0b7285; }
  `;

  function splitKeywords(raw) {
    return (raw || "")
      .split(/[\n,]+/)
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
  }

  function urlMatches() {
    const keywords = splitKeywords(settings?.keywords);
    if (!keywords.length) return false;
    const url = location.href.toLowerCase();
    return keywords.some((k) => url.includes(k));
  }

  function scrapeContext() {
    let vulnTitle = "";
    const titleEl = document.querySelector('h2[class*="vuln-title"]');
    if (titleEl) {
      vulnTitle = (titleEl.getAttribute("title") || titleEl.textContent || "").trim();
    }

    const sections = [];
    document.querySelectorAll('div[class*="detail-section"]').forEach((el) => {
      const text = (el.innerText || el.textContent || "").replace(/\s+\n/g, "\n").trim();
      if (text) sections.push(text);
    });
    let vulnDetails = sections.join("\n\n---\n\n");
    // Guard against pathological pages; keep the context bounded.
    if (vulnDetails.length > 24000) vulnDetails = vulnDetails.slice(0, 24000) + "\n…(truncated)";

    return { pageUrl: location.href, vulnTitle, vulnDetails };
  }

  function esc(s) {
    return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }

  function addBubble(role, text, opts = {}) {
    const row = document.createElement("div");
    row.className = `msg ${role}`;
    const bubble = document.createElement("div");
    bubble.className = "bubble" + (opts.error ? " error" : "");
    bubble.textContent = text;
    row.appendChild(bubble);
    ui.messages.appendChild(row);
    ui.messages.scrollTop = ui.messages.scrollHeight;
    return bubble;
  }

  function buildUI() {
    host = document.createElement("div");
    host.id = "sc-agent-root";
    const shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = STYLES;
    shadow.appendChild(style);

    const launcher = document.createElement("button");
    launcher.className = "launcher";
    launcher.title = "Ask SC Agent";
    launcher.textContent = "🛡";
    shadow.appendChild(launcher);

    const panel = document.createElement("div");
    panel.className = "panel";
    panel.innerHTML = `
      <div class="header">
        <div>
          <div class="title">SC Agent</div>
          <div class="sub" data-sub></div>
        </div>
        <div class="spacer"></div>
        <button data-expand title="Expand / collapse">⤢</button>
        <button data-close title="Close">✕</button>
      </div>
      <div class="messages" data-messages></div>
      <div class="hint" data-hint></div>
      <div class="composer">
        <textarea rows="1" placeholder="Ask about this vulnerability…" data-input></textarea>
        <button data-send>Send</button>
      </div>
    `;
    shadow.appendChild(panel);

    ui = {
      launcher,
      panel,
      messages: panel.querySelector("[data-messages]"),
      input: panel.querySelector("[data-input]"),
      send: panel.querySelector("[data-send]"),
      sub: panel.querySelector("[data-sub]"),
      hint: panel.querySelector("[data-hint]"),
      expand: panel.querySelector("[data-expand]"),
      close: panel.querySelector("[data-close]"),
    };

    launcher.addEventListener("click", openPanel);
    ui.close.addEventListener("click", () => panel.classList.remove("open"));
    ui.expand.addEventListener("click", () => panel.classList.toggle("expanded"));
    ui.send.addEventListener("click", send);
    ui.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
    ui.input.addEventListener("input", () => {
      ui.input.style.height = "auto";
      ui.input.style.height = Math.min(ui.input.scrollHeight, 120) + "px";
    });

    (document.body || document.documentElement).appendChild(host);
  }

  function refreshContextLabel() {
    const ctx = scrapeContext();
    if (ctx.vulnTitle) {
      ui.sub.textContent = ctx.vulnTitle;
      ui.hint.textContent = "";
    } else {
      ui.sub.textContent = "No vulnerability detected on this page";
      ui.hint.textContent = "";
    }
  }

  function openPanel() {
    if (!ui.messages.childElementCount) addBubble("assistant", GREETING);
    ui.panel.classList.add("open");
    refreshContextLabel();
    ui.input.focus();
  }

  function send() {
    if (streaming) return;
    const text = ui.input.value.trim();
    if (!text) return;

    ui.input.value = "";
    ui.input.style.height = "auto";
    addBubble("user", text);
    chatHistory.push({ role: "user", content: text });

    const bubble = addBubble("assistant", "");
    bubble.classList.add("cursor");
    streaming = true;
    ui.send.disabled = true;

    const context = scrapeContext();
    let acc = "";
    const port = chrome.runtime.connect({ name: "sc-agent-chat" });

    const finish = () => {
      streaming = false;
      ui.send.disabled = false;
      bubble.classList.remove("cursor");
      try {
        port.disconnect();
      } catch (_) {}
    };

    port.onMessage.addListener((msg) => {
      if (msg.type === "delta") {
        acc += msg.text;
        bubble.textContent = acc;
        ui.messages.scrollTop = ui.messages.scrollHeight;
      } else if (msg.type === "done") {
        if (acc.trim()) chatHistory.push({ role: "assistant", content: acc });
        else bubble.textContent = "(empty response)";
        finish();
      } else if (msg.type === "error") {
        bubble.textContent = msg.error;
        bubble.classList.add("error");
        // Drop the failed user turn so history stays valid for a retry.
        chatHistory.pop();
        finish();
      }
    });
    port.onDisconnect.addListener(() => {
      if (streaming) {
        bubble.textContent = "Connection to the extension was lost. Try again.";
        bubble.classList.add("error");
        chatHistory.pop();
        finish();
      }
    });

    port.postMessage({ type: "chat", messages: chatHistory.slice(), context });
  }

  function applyVisibility() {
    if (!settings) return;
    const shouldShow = urlMatches();
    if (shouldShow && !host) buildUI();
    if (host) {
      ui.launcher.classList.toggle("hidden", !shouldShow);
      if (!shouldShow) ui.panel.classList.remove("open");
    }
  }

  async function loadSettings() {
    settings = await chrome.storage.local.get(["keywords", "consoleUrl"]);
    applyVisibility();
  }

  // React to settings changes (e.g. keyword edits in the options page).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.keywords) settings.keywords = changes.keywords.newValue;
    if (changes.consoleUrl) settings.consoleUrl = changes.consoleUrl.newValue;
    applyVisibility();
  });

  // SPA navigation watcher: Tenable SC changes the URL without full reloads.
  let lastHref = location.href;
  const onNav = () => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      applyVisibility();
      if (ui.panel?.classList.contains("open")) refreshContextLabel();
    }
  };
  for (const m of ["pushState", "replaceState"]) {
    const orig = window.history[m];
    window.history[m] = function (...args) {
      const r = orig.apply(this, args);
      queueMicrotask(onNav);
      return r;
    };
  }
  window.addEventListener("popstate", onNav);
  setInterval(onNav, 1200);

  loadSettings();
})();
