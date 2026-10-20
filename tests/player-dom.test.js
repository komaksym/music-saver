import test from "node:test";
import assert from "node:assert/strict";
import {
  readTrack,
  readPlayback,
  readLikeHint,
  extractTrackId,
  parseTimeToMs,
  slugify,
  SoundedTimeSampler,
  LikeToggle,
} from "../extension/lib/player-dom.js";

function node(attrs, text) {
  return {
    attrs: { ...(attrs || {}) },
    textContent: text || "",
    getAttribute(name) {
      return this.attrs[name] ?? null;
    },
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
  };
}

function button(checked, onClick) {
  const b = node({ "aria-checked": checked });
  b.click = () => {
    if (onClick) onClick();
  };
  return b;
}

// Fake Spotify player DOM. Menu appears only while open; the Liked-Songs
// checkbox flips on click like the real curation sheet.
function fakePlayer(opts) {
  const o = opts || {};
  const state = {
    title: o.title === undefined ? "Immune to Danger" : o.title,
    artist: o.artist === undefined ? "Hippie Sabotage" : o.artist,
    albumHref: o.albumHref === undefined ? "/album/21RRVeBCnPbNpD1OzvqIa7" : o.albumHref,
    anchorHref: o.anchorHref === undefined ? "https://open.spotify.com/track/7LoBfKLpz4BGrxCuOzAKRz?uri=spotify:track:7LoBfKLpz4BGrxCuOzAKRz" : o.anchorHref,
    checked: o.checked === undefined ? "false" : o.checked,
    likedBox: o.likedBox === undefined ? "true" : o.likedBox,
    menuOpen: false,
    playing: o.playing === undefined ? true : o.playing,
    positionMs: o.positionMs === undefined ? 1000 : o.positionMs,
    durationMs: o.durationMs === undefined ? 207000 : o.durationMs,
    useRange: o.useRange === undefined ? true : o.useRange,
    posText: o.posText || "0:01",
    durText: o.durText || "3:27",
    doneClicked: false,
    cancelClicked: false,
  };

  const mainBtn = button(state.checked, () => {
    if (state.checked === "false") {
      state.checked = "true";
      mainBtn.attrs["aria-checked"] = "true";
    } else {
      state.menuOpen = true;
    }
  });

  const box = button(state.likedBox, () => {
    state.likedBox = state.likedBox === "true" ? "false" : "true";
    box.attrs["aria-checked"] = state.likedBox;
  });
  box.getAttribute = function (name) {
    if (name === "aria-checked") return state.likedBox;
    return null;
  };

  const labeled = node({ "aria-labelledby": "row", id: "listrow-title-spotify:collection:tracks" });
  labeled.closest = (sel) => (String(sel).includes("menuitemcheckbox") ? box : null);

  const done = node({ type: "submit" }, "Done");
  done.click = () => {
    state.doneClicked = true;
    state.menuOpen = false;
  };

  const cancel = node({ type: "button" }, "Cancel");
  cancel.click = () => {
    state.cancelClicked = true;
    state.menuOpen = false;
  };

  const menu = {
    querySelector(sel) {
      if (String(sel).includes("listrow-title-spotify")) return labeled;
      if (String(sel).includes("menuitemcheckbox")) return box;
      if (String(sel).includes('button[type="submit"]')) return o.noDone ? null : done;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === "button") return [box, done, cancel];
      return [];
    },
  };

  const titleNode = node({}, state.title);
  const artistNode = node({}, state.artist);
  const linkNode = node({ href: state.albumHref });
  const anchorNode = node({ href: state.anchorHref });
  const widgetAnchor = o.widgetAnchorHref ? node({ href: o.widgetAnchorHref }) : null;
  const playBtn = node({ "aria-label": state.playing ? "Pause" : "Play" });
  const range = { value: String(state.positionMs), max: String(state.durationMs) };
  const bar = { querySelector: () => range };
  const posNode = node({}, state.posText);
  const durNode = node({}, state.durText);

  const widget = {
    querySelector(sel) {
      if (String(sel).includes("context-link") || String(sel).includes("spotify:track") || String(sel).includes("spotify%3A")) return widgetAnchor;
      if (String(sel).includes("info-title")) return titleNode;
      if (String(sel).includes("info-artist")) return artistNode;
      if (String(sel).includes("item-link")) return linkNode;
      if (String(sel).includes("button")) return mainBtn;
      return null;
    },
  };

  const doc = {
    querySelector(sel) {
      const s = String(sel);
      if (s.includes("context-menu")) return state.menuOpen ? menu : null;
      if (s.includes("now-playing-widget") && s.includes("button")) return mainBtn;
      if (s.includes("now-playing-widget")) return widget;
      if (s.includes("control-button-playpause")) return playBtn;
      if (s.includes("playback-progressbar") && s.includes("input")) return state.useRange ? range : null;
      if (s.includes("playback-progressbar")) return bar;
      if (s.includes("playback-position")) return posNode;
      if (s.includes("playback-duration")) return durNode;
      if (s.includes("context-link") || s.includes("spotify:track") || s.includes("spotify%3A")) {
        return state.anchorHref ? anchorNode : null;
      }
      if (s.includes("item-link")) return linkNode;
      if (s.includes("info-title")) return titleNode;
      if (s.includes("info-artist")) return artistNode;
      if (s.includes("button[aria-checked]")) return mainBtn;
      return null;
    },
  };

  return { doc, state, mainBtn, box };
}

