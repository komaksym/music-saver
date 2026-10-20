import test from "node:test";
import assert from "node:assert/strict";
import { RetryQueue } from "../src/queue.js";

const BASE = 1_000;
const CAP = 8_000;
const save = (id) => ({ id, uri: `spotify:track:${id}`, kind: "save" });
const memStore = () => {
  let saved;
  return { load: async () => saved, save: async (items) => { saved = items; } };
};

test("due items come out in FIFO order", async () => {
  const q = new RetryQueue({ store: memStore(), baseMs: BASE, capMs: CAP });
  await q.enqueue(save("a"));
  await q.enqueue(save("b"));
  assert.deepEqual((await q.due(0)).map((i) => i.id), ["a", "b"]);
});

test("markFailed backs off exponentially up to the cap", async () => {
  const q = new RetryQueue({ store: memStore(), baseMs: BASE, capMs: CAP });
  await q.enqueue(save("a"));
  const delays = [1000, 2000, 4000, 8000, 8000];
  let now = 0;
  for (const d of delays) {
    await q.markFailed("a", now);
    assert.deepEqual(await q.due(now + d - 1), []);
    assert.deepEqual((await q.due(now + d)).map((i) => i.id), ["a"]);
    now += d;
  }
});

test("markSucceeded removes the item", async () => {
  const q = new RetryQueue({ store: memStore(), baseMs: BASE, capMs: CAP });
  await q.enqueue(save("a"));
  await q.markSucceeded("a");
  assert.deepEqual(await q.due(999_999), []);
});

test("manual retry resets attempts and makes the item due now", async () => {
  const q = new RetryQueue({ store: memStore(), baseMs: BASE, capMs: CAP });
  await q.enqueue(save("a"));
  await q.markFailed("a", 0); // next due 1000
  await q.markFailed("a", 1000); // next due 3000
  await q.retryNow("a", 1500);
  assert.deepEqual((await q.due(1500)).map((i) => i.id), ["a"]);
  await q.markFailed("a", 1500); // attempts were reset, delay back to base
  assert.deepEqual(await q.due(2499), []);
  assert.deepEqual((await q.due(2500)).map((i) => i.id), ["a"]);
});

test("duplicate enqueue keeps the original entry", async () => {
  const q = new RetryQueue({ store: memStore(), baseMs: BASE, capMs: CAP });
  await q.enqueue(save("a"));
  await q.markFailed("a", 0);
  await q.enqueue(save("a"));
  assert.deepEqual(await q.due(999), []); // still backing off, not reset
});

test("state survives through the injected store", async () => {
  const store = memStore();
  const q1 = new RetryQueue({ store, baseMs: BASE, capMs: CAP });
  await q1.enqueue(save("a"));
  await q1.markFailed("a", 0);
  const q2 = new RetryQueue({ store, baseMs: BASE, capMs: CAP });
  assert.deepEqual(await q2.due(999), []);
  assert.deepEqual((await q2.due(1000)).map((i) => i.id), ["a"]);
});

test("invalid items are rejected without touching the queue", async () => {
  const q = new RetryQueue({ store: memStore(), baseMs: BASE, capMs: CAP });
  await assert.rejects(q.enqueue({}), Error);
  await assert.rejects(q.enqueue({ id: "x", kind: "launch" }), Error);
  await assert.rejects(q.enqueue({ id: "", uri: "spotify:track:x", kind: "save" }), Error);
  assert.deepEqual(await q.due(999_999), []);
});
