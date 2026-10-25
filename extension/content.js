// Content-script watcher (M2/M4/M6). The edge owns the decide-and-act
// loop: sample playback, feed sounded-only deltas into the eligibility
// tracker, and on the single eligible transition run one check-then-act
// Like transaction with an Undo toast. The background only persists the
// reported events. Testable with injected deps; the live wiring at the
// bottom runs solely on open.spotify.com inside the extension.
import { EligibilityTracker } from "./lib/eligibility.js";
import { readPlayback, SoundedTimeSampler, LikeToggle } from "./lib/player-dom.js";
import { UndoToast } from "./lib/toast.js";
import { normalizeSettings } from "./lib/settings.js";

export function makeNonce(trackId, kind, nowMs) {
  return trackId + ":" + kind + ":" + nowMs + ":" + Math.floor(Math.random() * 1e9);
}

export class WatchLoop {
  constructor(opts) {
    this.read = opts.read;
    this.sampler = opts.sampler;
    this.likes = opts.likes;
    this.toast = opts.toast;
    this.tracker = opts.tracker;
    this.report = opts.report;
    this.settings = opts.settings;
    this.nowMs = opts.nowMs || (() => Date.now());
    this.pollMs = opts.pollMs || 1000;
    this.send = opts.send || null;
    this.timer = null;
    this.busy = false;
    this.lastPolledId = null;
    this.lastRetryPollMs = 0;
  }

  static create(opts) {
    const doc = opts.doc;
    const settings = normalizeSettings(opts.settings);
    return new WatchLoop({
      read: (wall) => readPlayback(doc, wall),
      sampler: new SoundedTimeSampler(),
      likes: new LikeToggle(doc, { settleMs: 200 }),
      toast: new UndoToast(doc),
      tracker: new EligibilityTracker(settings),
      report: (event) => opts.sendMessage({ type: "ms-event", event }),
      send: (msg) => opts.sendMessage(msg),
      settings,
      nowMs: opts.nowMs,
      pollMs: opts.pollMs,
    });
  }

  applySettings(next) {
    this.settings = normalizeSettings(next);
    this.tracker = new EligibilityTracker(this.settings);
    if (this.sampler) this.sampler.reset();
  }

  async tick() {
    if (!this.settings.enabled || this.busy) return null;
    const now = this.nowMs();
    let sample = null;
    try {
      sample = this.read(now);
    } catch (e) {
      this.sampler.reset();
      return null;
    }
    const delta = this.sampler.observe(sample);
    if (!sample || !sample.track || !(sample.durationMs > 0)) return null;
    if (sample.track.id !== this.lastPolledId) {
      this.lastPolledId = sample.track.id;
      this.lastRetryPollMs = now;
      await this.pollRetries(sample.track, now);
    } else if (now - this.lastRetryPollMs > 30000) {
      this.lastRetryPollMs = now;
      await this.pollRetries(sample.track, now);
    }
    if (!(delta > 0)) return null;
    let eligible = false;
    try {
      eligible = this.tracker.sound(sample.track.id, sample.durationMs, delta);
    } catch (e) {
      return null;
    }
    if (!eligible) return null;
    this.busy = true;
    try {
      return await this.handleEligible(sample.track, now);
    } finally {
      this.busy = false;
    }
  }

  async handleEligible(track, now) {
    let state = "unknown";
    try {
      state = await this.likes.check();
    } catch (e) {
      return this.fail(track, now, "save", "check-threw");
    }
    if (state === "liked") {
      return this.emit({ kind: "skip", track, now, detail: "already-liked" });
    }
    let out = null;
    try {
      out = await this.likes.save();
    } catch (e) {
      return this.fail(track, now, "save", "save-threw");
    }
    if (!out || !out.ok) {
      return this.fail(track, now, "save", (out && out.reason) || "save-failed");
    }
    if (out.action === "already-saved") {
      return this.emit({ kind: "skip", track, now, detail: "already-saved" });
    }
    const event = this.emit({ kind: "save", track, now, detail: "" });
    try {
      this.toast.show(track, () => {
        this.undo(track);
      });
    } catch (e) {
      // A toast failure never blocks the recorded save.
    }
    return event;
  }

