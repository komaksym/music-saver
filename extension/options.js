// Options page wiring: the settings model owns validation, this file only moves
// values between controls and storage. Visual proof waits for a browser session.
import { loadSettings, saveSettings } from "./lib/settings.js";

const store = {
  load: async () => (await chrome.storage.local.get("settings")).settings,
  save: async (value) => { await chrome.storage.local.set({ settings: value }); },
};

const enabled = document.getElementById("enabled");
const threshold = document.getElementById("threshold");
const floor = document.getElementById("floor");
const status = document.getElementById("status");

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
