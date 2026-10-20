import test from "node:test";
import assert from "node:assert/strict";
import { ActivityLog } from "../extension/lib/log.js";

const memStore = (initial) => {
  let saved = initial;
  return { load: async () => saved, save: async (v) => { saved = v; } };
};
const ev = (kind, id = "a") => ({ ts: 1_000, kind, trackId: id, detail: "ok" });

test("recent returns newest first up to the limit", async () => {
  const log = new ActivityLog({ store: memStore() });
  await log.append({ ...ev("save"), ts: 1 });
  await log.append({ ...ev("skip"), ts: 2 });
  await log.append({ ...ev("undo"), ts: 3 });
  assert.deepEqual((await log.recent(2)).map((e) => e.kind), ["undo", "skip"]);
});

test("entries cap oldest first", async () => {
  const log = new ActivityLog({ store: memStore(), cap: 2 });
  await log.append({ ...ev("save"), ts: 1 });
  await log.append({ ...ev("skip"), ts: 2 });
  await log.append({ ...ev("fail"), ts: 3 });
  assert.deepEqual((await log.recent(10)).map((e) => e.ts), [3, 2]);
});

test("filter by kind narrows the record", async () => {
  const log = new ActivityLog({ store: memStore() });
  await log.append(ev("save"));
  await log.append(ev("fail"));
  assert.deepEqual((await log.recent(10, "fail")).map((e) => e.kind), ["fail"]);
});

test("invalid events are rejected without touching the record", async () => {
  const log = new ActivityLog({ store: memStore() });
  await assert.rejects(log.append({}), Error);
  await assert.rejects(log.append({ ts: 1, kind: "played", trackId: "a" }), Error);
  await assert.rejects(log.append({ ts: -1, kind: "save", trackId: "a" }), Error);
  assert.deepEqual(await log.recent(10), []);
});

test("record survives through the injected store", async () => {
  const store = memStore();
  await new ActivityLog({ store }).append(ev("save"));
  assert.deepEqual((await new ActivityLog({ store }).recent(10)).map((e) => e.kind), ["save"]);
});
