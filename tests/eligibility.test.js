import test from "node:test";
import assert from "node:assert/strict";
import { EligibilityTracker } from "../extension/lib/eligibility.js";

const MIN = 60_000;
const TRACK_3MIN = 180_000; // 90 percent = 162s, above the 60s floor

test("fires exactly at 90 percent of a 3-minute track", () => {
  const t = new EligibilityTracker();
  assert.equal(t.sound("a", TRACK_3MIN, 161_999), false);
  assert.equal(t.sound("a", TRACK_3MIN, 1), true);
});

test("fires only once per track ID", () => {
  const t = new EligibilityTracker();
  assert.equal(t.sound("a", TRACK_3MIN, 162_000), true);
  assert.equal(t.sound("a", TRACK_3MIN, 10_000), false);
  assert.equal(t.sound("a", TRACK_3MIN, 10_000), false);
});

test("60s floor governs short tracks", () => {
  const t = new EligibilityTracker();
  assert.equal(t.sound("short", 50_000, 45_000), false); // 90 percent but below floor
  assert.equal(t.sound("short", 50_000, 15_000), true); // floor credit is real sounded time
});

test("track change resets the accumulator", () => {
  const t = new EligibilityTracker();
  assert.equal(t.sound("a", TRACK_3MIN, 100_000), false);
  assert.equal(t.sound("b", TRACK_3MIN, 100_000), false); // fresh accumulator, not 200k
  assert.equal(t.sound("b", TRACK_3MIN, 62_000), true);
});

test("stale events for a previous track are ignored", () => {
  const t = new EligibilityTracker();
  t.sound("a", TRACK_3MIN, 161_000);
  t.sound("b", TRACK_3MIN, 10_000);
  assert.equal(t.sound("a", TRACK_3MIN, 161_000), false); // consumed-switch, no credit
});

test("zero or unknown duration never fires and never throws", () => {
  const t = new EligibilityTracker();
  assert.equal(t.sound("x", 0, 999_999), false);
  assert.equal(t.sound("y", -5, 999_999), false);
  assert.equal(t.sound("", TRACK_3MIN, 999_999), false);
  assert.equal(t.sound("z", TRACK_3MIN, 0), false);
  assert.equal(t.sound("z", TRACK_3MIN, -1), false);
});

test("pauses and seeks cannot credit: only sounded deltas count", () => {
  const t = new EligibilityTracker();
  // Caller sends nothing during pause/seek, so silence here is the test: a single
  // small delta must not be eligible no matter how much wall-clock passed.
  assert.equal(t.sound("a", TRACK_3MIN, 1_000), false);
  assert.equal(t.soundedMs, 1_000);
});

test("replay after session reset re-evaluates", () => {
  const t = new EligibilityTracker();
  assert.equal(t.sound("a", TRACK_3MIN, 162_000), true);
  t.reset();
  assert.equal(t.sound("a", TRACK_3MIN, 162_000), true);
});
