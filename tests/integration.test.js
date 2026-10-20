import test from "node:test";
import assert from "node:assert/strict";
import { WatchLoop } from "../extension/content.js";
import { boot } from "../extension/background.js";

function stubChrome() {
  const data = {};
  let listener;
  return {
    storage: { local: { get: async (k) => ({ [k]: data[k] }), set: async (o) => Object.assign(data, o) } },
    runtime: { onMessage: { addListener: (fn) => { listener = fn; } } },
    send: (msg) => new Promise((resolve) => listener(msg, {}, resolve)),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 30));
const flushLong = () => new Promise((r) => setTimeout(r, 2500));

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

// Player fake mirroring the verified web-player mechanics: a direct Like
// click flips an unsaved toggle; clicking a saved toggle opens the
// curation menu where the Liked-Songs checkbox flips and Done commits.
function fakeDoc(opts) {
  const o = opts || {};
  const state = {
    checked: o.checked || "false",
    likedBox: o.likedBox || "false",
    menuOpen: false,
    playing: true,
    positionMs: 0,
    durationMs: o.durationMs || 200000,
    doneClicked: false,
    cancelClicked: false,
  };
  const mainBtn = node({ "aria-checked": state.checked });
  mainBtn.click = () => {
    if (state.checked === "false") {
      state.checked = "true";
      state.likedBox = "true";
      mainBtn.attrs["aria-checked"] = "true";
    } else {
      state.menuOpen = true;
    }
  };
  const box = node({ "aria-checked": state.likedBox });
  box.click = () => {
    state.likedBox = state.likedBox === "true" ? "false" : "true";
    box.attrs["aria-checked"] = state.likedBox;
  };
  box.getAttribute = (name) => (name === "aria-checked" ? state.likedBox : null);
  const labeled = node({ id: "listrow-title-spotify:collection:tracks" });
  labeled.closest = (sel) => (String(sel).includes("menuitemcheckbox") ? box : null);
  const done = node({ type: "submit" }, "Done");
  done.click = () => {
    state.doneClicked = true;
    state.menuOpen = false;
    state.checked = state.likedBox;
    mainBtn.attrs["aria-checked"] = state.checked;
  };
  const cancel = node({ type: "button" }, "Cancel");
  cancel.click = () => {
    state.cancelClicked = true;
    state.menuOpen = false;
  };
  const menu = {
    querySelector(sel) {
      const s = String(sel);
      if (s.includes("listrow-title-spotify")) return labeled;
      if (s.includes("menuitemcheckbox")) return box;
      if (s.includes('button[type="submit"]')) return done;
      return null;
    },
    querySelectorAll(sel) {
      return sel === "button" ? [box, done, cancel] : [];
    },
  };
  const widget = {
    querySelector(sel) {
      const s = String(sel);
      if (s.includes("info-title")) return node({}, "Long Song");
      if (s.includes("info-artist")) return node({}, "Test Artist");
      if (s.includes("item-link")) return node({ href: "/album/x" });
      if (s.includes("button")) return mainBtn;
      return null;
    },
  };
  const anchor = node({ href: "https://open.spotify.com/track/abc?uri=spotify:track:abc123" });
  const playBtn = node({ "aria-label": "Pause" });
  const range = {
    get value() {
      return String(state.positionMs);
    },
    get max() {
      return String(state.durationMs);
    },
  };
  const bar = { querySelector: () => range };
  return {
    state,
    querySelector(sel) {
      const s = String(sel);
      if (s.includes("context-menu")) return state.menuOpen ? menu : null;
      if (s.includes("now-playing-widget") && s.includes("button")) return mainBtn;
      if (s.includes("now-playing-widget")) return widget;
      if (s.includes("control-button-playpause")) return playBtn;
      if (s.includes("playback-progressbar")) return s.includes("input") ? range : bar;
      if (s.includes("context-link") || s.includes("spotify:track")) return anchor;
      if (s.includes("item-link")) return node({ href: "/album/x" });
      if (s.includes("info-title")) return node({}, "Long Song");
      if (s.includes("info-artist")) return node({}, "Test Artist");
      if (s.includes("button[aria-checked]")) return mainBtn;
      return null;
    },
  };
}

function toastDouble() {
  return {
    shown: 0,
    onUndo: null,
    show(track, onUndo) {
      this.shown += 1;
      this.onUndo = onUndo;
    },
    dismiss() {},
  };
}

const clock = { now: 0 };

function wire(doc, chrome, opts) {
  const events = [];
  const loop = WatchLoop.create({
    doc,
    settings: (opts && opts.settings) || {},
    sendMessage: async (msg) => {
      if (msg.type === "ms-event") events.push(msg.event);
      return chrome.send(msg);
    },
    nowMs: () => clock.now,
  });
  const toast = toastDouble();
  loop.toast = toast;
  if (opts && opts.likes) loop.likes = opts.likes;
  return { loop, events, toast };
}

async function listenThrough(loop, doc, ms) {
  const step = 10000;
  for (let t = 0; t <= ms; t += step) {
    clock.now = t;
    doc.state.positionMs = t;
    await loop.tick();
  }
  await flush();
}