  async undo(track) {
    const now = this.nowMs();
    let current = null;
    try {
      current = this.read(now);
    } catch (e) {
      current = null;
    }
    const currentId = current && current.track ? current.track.id : null;
    if (currentId !== track.id) {
      return this.fail(track, now, "remove", "track-changed");
    }
    let out = null;
    try {
      out = await this.likes.remove();
    } catch (e) {
      return this.fail(track, now, "remove", "remove-threw");
    }
    if (out && out.ok) {
      return this.emit({ kind: "undo", track, now, detail: "" });
    }
    return this.fail(track, now, "remove", (out && out.reason) || "remove-failed");
  }

  emit(opts) {
    const event = {
      nonce: makeNonce(opts.track.id, opts.kind, opts.now),
      ts: opts.now,
      kind: opts.kind,
      trackId: opts.track.id,
      uri: opts.track.uri,
      title: opts.track.title,
      artist: opts.track.artist,
      detail: opts.detail || "",
    };
    try {
      this.report(event);
    } catch (e) {
      // Reporting is best-effort; the local state already converged.
    }
    return event;
  }

  fail(track, now, intent, detail) {
    return this.emit({ kind: "fail", track, now, detail: intent + ":" + detail });
  }

  async pollRetries(track, now) {
    if (!this.send) return;
    let due = [];
    try {
      const res = await this.send({ type: "ms-due", trackId: track.id, nowMs: now });
      due = (res && res.due) || [];
    } catch (e) {
      return;
    }
    for (const intent of due) {
      let out = null;
      try {
        out = intent.kind === "remove" ? await this.likes.remove() : await this.likes.save();
      } catch (e) {
        out = null;
      }
      try {
        await this.send({ type: "ms-ack", id: intent.id, ok: !!(out && out.ok), nowMs: this.nowMs() });
      } catch (e) {
        // The intent stays queued; the next poll retries it.
      }
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick();
    }, this.pollMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try {
      if (this.toast) this.toast.dismiss();
    } catch (e) {
      // Teardown is best-effort.
    }
  }
}

// The shipped manifest matches only Spotify, so the loop boots there. The E2E
// runner patches a temp manifest to add loopback and serves the player fixture
// from it, so that host must boot too.
export function shouldBoot(href) {
  let url;
  try {
    url = new URL(String(href || ""));
  } catch (e) {
    return false;
  }
  if (url.hostname === "open.spotify.com") return true;
  return url.protocol === "http:" && url.hostname === "127.0.0.1";
}

function liveBoot() {
  try {
    if (typeof document === "undefined") return;
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) return;
    if (!shouldBoot((typeof location !== "undefined" && location.href) || "")) return;
    const sendMessage = (msg) =>
      new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage(msg, (res) => resolve(res));
        } catch (e) {
          resolve(null);
        }
      });
    const store = {
      load: async () => {
        try {
          return (await chrome.storage.local.get("settings")).settings;
        } catch (e) {
          return undefined;
        }
      },
    };
    Promise.resolve()
      .then(() => store.load())
      .then((raw) => {
        const loop = WatchLoop.create({ doc: document, sendMessage, settings: raw || {} });
        loop.start();
        try {
          const storageChanged = chrome.storage && chrome.storage.onChanged;
          if (storageChanged && storageChanged.addListener) {
            storageChanged.addListener((changes, area) => {
              if (area === "local" && changes && changes.settings) {
                try {
                  loop.applySettings(changes.settings.newValue);
                } catch (e) {
                  // Settings apply is best-effort at the edge.
                }
              }
            });
          }
        } catch (e) {
          // Live-reload is best-effort.
        }
      });
  } catch (e) {
    // Never break the host page.
  }
}

liveBoot();

