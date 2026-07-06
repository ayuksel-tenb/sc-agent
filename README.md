# 🛡 SC Agent — Tenable Security Center Assistant

A Chrome (MV3) extension that drops a floating **AI vulnerability-analyst** chat
into Tenable Security Center. When you open a page whose URL matches a keyword you
configure (e.g. `vulndetails`), a shield icon appears in the bottom-right corner.
Click it, ask a question, and the agent answers using the vulnerability data
scraped from the page — powered by the **Anthropic API**.

<p align="center"><img src="icons/icon128.png" width="96" alt="SC Agent icon"></p>

## Features

- **Contextual chat widget** — a small modal that expands to a large panel.
  Opens with *“How can I help?”*
- **Page-aware** — reads the vulnerability title (from the `title` attribute of
  the `h2.vuln-title` element) and the details (from every `div.detail-section`),
  and passes them to the agent as context.
- **Keyword-gated visibility** — the launcher only shows on pages whose URL
  contains one of your configured keywords. SPA navigations inside Security
  Center are detected automatically.
- **Editable agent definition** — an `agent.md` you edit in the settings page
  (default persona: *Vulnerability Analyst*).
- **Editable tools** — a `tools.md` where you define automation instructions
  (`triage`, `remediation`, `ticket`, or your own) that the agent follows when
  you ask for them.
- **Streaming responses** and a one-click **Test API key** button.
- **Style-isolated** — the widget runs inside a Shadow DOM so it never clashes
  with Security Center's own React styles.

## Install (load unpacked)

The extension isn't on the Chrome Web Store yet, so install it from source:

1. **Download the code**
   ```bash
   git clone git@github.com:ayuksel-tenb/sc-agent.git
   # or download the ZIP from the GitHub "Code" button and unzip it
   ```
2. Open **`chrome://extensions`** in Chrome (or any Chromium browser — Edge,
   Brave, etc.).
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked** and select the `sc-agent/` folder (the one containing
   `manifest.json`).
5. The 🛡 SC Agent icon appears in your toolbar.

To update later, `git pull` and click the **↻ reload** button on the extension
card in `chrome://extensions`.

## Configure

Click the toolbar icon (or **Details → Extension options**) to open the settings
page:

| Setting | What it does |
| --- | --- |
| **Provider** | Anthropic API (the active provider). |
| **API key** | Your Anthropic API key (`sk-ant-…`). Stored locally in the browser. |
| **Model** | Defaults to `claude-opus-4-8`. |
| **Max tokens** | Response length cap. |
| **Console URL** | Your Security Center console. Default `https://localhost:8443/`. Passed to the agent as context. |
| **Keywords** | Show the agent only on URLs containing these (default `vulndetails`). |
| **agent.md** | The agent's persona and rules. |
| **tools.md** | Automation instructions the agent follows on request. |

The default provider is the **Anthropic API** — add your key and you're ready.

## How it works

```
Security Center page ──scrape──▶ content script (Shadow DOM widget)
                                       │  title + detail-section text
                                       ▼
                         background service worker
                                       │  system = agent.md + tools.md + context
                                       ▼
                          Anthropic Messages API (streaming)
```

The extension never executes anything on Security Center itself — it only reads
the visible vulnerability data and passes your prompt (plus that context) to the
Anthropic API. `tools.md` entries are instructions **for the model**, not scripts
the extension runs.

### Privacy

- Your API key and settings live in `chrome.storage.local` on your machine.
- Vulnerability text from the page is sent to the Anthropic API only when you
  send a message.
- API calls go directly from your browser to `api.anthropic.com`.

## Roadmap / TODO

- [ ] **OpenCode / local-agent support** — talk to a local OpenCode agent instead
      of the Anthropic API. *Planned if the project gets enough ⭐ stars — star the
      repo if you want it!*
- [ ] Per-keyword agent profiles.
- [ ] Copy-to-clipboard and markdown rendering in replies.
- [ ] Chrome Web Store listing.

## License

BSD 3-Clause — see [LICENSE](LICENSE). Developed by Ali Okan Yüksel.
