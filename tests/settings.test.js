import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, normalizeSettings, loadSettings, saveSettings } from "../src/settings.js";

const memStore = (initial) => {
  let saved = initial;
  return { load: async () => saved, save: async (v) => { saved = v; } };
};

test("empty and corrupt stores yield defaults", async () => {
  assert.deepEqual(await loadSettings(memStore(undefined)), DEFAULTS);
  assert.deepEqual(await loadSettings(memStore(null)), DEFAULTS);
  assert.deepEqual(await loadSettings(memStore("liked-songs")), DEFAULTS);
  assert.deepEqual(await loadSettings(memStore(42)), DEFAULTS);
});

test("partial stored state merges over defaults", async () => {
  assert.deepEqual(await loadSettings(memStore({ thresholdRatio: 0.8 })), { ...DEFAULTS, thresholdRatio: 0.8 });
});

test("out-of-range threshold falls back to default", async () => {
  for (const bad of [0, -0.5, 1.5, Number.NaN, "0.9"]) {
    const s = await loadSettings(memStore({ thresholdRatio: bad }));
    assert.equal(s.thresholdRatio, DEFAULTS.thresholdRatio);
  }
  const edge = await loadSettings(memStore({ thresholdRatio: 1 }));
  assert.equal(edge.thresholdRatio, 1);
});

test("negative floor falls back, zero floor is honored", async () => {
  assert.equal((await loadSettings(memStore({ minSoundedMs: -5 }))).minSoundedMs, DEFAULTS.minSoundedMs);
  assert.equal((await loadSettings(memStore({ minSoundedMs: 0 }))).minSoundedMs, 0);
});

test("non-boolean enabled falls back, unknown keys are stripped", async () => {
  const s = await loadSettings(memStore({ enabled: "yes", target: "Liked Songs" }));
  assert.equal(s.enabled, true);
  assert.deepEqual(Object.keys(s).sort(), ["enabled", "minSoundedMs", "thresholdRatio"]);
});

test("saveSettings persists normalized values and round-trips", async () => {
  const store = memStore(undefined);
  await saveSettings(store, { thresholdRatio: 0.75, minSoundedMs: 30_000, enabled: false });
  assert.deepEqual(await loadSettings(store), { thresholdRatio: 0.75, minSoundedMs: 30_000, enabled: false });
  await saveSettings(store, { thresholdRatio: 99 });
  assert.deepEqual(await loadSettings(store), { thresholdRatio: 0.9, minSoundedMs: 30_000, enabled: false });
});