test("a full listen saves the track, toasts, and Undo reverses it", async () => {
  clock.now = 0;
  const chrome = stubChrome();
  await boot({ chrome });
  const doc = fakeDoc();
  const { loop, events, toast } = wire(doc, chrome);
  await listenThrough(loop, doc, 190000);
  assert.equal(doc.state.checked, "true");
  assert.deepEqual(events.map((e) => e.kind), ["save"]);
  assert.equal(events[0].trackId, "abc123");
  assert.equal(toast.shown, 1);
  const read = await chrome.send({ type: "ms-read", limit: 10, nowMs: 200000 });
  assert.deepEqual(read.recent.map((e) => e.kind), ["save"]);

  await toast.onUndo();
  await flushLong();
  assert.deepEqual(events.map((e) => e.kind), ["save", "undo"]);
  assert.equal(doc.state.checked, "false");
  const after = await chrome.send({ type: "ms-read", limit: 10, nowMs: 300000 });
  assert.deepEqual(after.recent.map((e) => e.kind), ["undo", "save"]);
});

test("a second full listen of the same track does not save twice", async () => {
  clock.now = 0;
  const chrome = stubChrome();
  await boot({ chrome });
  const doc = fakeDoc();
  const { loop, events } = wire(doc, chrome);
  await listenThrough(loop, doc, 190000);
  await listenThrough(loop, doc, 190000);
  assert.deepEqual(events.map((e) => e.kind), ["save"]);
});

test("an already-liked track records skip without clicking Done", async () => {
  clock.now = 0;
  const chrome = stubChrome();
  await boot({ chrome });
  const doc = fakeDoc({ checked: "true", likedBox: "true" });
  const { loop, events, toast } = wire(doc, chrome);
  await listenThrough(loop, doc, 190000);
  assert.deepEqual(events.map((e) => e.kind), ["skip"]);
  assert.equal(doc.state.doneClicked, false);
  assert.equal(toast.shown, 0);
  const read = await chrome.send({ type: "ms-read", limit: 10, nowMs: 200000 });
  assert.equal(read.recent[0].kind, "skip");
});

test("a failed save records fail, backs off, and manual retry clears it", async () => {
  clock.now = 0;
  const chrome = stubChrome();
  await boot({ chrome });
  const doc = fakeDoc();
  const { loop, events } = wire(doc, chrome, {
    likes: {
      check: async () => "unliked",
      save: async () => ({ ok: false, reason: "dom-changed" }),
      remove: async () => ({ ok: true, action: "removed" }),
    },
  });
  await listenThrough(loop, doc, 190000);
  assert.deepEqual(events.map((e) => e.kind), ["fail"]);
  const pending = await chrome.send({ type: "ms-due", nowMs: 500000 });
  assert.deepEqual(pending.due.map((i) => i.id), ["abc123"]);
  assert.deepEqual(await chrome.send({ type: "ms-retry-now", id: "abc123", nowMs: 500000 }), { ok: true });
  assert.deepEqual(await chrome.send({ type: "ms-ack", id: "abc123", ok: true, nowMs: 500000 }), { ok: true });
  assert.deepEqual((await chrome.send({ type: "ms-due", nowMs: 600000 })).due, []);
});

test("Undo after a track switch fails safe and queues the removal", async () => {
  clock.now = 0;
  const chrome = stubChrome();
  await boot({ chrome });
  const doc = fakeDoc();
  const { loop, events } = wire(doc, chrome);
  await listenThrough(loop, doc, 190000);
  assert.deepEqual(events.map((e) => e.kind), ["save"]);
  await loop.undo({ id: "ghost", uri: "spotify:track:ghost", title: "Ghost", artist: "Nobody" });
  await flush();
  assert.deepEqual(events.map((e) => e.kind), ["save", "fail"]);
  assert.equal(events[1].detail, "remove:track-changed");
  assert.equal(doc.state.checked, "true");
  const pending = await chrome.send({ type: "ms-due", nowMs: 500000 });
  assert.deepEqual(pending.due.map((i) => [i.id, i.kind]), [["ghost", "remove"]]);
});

test("manual retry executes while the same track keeps playing", async () => {
  clock.now = 0;
  const chrome = stubChrome();
  await boot({ chrome });
  const doc = fakeDoc();
  let saveCalls = 0;
  const { loop, events } = wire(doc, chrome, {
    likes: {
      check: async () => "unliked",
      save: async () => (++saveCalls === 1 ? { ok: false, reason: "dom-changed" } : { ok: true, action: "saved" }),
      remove: async () => ({ ok: true, action: "removed" }),
    },
  });
  await listenThrough(loop, doc, 190000);
  assert.deepEqual(events.map((e) => e.kind), ["fail"]);
  assert.equal(saveCalls, 1);
  await chrome.send({ type: "ms-retry-now", id: "abc123", nowMs: clock.now });
  for (let t = 200000; t <= 240000; t += 10000) {
    clock.now = t;
    doc.state.positionMs = t;
    await loop.tick();
  }
  await flush();
  assert.equal(saveCalls, 2);
  assert.deepEqual(events.map((e) => e.kind), ["fail"]);
  assert.deepEqual((await chrome.send({ type: "ms-due", nowMs: 600000 })).due, []);
});

test("disabling settings stops the loop from saving", async () => {
  clock.now = 0;
  const chrome = stubChrome();
  await boot({ chrome });
  const doc = fakeDoc();
  const { loop, events } = wire(doc, chrome);
  loop.applySettings({ thresholdRatio: 0.9, minSoundedMs: 60000, enabled: false });
  await listenThrough(loop, doc, 190000);
  assert.deepEqual(events, []);
  assert.equal(doc.state.checked, "false");
});

