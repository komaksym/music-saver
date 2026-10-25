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

export function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
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

function findTrackAnchor(doc, widget) {
  const selectors = [
    SELECTORS.trackAnchor,
    'a[href*="spotify:track:"]',
    'a[href*="spotify%3Atrack%3A"]',
  ];
  const roots = widget ? [widget, doc] : [doc];
  for (const root of roots) {
    for (const selector of selectors) {
      let node = null;
      try {
        node = root.querySelector(selector);
      } catch (e) {
        continue;
      }
      if (node) return node;
    }
  }
  return null;
}

export function readTrack(doc) {
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
  let linkHref = "";
  try {
    const a = widget.querySelector(SELECTORS.link);
    const b = doc.querySelector(SELECTORS.link);
    linkHref = attrOf(a, "href") || attrOf(b, "href") || "";
  } catch (e) {
    linkHref = "";
  }
  const anchor = findTrackAnchor(doc, widget);
  const anchorUris = anchor
    ? [attrOf(anchor, "href"), attrOf(anchor, "data-uri"), attrOf(anchor, "data-context-uri")]
    : [];
  let trackId = null;
  for (const candidate of anchorUris) {
    trackId = extractTrackId(candidate);
    if (trackId) break;
  }
  if (!trackId) {
    const slug = slugify(linkHref + "::" + title + "::" + artist);
    if (!slug) return null;
    trackId = "slug-" + slug;
  }
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

export function readPlayback(doc, wallMs) {
  for (const selector of ['[data-testid="ad-slot"]', '[data-testid="advertisement"]']) {
    const ad = doc.querySelector(selector);
    if (ad && ad.getClientRects().length > 0) return null;
  }
  let playBtn = null;
  try {
    playBtn = doc.querySelector(SELECTORS.playPause);
  } catch (e) {
    playBtn = null;
  }
  const playing = attrOf(playBtn, "aria-label") === "Pause";
  const track = readTrack(doc);
  const fromRange = rangeMs(findRangeInput(doc));
  if (fromRange) {
    return { track, playing, wallMs, positionMs: fromRange.positionMs, durationMs: fromRange.durationMs };
  }
  const positionMs = parseTimeToMs(textOf(doc, SELECTORS.positionText));
  const durationMs = parseTimeToMs(textOf(doc, SELECTORS.durationText));
  if (!Number.isFinite(positionMs) || !Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }
  return { track, positionMs, durationMs, playing, wallMs };
}

export function readLikeHint(doc) {
  let btn = null;
  try {
    btn = doc.querySelector(SELECTORS.widget + " button[aria-checked]")
      || doc.querySelector("button[aria-checked]");
  } catch (e) {
    return "unknown";
  }
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
    if (!sample || !sample.track) {
      this.prev = null;
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

  async openMenu() {
    const btn = this.mainButton();
    if (!btn) return null;
    try {
      btn.click();
    } catch (e) {
      return null;
    }
    await this.sleep(this.settleMs);
    return findMenu(this.root);
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

  async check() {
    if (readLikeHint(this.root) === "unliked") return "unliked";
    const menu = await this.openMenu();
    if (!menu) return "unknown";
    const box = await this.waitForLiked(menu);
    const state = !box
      ? "unknown"
      : attrOf(box, "aria-checked") === "true"
        ? "liked"
        : "unliked";
    clickCancel(menu);
    return state;
  }

  async save() {
    const state = await this.check();
    if (state === "liked") return { ok: true, action: "already-saved" };
    const btn = this.mainButton();
    if (!btn) return { ok: false, reason: "dom-changed" };
    if (attrOf(btn, "aria-checked") === "false") {
      try {
        btn.click();
      } catch (e) {
        return { ok: false, reason: "dom-changed" };
      }
      await this.sleep(this.settleMs);
      const flipped = this.mainButton();
      return attrOf(flipped, "aria-checked") === "true"
        ? { ok: true, action: "saved" }
        : { ok: false, reason: "confirm-mismatch" };
    }
    const menu = await this.openMenu();
    if (!menu) return { ok: false, reason: "menu-timeout" };
    const box = await this.waitForLiked(menu);
    if (!box) {
      clickCancel(menu);
      return { ok: false, reason: "menu-timeout" };
    }
    if (attrOf(box, "aria-checked") === "true") {
      clickCancel(menu);
      return { ok: true, action: "already-saved" };
    }
    try {
      box.click();
    } catch (e) {
      clickCancel(menu);
      return { ok: false, reason: "dom-changed" };
    }
    await this.sleep(this.settleMs);
    const done = findDone(menu);
    if (!done || !done.click) {
      clickCancel(menu);
      return { ok: false, reason: "dom-changed" };
    }
    try {
      done.click();
    } catch (e) {
      return { ok: false, reason: "dom-changed" };
    }
    await this.sleep(this.settleMs);
    return { ok: true, action: "saved" };
  }

  async remove() {
    const btn = this.mainButton();
    if (!btn) return { ok: false, reason: "dom-changed" };
    if (attrOf(btn, "aria-checked") === "false") return { ok: true, action: "removed" };
    const menu = await this.openMenu();
    if (!menu) {
      try {
        btn.click();
      } catch (e) {
        return { ok: false, reason: "dom-changed" };
      }
      await this.sleep(this.settleMs);
      return attrOf(this.mainButton(), "aria-checked") === "false"
        ? { ok: true, action: "removed" }
        : { ok: false, reason: "confirm-mismatch" };
    }
    const box = await this.waitForLiked(menu);
    if (!box) {
      clickCancel(menu);
      return { ok: false, reason: "menu-timeout" };
    }
    if (attrOf(box, "aria-checked") === "false") {
      clickCancel(menu);
      return { ok: true, action: "removed" };
    }
    try {
      box.click();
    } catch (e) {
      clickCancel(menu);
      return { ok: false, reason: "dom-changed" };
    }
    await this.sleep(this.settleMs);
    const done = findDone(menu);
    if (!done || !done.click) {
      clickCancel(menu);
      return { ok: false, reason: "dom-changed" };
    }
    try {
      done.click();
    } catch (e) {
      return { ok: false, reason: "dom-changed" };
    }
    await this.sleep(this.settleMs);
    return { ok: true, action: "removed" };
  }
}

