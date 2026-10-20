// Extension shell: boots the pure modules and routes content-script
// messages. The background owns durable facts (settings, activity log,
// retry queue) and never touches the player DOM; DOM writes run at the
// edge, where the track is visible.
import { EligibilityTracker } from "./lib/eligibility.js";
import { RetryQueue } from "./lib/queue.js";
import { ActivityLog } from "./lib/log.js";
import { loadSettings, normalizeSettings } from "./lib/settings.js";

function areaStore(area, key) {
  return {
    load: async () => (await area.get(key))[key],
    save: async (value) => { await area.set({ [key]: value }); },
  };
}

function intentOfFail(detail) {
  return String((detail || "")).startsWith("remove:") ? "remove" : "save";
}

async function onEvent(state, event) {
  if (!event || typeof event.nonce !== "string" || event.nonce === "") {
    return { ok: false };
  }
  if (state.seen.has(event.nonce)) return { ok: true, duplicate: true };
  state.seen.add(event.nonce);
  if (state.seen.size > 1000) {
    state.seen.delete(state.seen.values().next().value);
  }
  try {
    ActivityLog.validate({
      ts: event.ts,
      kind: event.kind,
      trackId: event.trackId,
      detail: event.detail || "",
    });
  } catch (e) {
    return { ok: false };
  }
  await state.log.append({
    ts: event.ts,
    kind: event.kind,
    trackId: event.trackId,
    detail: event.detail || "",
  });
  if (event.kind === "fail") {
    try {
      await state.queue.enqueue({
        id: event.trackId,
        uri: event.uri || "spotify:track:" + event.trackId,
        kind: intentOfFail(event.detail),
      });
    } catch (e) {
      // Logged but not queueable; the options page shows the failure.
    }
  } else {
    try {
      await state.queue.markSucceeded(event.trackId);
    } catch (e) {
      // Queue cleanup is best-effort.
    }
  }
  return { ok: true };
}

export async function route(state, msg) {
  if (!msg || typeof msg.type !== "string") return null;
  if (msg.type === "status") return { ok: true };
  if (msg.type === "progress") {
    return { eligible: state.tracker.sound(msg.trackId, msg.durationMs, msg.deltaMs) };
  }
  if (msg.type === "ms-event") return onEvent(state, msg.event);
  if (msg.type === "ms-due") {
    const items = await state.queue.due(msg.nowMs !== undefined ? msg.nowMs : Date.now());
    return { due: msg.trackId ? items.filter((i) => i.id === msg.trackId) : items };
  }
  if (msg.type === "ms-ack") {
    if (msg.ok) await state.queue.markSucceeded(msg.id);
    else await state.queue.markFailed(msg.id, msg.nowMs !== undefined ? msg.nowMs : Date.now());
    return { ok: true };
  }
  if (msg.type === "ms-retry-now") {
    return { ok: await state.queue.retryNow(msg.id, msg.nowMs !== undefined ? msg.nowMs : Date.now()) };
  }
  if (msg.type === "ms-read") {
    const now = msg.nowMs !== undefined ? msg.nowMs : Date.now();
    const recent = await state.log.recent(msg.limit || 50);
    const pending = await state.queue.due(now);
    return { settings: state.settings, recent, pending };
  }
  return null;
}

export async function boot(env) {
  const storage = env.chrome.storage.local;
  const settings = await loadSettings(areaStore(storage, "settings"));
  const state = {
    settings,
    tracker: new EligibilityTracker(settings),
    queue: new RetryQueue({ store: areaStore(storage, "retry-queue") }),
    log: new ActivityLog({ store: areaStore(storage, "activity-log") }),
    seen: new Set(),
  };
  env.chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    route(state, msg).then(sendResponse, () => sendResponse(null));
    return true;
  });
  try {
    const onChanged = env.chrome.storage && env.chrome.storage.onChanged;
    if (onChanged && onChanged.addListener) {
      onChanged.addListener((changes) => {
        if (changes && changes.settings) {
          state.settings = normalizeSettings(changes.settings.newValue);
          state.tracker = new EligibilityTracker(state.settings);
        }
      });
    }
  } catch (e) {
    // Settings live-reload is best-effort.
  }
  return state;
}

if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) boot({ chrome });