test("readTrack resolves identity from the real track anchor", () => {
  const { doc } = fakePlayer();
  assert.deepEqual(readTrack(doc), {
    id: "7LoBfKLpz4BGrxCuOzAKRz",
    uri: "spotify:track:7LoBfKLpz4BGrxCuOzAKRz",
    title: "Immune to Danger",
    artist: "Hippie Sabotage",
  });
});

test("readTrack falls back to a deterministic slug uri without an anchor", () => {
  const { doc } = fakePlayer({ anchorHref: null });
  const track = readTrack(doc);
  assert.ok(track.uri.startsWith("spotify:track:slug-"));
  assert.equal(track.title, "Immune to Danger");
  const again = readTrack(fakePlayer({ anchorHref: null }).doc);
  assert.equal(track.uri, again.uri);
});

test("readTrack returns null when the widget or names are missing", () => {
  assert.equal(readTrack({ querySelector: () => null }), null);
  assert.equal(readTrack(fakePlayer({ title: "  " }).doc), null);
});

test("readPlayback reports playing state and millisecond range values", () => {
  const { doc } = fakePlayer({ positionMs: 61000, durationMs: 207000 });
  const sample = readPlayback(doc, 5000);
  assert.equal(sample.playing, true);
  assert.equal(sample.positionMs, 61000);
  assert.equal(sample.durationMs, 207000);
  assert.equal(sample.track.id, "7LoBfKLpz4BGrxCuOzAKRz");
});

test("readPlayback falls back to MM:SS text without a range input", () => {
  const { doc } = fakePlayer({ useRange: false });
  const sample = readPlayback(doc, 0);
  assert.equal(sample.positionMs, 1000);
  assert.equal(sample.durationMs, 207000);
});

test("readLikeHint reports unliked fast path and unknown otherwise", () => {
  assert.equal(readLikeHint(fakePlayer({ checked: "false" }).doc), "unliked");
  assert.equal(readLikeHint(fakePlayer({ checked: "true" }).doc), "unknown");
  assert.equal(readLikeHint({ querySelector: () => null }), "unknown");
});

test("helpers parse ids, times, and slugs", () => {
  assert.equal(extractTrackId("spotify:track:abc123"), "abc123");
  assert.equal(extractTrackId("x?uri=spotify%3Atrack%3Axyz"), "xyz");
  assert.equal(extractTrackId(null), null);
  assert.equal(parseTimeToMs("3:27"), 207000);
  assert.ok(Number.isNaN(parseTimeToMs("nope")));
  assert.equal(slugify("/album/x::A B::C"), "album-x-a-b-c");
});

