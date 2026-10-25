import test from "node:test";
import assert from "node:assert/strict";
import { WatchLoop } from "../extension/content.js";
import {
  readTrack,
  readPlayback,
  readAdType,
  readLikeHint,
  extractTrackId,
  parseTimeToMs,
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
    rowsDelayMs: o.rowsDelayMs || 0,
    rowsReady: !(o.rowsDelayMs > 0),
    otherClicked: false,
    playing: o.playing === undefined ? true : o.playing,
    positionMs: o.positionMs === undefined ? 1000 : o.positionMs,
    durationMs: o.durationMs === undefined ? 207000 : o.durationMs,
    useRange: o.useRange === undefined ? true : o.useRange,
    posText: o.posText || "0:01",
    durText: o.durText || "3:27",
    doneClicked: false,
    cancelClicked: false,
    noLike: !!o.noLike,
    adType: o.adType === undefined ? "ad-type-none" : o.adType,
    adWidget: !!o.adWidget,
  };

  const mainBtn = button(state.checked, () => {
    if (state.checked === "false") {
      state.checked = "true";
      mainBtn.attrs["aria-checked"] = "true";
    } else {
      state.menuOpen = true;
      if (state.rowsDelayMs > 0 && !state.rowsReady) {
        setTimeout(() => {
          state.rowsReady = true;
        }, state.rowsDelayMs);
      }
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

  const otherBox = button(o.otherChecked === undefined ? "false" : o.otherChecked, () => {
    state.otherClicked = true;
  });
  otherBox.textContent = o.otherLabel === undefined ? "Upbeat Focus" : o.otherLabel;
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
      if (String(sel).includes("listrow-title-spotify")) return state.rowsReady && !o.noLikedRow ? labeled : null;
      if (String(sel).includes("menuitemcheckbox")) {
        if (!state.rowsReady) return null;
        return o.noLikedRow ? otherBox : box;
      }
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
  const anchorNode = node({ href: state.anchorHref }, o.anchorText === undefined ? state.title : o.anchorText);
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
      if (String(sel).includes("button")) return state.noLike ? null : mainBtn;
      return null;
    },
  };

  const doc = {
    querySelector(sel) {
      const s = String(sel);
      if (s.includes("data-testadtype")) return node({ "data-testadtype": state.adType });
      if (s.includes("now-playing-widget-v2")) {
        return state.adWidget ? node({ "aria-label": "Advertisement" }) : null;
      }
      if (s.includes("context-menu")) return state.menuOpen ? menu : null;
      if (s.includes("now-playing-widget") && s.includes("button")) {
        return state.noLike || state.adWidget ? null : mainBtn;
      }
      if (s.includes("now-playing-widget")) return state.adWidget ? null : widget;
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
      if (s.includes("button[aria-checked]")) return state.noLike ? null : mainBtn;
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

test("readTrack refuses an ad-like segment without a track anchor", () => {
  const { doc } = fakePlayer({ anchorHref: null });
  assert.equal(readTrack(doc), null);
});

for (const candidate of [
  { name: "stale", href: "spotify:track:previousSong", title: "Previous song" },
  { name: "invalid", href: "/album/album123", title: "Current song" },
]) {
  for (const location of ["sidebar", "document"]) {
    test(`readTrack skips a ${candidate.name} sidebar anchor for a current ${location} anchor`, () => {
      const current = node({ href: "spotify:track:currentSong" }, "Current song");
      const rejected = node({ href: candidate.href }, candidate.title);
      const widget = {
        querySelector(selector) {
          if (selector.includes("info-title")) return node({}, "Current song");
          if (selector.includes("info-artist")) return node({}, "Current artist");
          return null;
        },
      };
      const sidebar = {
        querySelector: () => rejected,
        querySelectorAll: () => location === "sidebar" ? [rejected, current] : [rejected],
      };
      const doc = {
        querySelector(selector) {
          if (selector === '[data-testid="now-playing-widget"]') return widget;
          if (selector === 'aside[aria-label="Now playing view"]') return sidebar;
          return selector.startsWith("a[") && location === "document" ? current : null;
        },
      };
      assert.deepEqual(readTrack(doc), {
        id: "currentSong",
        uri: "spotify:track:currentSong",
        title: "Current song",
        artist: "Current artist",
      });
    });
  }
}

test("readTrack returns null when the widget or names are missing", () => {
  assert.equal(readTrack({ querySelector: () => null }), null);
  assert.equal(readTrack(fakePlayer({ title: "  " }).doc), null);
});

test("readPlayback reports playing state and millisecond range values", () => {
  const { doc } = fakePlayer({ positionMs: 61000, durationMs: 207000 });
  const sample = readPlayback(doc, 5000);
  assert.equal(sample.kind, "track");
  assert.equal(sample.playing, true);
  assert.equal(sample.positionMs, 61000);
  assert.equal(sample.durationMs, 207000);
  assert.equal(sample.track.id, "7LoBfKLpz4BGrxCuOzAKRz");
});

test("readPlayback falls back to MM:SS text without a range input", () => {
  const { doc } = fakePlayer({ useRange: false });
  const sample = readPlayback(doc, 0);
  assert.equal(sample.kind, "track");
  assert.equal(sample.positionMs, 1000);
  assert.equal(sample.durationMs, 207000);
});

test("ad-like segments never credit time, queue work, or crash", async () => {
  const { doc } = fakePlayer({ title: "Advertisement", artist: "Spotify", anchorHref: null, durationMs: 0, durText: "0:00" });
  const ad = readPlayback(doc, 0);
  assert.deepEqual(ad, { kind: "ad", track: null, playing: true, wallMs: 0, positionMs: 0, durationMs: 0 });

  const sampler = new SoundedTimeSampler();
  const track = { id: "t" };
  assert.equal(sampler.observe({ kind: "track", track, playing: true, positionMs: 0, durationMs: 200000, wallMs: 0 }), 0);
  assert.equal(sampler.observe({ kind: "track", track, playing: true, positionMs: 1000, durationMs: 200000, wallMs: 1000 }), 1000);
  assert.equal(sampler.observe(ad), 0);
  assert.equal(sampler.observe({ ...ad, wallMs: 2000 }), 0);
  assert.equal(sampler.observe({ kind: "track", track, playing: true, positionMs: 2000, durationMs: 200000, wallMs: 3000 }), 0);

  const { doc: staleDoc } = fakePlayer({ title: "Advertisement", anchorHref: "https://open.spotify.com/track/stale?uri=spotify:track:stale", anchorText: "Immune to Danger" });
  assert.equal(readPlayback(staleDoc, 0).kind, "ad");

  const { doc: noLikeDoc } = fakePlayer({ noLike: true, positionMs: 5000, durationMs: 200000 });
  assert.equal(readPlayback(noLikeDoc, 0).kind, "ad");

  const { doc: unidentifiedDoc } = fakePlayer({ anchorHref: null });
  const messages = [];
  const loop = WatchLoop.create({
    doc: unidentifiedDoc,
    settings: {},
    sendMessage: async (message) => {
      messages.push(message);
      return null;
    },
    nowMs: () => 0,
  });
  assert.equal(await loop.tick(), null);
  assert.deepEqual(messages, []);

  const brokenDoc = {
    querySelector() {
      throw new Error("player DOM changed");
    },
  };
  assert.equal(readPlayback(brokenDoc, 0), null);
});

test("readLikeHint reports unliked fast path and unknown otherwise", () => {
  assert.equal(readLikeHint(fakePlayer({ checked: "false" }).doc), "unliked");
  assert.equal(readLikeHint(fakePlayer({ checked: "true" }).doc), "unknown");
  assert.equal(readLikeHint({ querySelector: () => null }), "unknown");
});

test("an ad marker wins over a stale track anchor and a live Like control", () => {
  const { doc } = fakePlayer({
    adType: "ad-type-ad",
    anchorHref: "https://open.spotify.com/track/stale?uri=spotify:track:stale",
    anchorText: "Immune to Danger",
    positionMs: 90000,
    durationMs: 207000,
  });
  assert.equal(readTrack(doc), null);
  assert.equal(readPlayback(doc, 0).kind, "ad");
});

test("the live ad widget replaces the track widget", () => {
  const { doc } = fakePlayer({
    adType: "ad-type-ad",
    adWidget: true,
    title: "Advertisement",
    artist: "Spotify",
    anchorHref: null,
    positionMs: 5000,
    durationMs: 30000,
    durText: "0:30",
  });
  assert.equal(readPlayback(doc, 0).kind, "ad");
  assert.equal(readTrack(doc), null);
});

test("the ad widget wins when the bar still shows ad-type-none", () => {
  const { doc } = fakePlayer({
    adType: "ad-type-none",
    adWidget: true,
  });
  assert.equal(readAdType(doc), "ad");
  assert.equal(readPlayback(doc, 0).kind, "ad");
});

test("helpers parse ids and times", () => {
  assert.equal(extractTrackId("spotify:track:abc123"), "abc123");
  assert.equal(extractTrackId("x?uri=spotify%3Atrack%3Axyz"), "xyz");
  assert.equal(extractTrackId(null), null);
  assert.equal(parseTimeToMs("3:27"), 207000);
  assert.ok(Number.isNaN(parseTimeToMs("nope")));
});

test("sampler credits sounded deltas bounded by wall time", () => {
  const s = new SoundedTimeSampler();
  const track = { id: "t" };
  assert.equal(s.observe({ kind: "track", track, playing: true, positionMs: 1000, durationMs: 200000, wallMs: 0 }), 0);
  assert.equal(s.observe({ kind: "track", track, playing: true, positionMs: 2500, durationMs: 200000, wallMs: 1000 }), 1000);
});

test("sampler credits every second when the live progress bar moves in five-second steps", () => {
  const s = new SoundedTimeSampler();
  const track = { id: "t" };
  assert.equal(s.observe({ kind: "track", track, playing: true, positionMs: 0, durationMs: 200000, wallMs: 0 }), 0);
  for (let t = 1; t < 5; t += 1) {
    assert.equal(s.observe({ kind: "track", track, playing: true, positionMs: 0, durationMs: 200000, wallMs: t * 1000 }), 0);
  }
  assert.equal(s.observe({ kind: "track", track, playing: true, positionMs: 5000, durationMs: 200000, wallMs: 5000 }), 5000);
});

test("sampler ignores pauses and seeks", () => {
  const s = new SoundedTimeSampler();
  const track = { id: "t" };
  s.observe({ kind: "track", track, playing: true, positionMs: 5000, durationMs: 200000, wallMs: 0 });
  assert.equal(s.observe({ kind: "track", track, playing: false, positionMs: 5000, durationMs: 200000, wallMs: 30000 }), 0);
  s.observe({ kind: "track", track, playing: true, positionMs: 5000, durationMs: 200000, wallMs: 31000 });
  assert.equal(s.observe({ kind: "track", track, playing: true, positionMs: 60000, durationMs: 200000, wallMs: 32000 }), 1000);
  assert.equal(s.observe({ kind: "track", track, playing: true, positionMs: 1000, durationMs: 200000, wallMs: 33000 }), 0);
});

test("sampler credits quantized position jumps against accumulated playing time", () => {
  // Spotify refreshes the progress bar in multi-second steps in background
  // tabs while the watch loop polls every second. Each jump must credit in
  // full: the audio played through the whole gap, not just the last second.
  const s = new SoundedTimeSampler();
  const track = { id: "t" };
  let total = 0;
  let pos = 0;
  total += s.observe({ kind: "track", track, playing: true, positionMs: 0, durationMs: 200000, wallMs: 0 });
  for (let t = 1; t <= 15; t++) {
    if (t % 5 === 0) pos += 5000;
    total += s.observe({ kind: "track", track, playing: true, positionMs: pos, durationMs: 200000, wallMs: t * 1000 });
  }
  assert.equal(total, 15000);
});

test("sampler caps forward-seek credit after unchanged samples", () => {
  const s = new SoundedTimeSampler();
  const track = { id: "t" };
  assert.equal(s.observe({ kind: "track", durationMs: 200000, track, playing: true, positionMs: 0, wallMs: 0 }), 0);
  for (let t = 1; t <= 5; t++) {
    assert.equal(s.observe({ kind: "track", durationMs: 200000, track, playing: true, positionMs: 0, wallMs: t * 1000 }), 0);
  }
  assert.equal(s.observe({ kind: "track", durationMs: 200000, track, playing: true, positionMs: 55000, wallMs: 6000 }), 1000);
  assert.equal(s.observe({ kind: "track", durationMs: 200000, track, playing: true, positionMs: 56000, wallMs: 7000 }), 1000);
});

test("sampler resets on track switch and unreadable samples", () => {
  const s = new SoundedTimeSampler();
  s.observe({ kind: "track", track: { id: "a" }, playing: true, positionMs: 9000, durationMs: 200000, wallMs: 0 });
  assert.equal(s.observe({ kind: "track", track: { id: "b" }, playing: true, positionMs: 9000, durationMs: 200000, wallMs: 1000 }), 0);
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

test("save refuses a like when another track is current", async () => {
  const { doc, state } = fakePlayer({ checked: "false" });
  const toggle = new LikeToggle(doc, { settleMs: 1, currentTrackId: () => "track-b" });
  assert.deepEqual(await toggle.save("track-a"), { ok: false, reason: "track-changed" });
  assert.equal(state.checked, "false");
});

test("save fails closed when the track reader throws", async () => {
  const { doc, state } = fakePlayer({ checked: "false" });
  const toggle = new LikeToggle(doc, {
    settleMs: 1,
    currentTrackId: () => {
      throw new Error("player DOM changed");
    },
  });
  assert.deepEqual(await toggle.save("track-a"), { ok: false, reason: "track-changed" });
  assert.equal(state.checked, "false");
});

test("check reports a track change instead of reading the new track", async () => {
  let reads = 0;
  const { doc } = fakePlayer({ checked: "false" });
  const toggle = new LikeToggle(doc, {
    settleMs: 1,
    currentTrackId: () => (++reads === 1 ? "track-a" : "track-b"),
  });
  assert.equal(await toggle.check("track-a"), "track-changed");
});

test("save aborts before Done when the track changes during the settle", async () => {
  let currentId = "track-a";
  const ctx = fakePlayer({ checked: "true", likedBox: "false" });
  const boxClick = ctx.box.click;
  ctx.box.click = () => {
    boxClick();
    currentId = "track-b";
  };
  const toggle = new LikeToggle(ctx.doc, { settleMs: 20, currentTrackId: () => currentId });
  assert.deepEqual(await toggle.save("track-a"), { ok: false, reason: "track-changed" });
  assert.equal(ctx.state.doneClicked, false);
  assert.equal(ctx.state.likedBox, "true");
});

test("remove aborts before Done when the track changes during the settle", async () => {
  let currentId = "track-a";
  const ctx = fakePlayer({ checked: "true", likedBox: "true" });
  const boxClick = ctx.box.click;
  ctx.box.click = () => {
    boxClick();
    currentId = "track-b";
  };
  const toggle = new LikeToggle(ctx.doc, { settleMs: 20, currentTrackId: () => currentId });
  assert.deepEqual(await toggle.remove("track-a"), { ok: false, reason: "track-changed" });
  assert.equal(ctx.state.doneClicked, false);
});

test("check aborts when the track changes while playlist rows load", async () => {
  let currentId = "track-a";
  const { doc } = fakePlayer({ checked: "true", likedBox: "false", rowsDelayMs: 40 });
  setTimeout(() => {
    currentId = "track-b";
  }, 5);
  const toggle = new LikeToggle(doc, {
    settleMs: 1,
    contentTimeoutMs: 500,
    contentPollMs: 10,
    currentTrackId: () => currentId,
  });
  assert.equal(await toggle.check("track-a"), "track-changed");
});

test("save reports a menu timeout when the menu never opens", async () => {
  const ctx = fakePlayer({ checked: "true", likedBox: "false" });
  ctx.mainBtn.click = () => {};
  const out = await new LikeToggle(ctx.doc, { settleMs: 1 }).save();
  assert.deepEqual(out, { ok: false, reason: "menu-timeout" });
  assert.equal(ctx.state.doneClicked, false);
});

test("save aborts when the track changes while playlist rows load", async () => {
  let currentId = "track-a";
  const ctx = fakePlayer({ checked: "true", likedBox: "false", rowsDelayMs: 40 });
  setTimeout(() => {
    currentId = "track-b";
  }, 5);
  const toggle = new LikeToggle(ctx.doc, {
    settleMs: 1,
    contentTimeoutMs: 500,
    contentPollMs: 10,
    currentTrackId: () => currentId,
  });
  assert.deepEqual(await toggle.save("track-a", { state: "unliked" }), { ok: false, reason: "track-changed" });
  assert.equal(ctx.state.doneClicked, false);
});

test("save aborts before the Liked Songs row click when the track changes", async () => {
  let currentId = "track-a";
  const ctx = fakePlayer({ checked: "true", likedBox: "false" });
  const getAttribute = ctx.box.getAttribute;
  ctx.box.getAttribute = (name) => {
    if (name === "aria-checked") currentId = "track-b";
    return getAttribute(name);
  };
  const toggle = new LikeToggle(ctx.doc, { settleMs: 1, currentTrackId: () => currentId });
  assert.deepEqual(await toggle.save("track-a", { state: "unliked" }), { ok: false, reason: "track-changed" });
  assert.equal(ctx.state.likedBox, "false");
  assert.equal(ctx.state.doneClicked, false);
});

test("save re-checks the track immediately before Done", async () => {
  let reads = 0;
  const ctx = fakePlayer({ checked: "true", likedBox: "false" });
  const toggle = new LikeToggle(ctx.doc, {
    settleMs: 1,
    currentTrackId: () => (++reads < 7 ? "track-a" : "track-b"),
  });
  assert.deepEqual(await toggle.save("track-a", { state: "unliked" }), { ok: false, reason: "track-changed" });
  assert.equal(ctx.state.doneClicked, false);
});

test("remove falls back to a direct click when the menu does not open", async () => {
  const ctx = fakePlayer({ checked: "true", likedBox: "true" });
  let clicks = 0;
  ctx.mainBtn.click = () => {
    clicks += 1;
  };
  const out = await new LikeToggle(ctx.doc, { settleMs: 1 }).remove();
  assert.deepEqual(out, { ok: false, reason: "confirm-mismatch" });
  assert.equal(clicks, 2);
  assert.equal(ctx.state.checked, "true");
});

test("remove aborts when the track changes while playlist rows load", async () => {
  let currentId = "track-a";
  const ctx = fakePlayer({ checked: "true", likedBox: "true", rowsDelayMs: 40 });
  setTimeout(() => {
    currentId = "track-b";
  }, 5);
  const toggle = new LikeToggle(ctx.doc, {
    settleMs: 1,
    contentTimeoutMs: 500,
    contentPollMs: 10,
    currentTrackId: () => currentId,
  });
  assert.deepEqual(await toggle.remove("track-a"), { ok: false, reason: "track-changed" });
  assert.equal(ctx.state.doneClicked, false);
});

test("remove aborts before the Liked Songs row click when the track changes", async () => {
  let currentId = "track-a";
  const ctx = fakePlayer({ checked: "true", likedBox: "true" });
  const getAttribute = ctx.box.getAttribute;
  ctx.box.getAttribute = (name) => {
    if (name === "aria-checked") currentId = "track-b";
    return getAttribute(name);
  };
  const toggle = new LikeToggle(ctx.doc, { settleMs: 1, currentTrackId: () => currentId });
  assert.deepEqual(await toggle.remove("track-a"), { ok: false, reason: "track-changed" });
  assert.equal(ctx.state.doneClicked, false);
});

test("remove re-checks the track immediately before Done", async () => {
  let reads = 0;
  const ctx = fakePlayer({ checked: "true", likedBox: "true" });
  const toggle = new LikeToggle(ctx.doc, {
    settleMs: 1,
    currentTrackId: () => (++reads < 7 ? "track-a" : "track-b"),
  });
  assert.deepEqual(await toggle.remove("track-a"), { ok: false, reason: "track-changed" });
  assert.equal(ctx.state.doneClicked, false);
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

test("check waits for lazily loaded playlist rows", async () => {
  const { doc } = fakePlayer({ checked: "true", likedBox: "false", rowsDelayMs: 40 });
  const toggle = new LikeToggle(doc, { settleMs: 1, contentTimeoutMs: 2000, contentPollMs: 10 });
  assert.equal(await toggle.check(), "unliked");
});

test("save waits for lazily loaded rows instead of failing", async () => {
  const { doc, state } = fakePlayer({ checked: "true", likedBox: "false", rowsDelayMs: 40 });
  const out = await new LikeToggle(doc, { settleMs: 1, contentTimeoutMs: 2000, contentPollMs: 10 }).save();
  assert.deepEqual(out, { ok: true, action: "saved" });
  assert.equal(state.likedBox, "true");
});

test("save without any Liked Songs row fails safe without touching other playlists", async () => {
  const { doc, state } = fakePlayer({ checked: "true", noLikedRow: true });
  const out = await new LikeToggle(doc, { settleMs: 1, contentTimeoutMs: 60, contentPollMs: 10 }).save();
  assert.deepEqual(out, { ok: false, reason: "menu-timeout" });
  assert.equal(state.otherClicked, false);
  assert.equal(state.doneClicked, false);
  const state2 = await new LikeToggle(doc, { settleMs: 1, contentTimeoutMs: 30, contentPollMs: 10 }).check();
  assert.equal(state2, "unknown");
});

