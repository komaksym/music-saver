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

test("shell boots modules and routes progress to the tracker", async () => {
  const chrome = stubChrome();
  await boot({ chrome });
  assert.deepEqual(await chrome.send({ type: "status" }), { ok: true });
  assert.deepEqual(await chrome.send({ type: "progress", trackId: "a", durationMs: 180_000, deltaMs: 1_000 }), { eligible: false });
  assert.deepEqual(await chrome.send({ type: "progress", trackId: "a", durationMs: 180_000, deltaMs: 161_000 }), { eligible: true });
  assert.deepEqual(await chrome.send({ type: "progress", trackId: "a", durationMs: 180_000, deltaMs: 1_000 }), { eligible: false });
});