test("sampler credits sounded deltas bounded by wall time", () => {
  const s = new SoundedTimeSampler();
  const track = { id: "t" };
  assert.equal(s.observe({ track, playing: true, positionMs: 1000, wallMs: 0 }), 0);
  assert.equal(s.observe({ track, playing: true, positionMs: 2500, wallMs: 1000 }), 1000);
});

test("sampler ignores pauses and seeks", () => {
  const s = new SoundedTimeSampler();
  const track = { id: "t" };
  s.observe({ track, playing: true, positionMs: 5000, wallMs: 0 });
  assert.equal(s.observe({ track, playing: false, positionMs: 5000, wallMs: 30000 }), 0);
  s.observe({ track, playing: true, positionMs: 5000, wallMs: 31000 });
  assert.equal(s.observe({ track, playing: true, positionMs: 60000, wallMs: 32000 }), 1000);
  assert.equal(s.observe({ track, playing: true, positionMs: 1000, wallMs: 33000 }), 0);
});

test("sampler resets on track switch and unreadable samples", () => {
  const s = new SoundedTimeSampler();
  s.observe({ track: { id: "a" }, playing: true, positionMs: 9000, wallMs: 0 });
  assert.equal(s.observe({ track: { id: "b" }, playing: true, positionMs: 9000, wallMs: 1000 }), 0);
  assert.equal(s.observe(null), 0);
});

test("check reads liked state through the curation menu", async () => {
  const liked = new LikeToggle(fakePlayer({ checked: "true", likedBox: "true" }).doc, { settleMs: 1 });
  assert.equal(await liked.check(), "liked");
  const unliked = new LikeToggle(fakePlayer({ checked: "false" }).doc, { settleMs: 1 });
  assert.equal(await unliked.check(), "unliked");
});

test("save clicks straight through when nothing is saved yet", async () => {
  const { doc, state } = fakePlayer({ checked: "false" });
  const out = await new LikeToggle(doc, { settleMs: 1 }).save();
  assert.deepEqual(out, { ok: true, action: "saved" });
  assert.equal(state.checked, "true");
});

test("save skips tracks already in Liked Songs", async () => {
  const { doc, state } = fakePlayer({ checked: "true", likedBox: "true" });
  const out = await new LikeToggle(doc, { settleMs: 1 }).save();
  assert.deepEqual(out, { ok: true, action: "already-saved" });
  assert.equal(state.doneClicked, false);
});

test("save adds Liked Songs membership from the menu for other-playlist tracks", async () => {
  const { doc, state } = fakePlayer({ checked: "true", likedBox: "false" });
  const out = await new LikeToggle(doc, { settleMs: 1 }).save();
  assert.deepEqual(out, { ok: true, action: "saved" });
  assert.equal(state.likedBox, "true");
  assert.equal(state.doneClicked, true);
});

test("remove clears Liked Songs membership and is idempotent", async () => {
  const ctx = fakePlayer({ checked: "true", likedBox: "true" });
  const toggle = new LikeToggle(ctx.doc, { settleMs: 1 });
  assert.deepEqual(await toggle.remove(), { ok: true, action: "removed" });
  assert.equal(ctx.state.likedBox, "false");
  const plain = fakePlayer({ checked: "false" });
  assert.deepEqual(await new LikeToggle(plain.doc, { settleMs: 1 }).remove(), { ok: true, action: "removed" });
});

test("the widget anchor wins over document-level anchors", () => {
  const { doc } = fakePlayer({
    anchorHref: "https://open.spotify.com/x?uri=spotify:track:docTrack111",
    widgetAnchorHref: "https://open.spotify.com/y?uri=spotify:track:widgetTrack222",
  });
  assert.equal(readTrack(doc).id, "widgetTrack222");
});

test("menu save without Done fails instead of reporting saved", async () => {
  const { doc, state } = fakePlayer({ checked: "true", likedBox: "false", noDone: true });
  const out = await new LikeToggle(doc, { settleMs: 1 }).save();
  assert.deepEqual(out, { ok: false, reason: "dom-changed" });
  assert.equal(state.cancelClicked, true);
  assert.equal(state.doneClicked, false);
});

