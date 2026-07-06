// SC Agent — background service worker.
// Seeds default settings, opens options, and proxies streaming chat requests
// to the Anthropic Messages API (browser-direct access).

import { DEFAULTS } from "./defaults.js";

async function seedDefaults() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const patch = {};
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (stored[key] === undefined) patch[key] = value;
  }
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
}

chrome.runtime.onInstalled.addListener(seedDefaults);
chrome.runtime.onStartup.addListener(seedDefaults);

// Clicking the toolbar icon opens the settings page.
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

function buildSystemPrompt(settings, context) {
  const parts = [];
  parts.push(settings.agentMd || "");
  if (settings.toolsMd) {
    parts.push("\n\n---\n\n# tools.md (automation the user may reference)\n\n" + settings.toolsMd);
  }
  parts.push("\n\n---\n\n# Environment\n");
  parts.push(`Security Center console: ${settings.consoleUrl || "(not set)"}`);
  if (context?.pageUrl) parts.push(`Current page: ${context.pageUrl}`);
  if (context?.vulnTitle || context?.vulnDetails) {
    parts.push("\n\n# Vulnerability context (scraped from the current page)\n");
    if (context.vulnTitle) parts.push(`Title: ${context.vulnTitle}`);
    if (context.vulnDetails) parts.push(`\nDetails:\n${context.vulnDetails}`);
  } else {
    parts.push("\n\n(No vulnerability was detected on the current page.)");
  }
  return parts.join("\n");
}

async function streamChat(port, payload) {
  const settings = await chrome.storage.local.get(Object.keys(DEFAULTS));

  if (settings.provider !== "anthropic") {
    port.postMessage({ type: "error", error: `Unsupported provider: ${settings.provider}` });
    return;
  }
  if (!settings.anthropicApiKey) {
    port.postMessage({
      type: "error",
      error: "No Anthropic API key configured. Open the SC Agent settings and add one.",
    });
    return;
  }

  const system = buildSystemPrompt(settings, payload.context);
  const body = {
    model: settings.anthropicModel || DEFAULTS.anthropicModel,
    max_tokens: Number(settings.maxTokens) || DEFAULTS.maxTokens,
    stream: true,
    system,
    messages: payload.messages,
  };

  let resp;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": settings.anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    port.postMessage({ type: "error", error: `Network error: ${e.message}` });
    return;
  }

  if (!resp.ok) {
    let detail = `HTTP ${resp.status}`;
    try {
      const err = await resp.json();
      detail = err?.error?.message || detail;
    } catch (_) {
      /* ignore */
    }
    port.postMessage({ type: "error", error: detail });
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let event;
        try {
          event = JSON.parse(data);
        } catch (_) {
          continue;
        }
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
          port.postMessage({ type: "delta", text: event.delta.text });
        } else if (event.type === "message_delta" && event.delta?.stop_reason === "refusal") {
          port.postMessage({ type: "error", error: "The request was declined by safety filters." });
        } else if (event.type === "error") {
          port.postMessage({ type: "error", error: event.error?.message || "Streaming error" });
        }
      }
    }
    port.postMessage({ type: "done" });
  } catch (e) {
    port.postMessage({ type: "error", error: `Stream interrupted: ${e.message}` });
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "sc-agent-chat") return;
  port.onMessage.addListener((msg) => {
    if (msg?.type === "chat") streamChat(port, msg);
  });
});
