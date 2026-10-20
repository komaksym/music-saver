// Options page wiring: the settings model owns validation, this file only
// moves values between controls and storage, and renders the activity log
// plus the retry queue with manual retry. Outside the installed extension
// (no chrome.storage) it shows a notice and stays inert.
import { loadSettings, saveSettings } from "./lib/settings.js";

const status = document.getElementById("status");

if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
  status.textContent = "Open this page from the installed music-saver extension.";
} else {
  await runOptions();
}

async function runOptions() {
  const store = {
    load: async () => (await chrome.storage.local.get("settings")).settings,
    save: async (value) => { await chrome.storage.local.set({ settings: value }); },
  };

  const enabled = document.getElementById("enabled");
  const threshold = document.getElementById("threshold");
  const floor = document.getElementById("floor");
  const activityLog = document.getElementById("activity-log");
  const retryQueue = document.getElementById("retry-queue");

  const settings = await loadSettings(store);
  enabled.checked = settings.enabled;
  threshold.value = Math.round(settings.thresholdRatio * 100);
  floor.value = Math.round(settings.minSoundedMs / 1000);

  async function persist() {
    await saveSettings(store, {
      enabled: enabled.checked,
      thresholdRatio: Number(threshold.value) / 100,
      minSoundedMs: Number(floor.value) * 1000,
    });
    status.textContent = "Saved.";
  }

  enabled.addEventListener("change", persist);
  threshold.addEventListener("change", persist);
  floor.addEventListener("change", persist);

  async function readState() {
    try {
      if (chrome.runtime && chrome.runtime.sendMessage) {
        const res = await chrome.runtime.sendMessage({ type: "ms-read", limit: 50, nowMs: Date.now() });
        if (res) return res;
      }
    } catch (e) {
      // Fall through to direct storage reads below.
    }
    const raw = await chrome.storage.local.get(["activity-log", "retry-queue"]);
    return {
      recent: [...(raw["activity-log"] || [])].reverse().slice(0, 50),
      pending: raw["retry-queue"] || [],
    };
  }

  async function render() {
    const state = await readState();
    activityLog.replaceChildren();
    if (!state.recent.length) {
      const li = document.createElement("li");
      li.textContent = "Nothing saved yet.";
      activityLog.appendChild(li);
    }
    for (const entry of state.recent) {
      const li = document.createElement("li");
      const kind = document.createElement("span");
      kind.className = "kind";
      kind.textContent = entry.kind;
      li.appendChild(kind);
      li.appendChild(document.createTextNode(" " + entry.trackId + ", " + new Date(entry.ts).toLocaleString()));
      activityLog.appendChild(li);
    }
    retryQueue.replaceChildren();
    if (!state.pending.length) {
      const li = document.createElement("li");
      li.textContent = "Queue empty.";
      retryQueue.appendChild(li);
      return;
    }
    for (const item of state.pending) {
      const li = document.createElement("li");
      li.appendChild(document.createTextNode(item.kind + " " + item.id + " "));
      const btn = document.createElement("button");
      btn.textContent = "Retry now";
      btn.dataset.id = item.id;
      btn.addEventListener("click", async () => {
        try {
          await chrome.runtime.sendMessage({ type: "ms-retry-now", id: item.id, nowMs: Date.now() });
        } catch (e) {
          // Best-effort; the render below shows current state either way.
        }
        await render();
      });
      li.appendChild(btn);
      retryQueue.appendChild(li);
    }
  }

  await render();
}

