// Spotify web-player DOM boundary (M2/M4). Sole module that reads the
// open.spotify.com player or clicks its Like controls. Everything else
// works with TrackIdentity, PlaybackSample, and LikeState values.

export const SELECTORS = Object.freeze({
  widget: '[data-testid="now-playing-widget"]',
  title: '[data-testid="context-item-info-title"]',
  link: '[data-testid="context-item-link"]',
  artist: '[data-testid="context-item-info-artist"]',
  trackAnchor: 'a[data-testid="context-link"][data-context-item-type="track"]',
  playPause: '[data-testid="control-button-playpause"]',
  progressBar: '[data-testid="playback-progressbar"]',
  positionText: '[data-testid="playback-position"]',
  durationText: '[data-testid="playback-duration"]',
  nowPlayingView: 'aside[aria-label="Now playing view"]',
  adBar: '[data-testadtype]',
  adWidget: '[data-testid="now-playing-widget-v2"]',
  menu: '[data-testid="context-menu"]',
  likedRow: '[aria-labelledby="listrow-title-spotify:collection:tracks"]',
});

function textOf(root, selector) {
  let node = null;
  try {
    node = root.querySelector(selector);
  } catch (e) {
    return "";
  }
  return (node && node.textContent ? node.textContent : "").trim();
}

function attrOf(node, name) {
  try {
    return node && node.getAttribute ? (node.getAttribute(name) || null) : null;
  } catch (e) {
    return null;
  }
}

export function parseTimeToMs(value) {
  const parts = String(value || "").trim().split(":");
  if (parts.length < 1 || parts.length > 3) return NaN;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return NaN;
  let total = 0;
  for (const n of nums) total = total * 60 + n;
  return Math.round(total * 1000);
}

const TRACK_ID_PATTERNS = [
  /spotify:track:([A-Za-z0-9]+)/,
  /spotify%3Atrack%3A([A-Za-z0-9]+)/i,
];

export function extractTrackId(candidate) {
  if (!candidate) return null;
  for (const pattern of TRACK_ID_PATTERNS) {
    const match = String(candidate).match(pattern);
    if (match) return match[1];
  }
  return null;
}

function matchesTitle(anchor, title) {
  const label = rowLabel(anchor).toLowerCase();
  const expected = String(title || "").trim().toLowerCase();
  if (!label) return true;
  return !!expected && (label.includes(expected) || expected.includes(label));
}

function anchorTrackId(anchor) {
  for (const name of ["href", "data-uri", "data-context-uri"]) {
    const id = extractTrackId(attrOf(anchor, name));
    if (id) return id;
  }
  return null;
}

function findTrackAnchor(doc, widget, title) {
  const selectors = [
    SELECTORS.trackAnchor,
    'a[href*="spotify:track:"]',
    'a[href*="spotify%3Atrack%3A"]',
  ];
  let view = null;
  try {
    view = doc.querySelector(SELECTORS.nowPlayingView);
  } catch (e) {
    view = null;
  }
  const roots = [widget, view, doc].filter(Boolean);
  for (const root of roots) {
    for (const selector of selectors) {
      let nodes = [];
      try {
        nodes = root.querySelectorAll
          ? root.querySelectorAll(selector)
          : [root.querySelector(selector)];
      } catch (e) {
        continue;
      }
      for (const node of nodes) {
        if (anchorTrackId(node) && (root === widget || matchesTitle(node, title))) return node;
      }
    }
  }
  return null;
}

export function readTrack(doc) {
  if (readAdType(doc)) return null;
  let widget = null;
  try {
    widget = doc.querySelector(SELECTORS.widget);
  } catch (e) {
    return null;
  }
  if (!widget) return null;
  const title = textOf(widget, SELECTORS.title) || textOf(doc, SELECTORS.title);
  const artist = textOf(widget, SELECTORS.artist) || textOf(doc, SELECTORS.artist);
  if (!title || !artist) return null;
  const anchor = findTrackAnchor(doc, widget, title);
  const trackId = anchorTrackId(anchor);
  if (!trackId) return null;
  return { id: trackId, uri: "spotify:track:" + trackId, title, artist };
}

function findRangeInput(doc) {
  try {
    const direct = doc.querySelector(SELECTORS.progressBar + ' input[type="range"]');
    if (direct) return direct;
  } catch (e) {
    // Fall through to the structural lookup below.
  }
  let bar = null;
  try {
    bar = doc.querySelector(SELECTORS.progressBar);
  } catch (e) {
    bar = null;
  }
  try {
    return (bar && bar.querySelector && bar.querySelector("input")) || null;
  } catch (e) {
    return null;
  }
}

