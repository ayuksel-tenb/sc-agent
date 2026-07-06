// SC Agent — options page logic.
import { DEFAULTS } from "./defaults.js";

const FIELDS = [
  "provider",
  "consoleUrl",
  "keywords",
  "anthropicApiKey",
  "anthropicModel",
  "maxTokens",
  "agentMd",
  "toolsMd",
];

const $ = (id) => document.getElementById(id);

function setStatus(el, text, ok = true) {
  el.textContent = text;
  el.style.color = ok ? "#2b8a3e" : "#c92a2a";
  if (text) setTimeout(() => (el.textContent = ""), 4000);
}

async function load() {
  const stored = await chrome.storage.local.get(FIELDS);
  for (const key of FIELDS) {
    const el = $(key);
    if (!el) continue;
    el.value = stored[key] !== undefined ? stored[key] : DEFAULTS[key];
  }
}

async function save() {
  const patch = {};
  for (const key of FIELDS) {
    const el = $(key);
    if (!el) continue;
    patch[key] = key === "maxTokens" ? Number(el.value) || DEFAULTS.maxTokens : el.value;
  }
  await chrome.storage.local.set(patch);
  setStatus($("status"), "Saved.");
}

async function testKey() {
  const status = $("test-status");
  const key = $("anthropicApiKey").value.trim();
  const model = $("anthropicModel").value.trim() || DEFAULTS.anthropicModel;
  if (!key) {
    setStatus(status, "Enter an API key first.", false);
    return;
  }
  status.textContent = "Testing…";
  status.style.color = "#6b7683";
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: 8,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    if (resp.ok) {
      setStatus(status, "✓ API key works.");
    } else {
      const err = await resp.json().catch(() => ({}));
      setStatus(status, `✗ ${err?.error?.message || "HTTP " + resp.status}`, false);
    }
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, false);
  }
}

document.addEventListener("click", (e) => {
  const reset = e.target.closest("[data-reset]");
  if (reset) {
    const key = reset.dataset.reset;
    $(key).value = DEFAULTS[key];
    setStatus($("status"), "Reset — remember to save.");
  }
});

$("save").addEventListener("click", save);
$("test").addEventListener("click", testKey);

load();
