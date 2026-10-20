import test from "node:test";
import assert from "node:assert/strict";
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

const saveEvent = (nonce, trackId) => ({
  nonce,
  ts: 1000,
  kind: "save",
  trackId,
  uri: "spotify:track:" + trackId,
  title: "T",
  artist: "A",
  detail: "",
});

test("shell boots modules and routes progress to the tracker", async () => {
  const chrome = stubChrome();
  await boot({ chrome });
  assert.deepEqual(await chrome.send({ type: "status" }), { ok: true });
  assert.deepEqual(await chrome.send({ type: "progress", trackId: "a", durationMs: 180_000, deltaMs: 1_000 }), { eligible: false });
  assert.deepEqual(await chrome.send({ type: "progress", trackId: "a", durationMs: 180_000, deltaMs: 161_000 }), { eligible: true });
  assert.deepEqual(await chrome.send({ type: "progress", trackId: "a", durationMs: 180_000, deltaMs: 1_000 }), { eligible: false });
});

test("ms-event records the activity log and ms-read returns it", async () => {
  const chrome = stubChrome();
  await boot({ chrome });
  assert.deepEqual(await chrome.send({ type: "ms-event", event: saveEvent("n1", "track-a") }), { ok: true });
  const read = await chrome.send({ type: "ms-read", limit: 10, nowMs: 2000 });
  assert.equal(read.recent.length, 1);
  assert.equal(read.recent[0].kind, "save");
  assert.equal(read.recent[0].trackId, "track-a");
  assert.deepEqual(read.pending, []);
  assert.equal(read.settings.thresholdRatio, 0.9);
});

test("redelivered events dedupe by nonce", async () => {
  const chrome = stubChrome();
  await boot({ chrome });
  const event = saveEvent("same-nonce", "track-a");
  assert.deepEqual(await chrome.send({ type: "ms-event", event }), { ok: true });
  assert.deepEqual(await chrome.send({ type: "ms-event", event }), { ok: true, duplicate: true });
  const read = await chrome.send({ type: "ms-read", limit: 10, nowMs: 2000 });
  assert.equal(read.recent.length, 1);
});

test("fail events enqueue intents with backoff and manual retry", async () => {
  const chrome = stubChrome();
  await boot({ chrome });
  const fail = { ...saveEvent("n-fail", "track-b"), kind: "fail", detail: "save:dom-changed" };
  assert.deepEqual(await chrome.send({ type: "ms-event", event: fail }), { ok: true });
  const dueNow = await chrome.send({ type: "ms-due", nowMs: 2000 });
  assert.deepEqual(dueNow.due.map((i) => i.id), ["track-b"]);
  assert.equal(dueNow.due[0].kind, "save");
  assert.deepEqual(await chrome.send({ type: "ms-ack", id: "track-b", ok: false, nowMs: 2000 }), { ok: true });
  assert.deepEqual((await chrome.send({ type: "ms-due", nowMs: 2500 })).due, []);
  assert.deepEqual((await chrome.send({ type: "ms-due", nowMs: 3000 })).due.map((i) => i.id), ["track-b"]);
  assert.deepEqual(await chrome.send({ type: "ms-retry-now", id: "track-b", nowMs: 2500 }), { ok: true });
  assert.deepEqual((await chrome.send({ type: "ms-due", nowMs: 2500 })).due.map((i) => i.id), ["track-b"]);
  assert.deepEqual(await chrome.send({ type: "ms-ack", id: "track-b", ok: true, nowMs: 2500 }), { ok: true });
  assert.deepEqual((await chrome.send({ type: "ms-due", nowMs: 9999 })).due, []);
});

test("terminal events clear the queued intent for the track", async () => {
  const chrome = stubChrome();
  await boot({ chrome });
  await chrome.send({ type: "ms-event", event: { ...saveEvent("n1", "track-c"), kind: "fail", detail: "save:x" } });
  assert.equal((await chrome.send({ type: "ms-due", nowMs: 5000 })).due.length, 1);
  await chrome.send({ type: "ms-event", event: saveEvent("n2", "track-c") });
  assert.deepEqual((await chrome.send({ type: "ms-due", nowMs: 5000 })).due, []);
});

test("malformed events are rejected without touching the log", async () => {
  const chrome = stubChrome();
  await boot({ chrome });
  assert.deepEqual(await chrome.send({ type: "ms-event", event: null }), { ok: false });
  assert.deepEqual(await chrome.send({ type: "ms-event", event: { ts: 1, kind: "save", trackId: "x" } }), { ok: false });
  assert.deepEqual(await chrome.send({ type: "nope" }), null);
  const read = await chrome.send({ type: "ms-read", limit: 10, nowMs: 2000 });
  assert.deepEqual(read.recent, []);
});