function rangeMs(range) {
  const positionMs = Number(range && range.value);
  const durationMs = Number(range && range.max);
  if (Number.isFinite(positionMs) && Number.isFinite(durationMs) && durationMs > 0) {
    return { positionMs: Math.max(0, positionMs), durationMs };
  }
  return null;
}

function readTimes(doc) {
  const fromRange = rangeMs(findRangeInput(doc));
  if (fromRange) return fromRange;
  const positionMs = parseTimeToMs(textOf(doc, SELECTORS.positionText));
  const durationMs = parseTimeToMs(textOf(doc, SELECTORS.durationText));
  if (!Number.isFinite(positionMs) || !Number.isFinite(durationMs) || durationMs <= 0) return null;
  return { positionMs, durationMs };
}

function hasPlayer(doc) {
  for (const selector of [SELECTORS.widget, SELECTORS.playPause]) {
    try {
      if (doc.querySelector(selector)) return true;
    } catch (e) {
      continue;
    }
  }
  return false;
}

function findLikeControl(doc) {
  try {
    return doc.querySelector(SELECTORS.widget + " button[aria-checked]")
      || doc.querySelector("button[aria-checked]");
  } catch (e) {
    return null;
  }
}

function findPlayButton(doc) {
  try {
    return doc.querySelector(SELECTORS.playPause);
  } catch (e) {
    return null;
  }
}

function hasVisibleAd(doc) {
  for (const selector of ['[data-testid="ad-slot"]', '[data-testid="advertisement"]']) {
    let ad = null;
    try {
      ad = doc.querySelector(selector);
    } catch (e) {
      continue;
    }
    try {
      if (ad && ad.getClientRects().length > 0) return true;
    } catch (e) {
      continue;
    }
  }
  return false;
}

// The now-playing bar carries data-testadtype="ad-type-none" for a track and
// "ad-type-ad" while an ad plays. The ad bar swap also renders the v2 widget.
// Use either signal so a stale track anchor can never resurrect an ad segment.
export function readAdType(doc) {
  try {
    if (doc.querySelector(SELECTORS.adWidget)) return "ad";
  } catch (e) {
    return null;
  }
  let bar = null;
  try {
    bar = doc.querySelector(SELECTORS.adBar);
  } catch (e) {
    bar = null;
  }
  if (bar) {
    const value = attrOf(bar, "data-testadtype");
    if (value) return value === "ad-type-none" ? null : value;
  }
  return null;
}

export function readPlayback(doc, wallMs) {
  if (hasVisibleAd(doc)) return null;
  const playBtn = findPlayButton(doc);
  const playing = attrOf(playBtn, "aria-label") === "Pause";
  if (readAdType(doc)) {
    return { kind: "ad", track: null, playing, wallMs, positionMs: 0, durationMs: 0 };
  }
  const track = readTrack(doc);
  const times = readTimes(doc);
  if (track && times && findLikeControl(doc)) {
    return { kind: "track", track, playing, wallMs, positionMs: times.positionMs, durationMs: times.durationMs };
  }
  if (!hasPlayer(doc)) return null;
  return { kind: "ad", track: null, playing, wallMs, positionMs: 0, durationMs: 0 };
}

// Identity-only read behind the Like guard. It follows readPlayback's ad and
// track path, so a stale anchor during an ad swap cannot authorize a click.
export function readCurrentTrackId(doc) {
  try {
    if (hasVisibleAd(doc)) return null;
    const track = readTrack(doc);
    return track ? track.id : null;
  } catch (e) {
    return null;
  }
}

export function readLikeHint(doc) {
  const btn = findLikeControl(doc);
  if (!btn) return "unknown";
  return attrOf(btn, "aria-checked") === "false" ? "unliked" : "unknown";
}

export class SoundedTimeSampler {
  constructor() {
    this.prev = null;
    // Playing-side wall clock and credited total implement the sounded-time
    // budget: progress credits against accumulated playing time, not against
    // a single tick gap. Spotify refreshes the progress bar in multi-second
    // steps in background tabs, so per-tick clipping structurally undercounts.
    this.playingWallMs = 0;
    this.creditedMs = 0;
  }

  reset() {
    this.prev = null;
    this.playingWallMs = 0;
    this.creditedMs = 0;
  }

  observe(sample) {
    if (!sample || sample.kind !== "track" || !sample.track || !sample.track.id || !(sample.durationMs > 0)) {
      this.reset();
      return 0;
    }
    const prev = this.prev;
    this.prev = sample;
    if (!prev || !prev.track || prev.track.id !== sample.track.id) {
      this.playingWallMs = 0;
      this.creditedMs = 0;
      return 0;
    }
    if (!prev.playing || !sample.playing) return 0;
    const wall = sample.wallMs - prev.wallMs;
    if (!(wall > 0)) return 0;
    this.playingWallMs += wall;
    const progress = sample.positionMs - prev.positionMs;
    if (!(progress > 0)) return 0;
    const budget = Math.max(0, this.playingWallMs - this.creditedMs);
    const seek = progress > budget + wall;
    const delta = seek ? wall : Math.min(progress, budget);
    if (!(delta > 0)) return 0;
    this.creditedMs += delta;
    return delta;
  }
}

