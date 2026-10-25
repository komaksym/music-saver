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
    trackId: o.trackId || "abc123",
    checked: o.checked || "false",
    likedBox: o.likedBox || "false",
    menuOpen: false,
    playing: true,
    positionMs: 0,
    durationMs: o.durationMs || 200000,
    doneClicked: false,
    cancelClicked: false,
    ad: false,
    clickLog: [],
    onMainClick: null,
  };
  const mainBtn = node({ "aria-checked": state.checked });
  mainBtn.click = () => {
    state.clickLog.push({ control: "like", trackId: state.trackId });
    if (state.onMainClick) state.onMainClick();
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
    state.clickLog.push({ control: "liked-row", trackId: state.trackId });
    state.likedBox = state.likedBox === "true" ? "false" : "true";
    box.attrs["aria-checked"] = state.likedBox;
  };
  box.getAttribute = (name) => (name === "aria-checked" ? state.likedBox : null);
  const labeled = node({ id: "listrow-title-spotify:collection:tracks" });
  labeled.closest = (sel) => (String(sel).includes("menuitemcheckbox") ? box : null);
  const done = node({ type: "submit" }, "Done");
  done.click = () => {
    state.clickLog.push({ control: "done", trackId: state.trackId });
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
  const anchor = node();
  anchor.getAttribute = (name) => (name === "href" && state.trackId
    ? `https://open.spotify.com/track/${state.trackId}?uri=spotify:track:${state.trackId}`
    : null);
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
  const adBar = {
    getAttribute: (name) => (name === "data-testadtype" ? (state.ad ? "ad-type-ad" : "ad-type-none") : null),
  };
  const adWidget = node({ "aria-label": "Advertisement" });
  return {
    state,
    querySelector(sel) {
      const s = String(sel);
      if (s.includes("data-testadtype")) return adBar;
      if (s.includes("now-playing-widget-v2")) return state.ad ? adWidget : null;
      if (s.includes("context-menu")) return state.menuOpen ? menu : null;
      if (s.includes("now-playing-widget") && s.includes("button")) return mainBtn;
      if (s.includes("now-playing-widget")) return state.ad ? null : widget;
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

test("a track switch during check aborts without clicking or saving the new track", async () => {
  clock.now = 0;
  const chrome = stubChrome();
  await boot({ chrome });
  const doc = fakeDoc({ checked: "true", likedBox: "false" });
  doc.state.onMainClick = () => {
    doc.state.trackId = "def456";
  };
  const { loop, events, toast } = wire(doc, chrome);
  loop.likes.settleMs = 5;
  await listenThrough(loop, doc, 190000);
  assert.deepEqual(events.map((e) => e.kind), ["fail"]);
  assert.equal(events[0].trackId, "abc123");
  assert.equal(events[0].detail, "save:track-changed");
  assert.equal(toast.shown, 0);
  assert.equal(doc.state.doneClicked, false);
  assert.ok(doc.state.clickLog.length > 0);
  assert.ok(doc.state.clickLog.every((c) => c.trackId === "abc123"));
});

test("a track switch during the Like settle records fail instead of saving", async () => {
  clock.now = 0;
  const chrome = stubChrome();
  await boot({ chrome });
  const doc = fakeDoc();
  doc.state.onMainClick = () => {
    doc.state.trackId = "def456";
  };
  const { loop, events, toast } = wire(doc, chrome);
  loop.likes.settleMs = 5;
  await listenThrough(loop, doc, 190000);
  assert.deepEqual(events.map((e) => e.kind), ["fail"]);
  assert.equal(events[0].trackId, "abc123");
  assert.equal(events[0].detail, "save:track-changed");
  assert.equal(toast.shown, 0);
  assert.ok(doc.state.clickLog.every((c) => c.trackId === "abc123"));
});

test("a read failure after check fails closed without saving", async () => {
  clock.now = 0;
  const chrome = stubChrome();
  await boot({ chrome });
  const doc = fakeDoc();
  const { loop, events, toast } = wire(doc, chrome);
  let saveCalls = 0;
  let checking = false;
  loop.likes = {
    check: async () => {
      checking = true;
      return "unliked";
    },
    save: async () => {
      saveCalls += 1;
      return { ok: true, action: "saved" };
    },
    remove: async () => ({ ok: false, reason: "dom-changed" }),
  };
  const realRead = loop.read;
  loop.read = (now) => {
    if (checking) throw new Error("player DOM changed");
    return realRead(now);
  };
  await listenThrough(loop, doc, 190000);
  assert.deepEqual(events.map((e) => e.kind), ["fail"]);
  assert.equal(events[0].detail, "save:track-changed");
  assert.equal(saveCalls, 0);
  assert.equal(toast.shown, 0);
});

test("a thrown check records check-threw", async () => {
  clock.now = 0;
  const chrome = stubChrome();
  await boot({ chrome });
  const doc = fakeDoc();
  const { loop, events } = wire(doc, chrome, {
    likes: {
      check: async () => {
        throw new Error("menu unavailable");
      },
      save: async () => ({ ok: true, action: "saved" }),
      remove: async () => ({ ok: true, action: "removed" }),
    },
  });
  await listenThrough(loop, doc, 190000);
  assert.deepEqual(events.map((e) => e.kind), ["fail"]);
  assert.equal(events[0].detail, "save:check-threw");
});

test("handleEligible refuses a track that is no longer current", async () => {
  clock.now = 0;
  const chrome = stubChrome();
  await boot({ chrome });
  const doc = fakeDoc();
  const { loop, events } = wire(doc, chrome);
  doc.state.trackId = "def456";
  const event = await loop.handleEligible(
    { id: "abc123", uri: "spotify:track:abc123", title: "Long Song", artist: "Test Artist" },
    0,
  );
  assert.equal(event.kind, "fail");
  assert.equal(event.detail, "save:track-changed");
  assert.deepEqual(events.map((e) => e.kind), ["fail"]);
});

test("a thrown save records save-threw", async () => {
  clock.now = 0;
  const chrome = stubChrome();
  await boot({ chrome });
  const doc = fakeDoc();
  const { loop, events } = wire(doc, chrome, {
    likes: {
      check: async () => "unliked",
      save: async () => {
        throw new Error("menu unavailable");
      },
      remove: async () => ({ ok: true, action: "removed" }),
    },
  });
  await listenThrough(loop, doc, 190000);
  assert.deepEqual(events.map((e) => e.kind), ["fail"]);
  assert.equal(events[0].detail, "save:save-threw");
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

test("Undo that loses the track while removing fails without clicking Done", async () => {
  clock.now = 0;
  const chrome = stubChrome();
  await boot({ chrome });
  const doc = fakeDoc();
  const { loop, events, toast } = wire(doc, chrome);
  await listenThrough(loop, doc, 190000);
  assert.deepEqual(events.map((e) => e.kind), ["save"]);
  doc.state.onMainClick = () => {
    doc.state.trackId = "def456";
  };
  loop.likes.settleMs = 5;
  await toast.onUndo();
  await flush();
  assert.deepEqual(events.map((e) => e.kind), ["save", "fail"]);
  assert.equal(events[1].detail, "remove:track-changed");
  assert.equal(doc.state.doneClicked, false);
  assert.ok(doc.state.clickLog.every((c) => c.trackId === "abc123"));
});

test("a thrown remove records remove-threw", async () => {
  clock.now = 0;
  const chrome = stubChrome();
  await boot({ chrome });
  const doc = fakeDoc();
  const { loop, events, toast } = wire(doc, chrome, {
    likes: {
      check: async () => "unliked",
      save: async () => ({ ok: true, action: "saved" }),
      remove: async () => {
        throw new Error("menu unavailable");
      },
    },
  });
  await listenThrough(loop, doc, 190000);
  assert.deepEqual(events.map((e) => e.kind), ["save"]);
  await toast.onUndo();
  await flush();
  assert.deepEqual(events.map((e) => e.kind), ["save", "fail"]);
  assert.equal(events[1].detail, "remove:remove-threw");
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

test("an ad break resets the sampler and a post-ad seek earns no credit", async () => {
  clock.now = 0;
  const chrome = stubChrome();
  await boot({ chrome });
  const doc = fakeDoc();
  const { loop, events } = wire(doc, chrome);

  doc.state.positionMs = 100000;
  await loop.tick();

  doc.state.ad = true;
  doc.state.positionMs = 100000;
  clock.now = 1000;
  await loop.tick();

  doc.state.ad = false;
  doc.state.positionMs = 200000;
  clock.now = 35000;
  await loop.tick();
  assert.equal(loop.tracker.soundedMs, 0);

  doc.state.positionMs = 201000;
  clock.now = 36000;
  await loop.tick();
  assert.equal(loop.tracker.soundedMs, 1000);
  assert.deepEqual(events, []);
});

test("a full listen saves on time when the live progress bar updates every five seconds", async () => {
  clock.now = 0;
  const chrome = stubChrome();
  await boot({ chrome });
  const doc = fakeDoc();
  const { loop, events } = wire(doc, chrome);
  for (let t = 0; t <= 185000; t += 1000) {
    clock.now = t;
    doc.state.positionMs = Math.floor(t / 5000) * 5000;
    await loop.tick();
  }
  assert.deepEqual(events.map((e) => e.kind), ["save"]);
  assert.equal(doc.state.checked, "true");
});

