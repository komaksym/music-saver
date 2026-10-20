// Extension shell: boots the pure modules and routes content-script messages.
// Saving itself lands in M4; this file stays thin glue with no business logic.
import { EligibilityTracker } from "./lib/eligibility.js";
import { RetryQueue } from "./lib/queue.js";
import { loadSettings } from "./lib/settings.js";

function areaStore(area, key) {
  return {
    load: async () => (await area.get(key))[key],
    save: async (value) => { await area.set({ [key]: value }); },
  };
}

export async function boot(env) {
  const storage = env.chrome.storage.local;
  const settings = await loadSettings(areaStore(storage, "settings"));
  const tracker = new EligibilityTracker(settings);
  const queue = new RetryQueue({ store: areaStore(storage, "retry-queue") });
  env.chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "progress") {
      sendResponse({ eligible: tracker.sound(msg.trackId, msg.durationMs, msg.deltaMs) });
      return;
    }
    if (msg?.type === "status") sendResponse({ ok: true });
  });
  return { settings, tracker, queue };
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) boot({ chrome });