function findMenu(root) {
  try {
    return root.querySelector(SELECTORS.menu);
  } catch (e) {
    return null;
  }
}

function rowLabel(node) {
  try {
    return node && node.textContent ? node.textContent.trim() : "";
  } catch (e) {
    return "";
  }
}

function findLikedCheckbox(menu) {
  if (!menu) return null;
  let labeled = null;
  try {
    labeled = menu.querySelector(SELECTORS.likedRow);
  } catch (e) {
    labeled = null;
  }
  const fromClosest = labeled && labeled.closest
    ? labeled.closest('button[role="menuitemcheckbox"]')
    : null;
  if (fromClosest) return fromClosest;
  // Label-gated fallback: the labeled row is locale-proof, but when it is
  // missing only a row that names Liked Songs may be touched. Never fall
  // back to the first checkbox, which can belong to another playlist.
  let boxes = [];
  try {
    const list = menu.querySelectorAll('button[role="menuitemcheckbox"]');
    boxes = list ? Array.from(list) : [];
  } catch (e) {
    boxes = [];
  }
  return boxes.find((b) => rowLabel(b).toLowerCase().includes("liked songs")) || null;
}

function findDone(menu) {
  try {
    return menu.querySelector('button[type="submit"]');
  } catch (e) {
    return null;
  }
}

function clickCancel(menu) {
  let buttons = [];
  try {
    const list = menu.querySelectorAll("button");
    buttons = list ? Array.from(list) : [];
  } catch (e) {
    return;
  }
  const cancel = buttons.find((b) => (b.textContent || "").trim() === "Cancel");
  try {
    if (cancel && cancel.click) cancel.click();
  } catch (e) {
    // Menu cleanup is best-effort; the next read re-syncs state.
  }
}

export class LikeToggle {
  constructor(root, opts) {
    this.root = root;
    this.settleMs = (opts && opts.settleMs) || 150;
    this.contentTimeoutMs = (opts && opts.contentTimeoutMs) || 2500;
    this.contentPollMs = (opts && opts.contentPollMs) || 100;
    this.currentTrackId = (opts && typeof opts.currentTrackId === "function")
      ? opts.currentTrackId
      : () => readCurrentTrackId(root);
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  mainButton() {
    try {
      return this.root.querySelector(SELECTORS.widget + " button[aria-checked]")
        || this.root.querySelector("button[aria-checked]");
    } catch (e) {
      return null;
    }
  }

  // Fail-closed identity check. A missing reader, a null track, or a thrown
  // read all report a track change, so no mutation can follow.
  trackNow() {
    try {
      return this.currentTrackId();
    } catch (e) {
      return null;
    }
  }

  stillOn(trackId) {
    return !!trackId && this.trackNow() === trackId;
  }

  async openMenu(trackId) {
    const btn = this.mainButton();
    if (!btn || !this.stillOn(trackId)) return null;
    try {
      btn.click();
    } catch (e) {
      return null;
    }
    await this.sleep(this.settleMs);
    const menu = findMenu(this.root);
    if (!this.stillOn(trackId)) {
      clickCancel(menu);
      return null;
    }
    return menu;
  }

  // Spotify fetches the playlist rows after the menu shell opens, so the
  // Liked Songs row is awaited with a bounded poll instead of assumed
  // present after one settle sleep.
  async waitForLiked(menu) {
    const started = Date.now();
    for (;;) {
      const box = findLikedCheckbox(menu);
      if (box) return box;
      if (Date.now() - started >= this.contentTimeoutMs) return null;
      await this.sleep(this.contentPollMs);
    }
  }

  async check(trackId) {
    const target = trackId || this.trackNow();
    if (!this.stillOn(target)) return "track-changed";
    if (readLikeHint(this.root) === "unliked") {
      return this.stillOn(target) ? "unliked" : "track-changed";
    }
    const menu = await this.openMenu(target);
    if (!menu) return this.stillOn(target) ? "unknown" : "track-changed";
    const box = await this.waitForLiked(menu);
    if (!this.stillOn(target)) {
      clickCancel(menu);
      return "track-changed";
    }
    const state = !box
      ? "unknown"
      : attrOf(box, "aria-checked") === "true"
        ? "liked"
        : "unliked";
    clickCancel(menu);
    return state;
  }

  async save(trackId, opts) {
    const target = trackId || this.trackNow();
    const state = opts && typeof opts.state === "string"
      ? opts.state
      : await this.check(target);
    if (state === "track-changed" || !this.stillOn(target)) {
      return { ok: false, reason: "track-changed" };
    }
    if (state === "liked") return { ok: true, action: "already-saved" };
    const btn = this.mainButton();
    if (!btn) return { ok: false, reason: "dom-changed" };
    if (attrOf(btn, "aria-checked") === "false") {
      if (!this.stillOn(target)) return { ok: false, reason: "track-changed" };
      try {
        btn.click();
      } catch (e) {
        return { ok: false, reason: "dom-changed" };
      }
      await this.sleep(this.settleMs);
      if (!this.stillOn(target)) return { ok: false, reason: "track-changed" };
      const flipped = this.mainButton();
      return attrOf(flipped, "aria-checked") === "true"
        ? { ok: true, action: "saved" }
        : { ok: false, reason: "confirm-mismatch" };
    }
    const menu = await this.openMenu(target);
    if (!menu) {
      return this.stillOn(target)
        ? { ok: false, reason: "menu-timeout" }
        : { ok: false, reason: "track-changed" };
    }
    const box = await this.waitForLiked(menu);
    if (!this.stillOn(target)) {
      clickCancel(menu);
      return { ok: false, reason: "track-changed" };
    }
    if (!box) {
      clickCancel(menu);
      return { ok: false, reason: "menu-timeout" };
    }
    if (attrOf(box, "aria-checked") === "true") {
      clickCancel(menu);
      return { ok: true, action: "already-saved" };
    }
    if (!this.stillOn(target)) {
      clickCancel(menu);
      return { ok: false, reason: "track-changed" };
    }
    try {
      box.click();
    } catch (e) {
      clickCancel(menu);
      return { ok: false, reason: "dom-changed" };
    }
    await this.sleep(this.settleMs);
    if (!this.stillOn(target)) {
      clickCancel(menu);
      return { ok: false, reason: "track-changed" };
    }
    const done = findDone(menu);
    if (!done || !done.click) {
      clickCancel(menu);
      return { ok: false, reason: "dom-changed" };
    }
    if (!this.stillOn(target)) {
      clickCancel(menu);
      return { ok: false, reason: "track-changed" };
    }
    try {
      done.click();
    } catch (e) {
      return { ok: false, reason: "dom-changed" };
    }
    await this.sleep(this.settleMs);
    if (!this.stillOn(target)) return { ok: false, reason: "track-changed" };
    return { ok: true, action: "saved" };
  }

  async remove(trackId) {
    const target = trackId || this.trackNow();
    if (!this.stillOn(target)) return { ok: false, reason: "track-changed" };
    const btn = this.mainButton();
    if (!btn) return { ok: false, reason: "dom-changed" };
    if (attrOf(btn, "aria-checked") === "false") return { ok: true, action: "removed" };
    const menu = await this.openMenu(target);
    if (!menu) {
      if (!this.stillOn(target)) return { ok: false, reason: "track-changed" };
      try {
        btn.click();
      } catch (e) {
        return { ok: false, reason: "dom-changed" };
      }
      await this.sleep(this.settleMs);
      if (!this.stillOn(target)) return { ok: false, reason: "track-changed" };
      return attrOf(this.mainButton(), "aria-checked") === "false"
        ? { ok: true, action: "removed" }
        : { ok: false, reason: "confirm-mismatch" };
    }
    const box = await this.waitForLiked(menu);
    if (!this.stillOn(target)) {
      clickCancel(menu);
      return { ok: false, reason: "track-changed" };
    }
    if (!box) {
      clickCancel(menu);
      return { ok: false, reason: "menu-timeout" };
    }
    if (attrOf(box, "aria-checked") === "false") {
      clickCancel(menu);
      return { ok: true, action: "removed" };
    }
    if (!this.stillOn(target)) {
      clickCancel(menu);
      return { ok: false, reason: "track-changed" };
    }
    try {
      box.click();
    } catch (e) {
      clickCancel(menu);
      return { ok: false, reason: "dom-changed" };
    }
    await this.sleep(this.settleMs);
    if (!this.stillOn(target)) {
      clickCancel(menu);
      return { ok: false, reason: "track-changed" };
    }
    const done = findDone(menu);
    if (!done || !done.click) {
      clickCancel(menu);
      return { ok: false, reason: "dom-changed" };
    }
    if (!this.stillOn(target)) {
      clickCancel(menu);
      return { ok: false, reason: "track-changed" };
    }
    try {
      done.click();
    } catch (e) {
      return { ok: false, reason: "dom-changed" };
    }
    await this.sleep(this.settleMs);
    if (!this.stillOn(target)) return { ok: false, reason: "track-changed" };
    return { ok: true, action: "removed" };
  }
}
