import test from "node:test";
import assert from "node:assert/strict";
import {
  assertDelta,
  planBudget,
  readMatrix,
  scenarioByTrack,
  validateMatrix,
} from "../scripts/e2e-matrix-lib.mjs";

const RECORDS = readMatrix(
  new URL("../scripts/e2e-matrix.json", import.meta.url).pathname,
);

test("matrix file holds five valid scenario records", () => {
  assert.equal(RECORDS.length, 5);
  assert.deepEqual(validateMatrix(RECORDS), { ok: true, errors: [] });
});

test("already-saved seed expects no delta and no cleanup", () => {
  const seed = scenarioByTrack(RECORDS, "seed-liked-long");
  assert.equal(seed.startLiked, true);
  assert.equal(seed.expectedDelta, "none");
  assert.equal(seed.cleanup, "none");
});

test("threshold-pass seed expects a save with unlike cleanup", () => {
  const seed = scenarioByTrack(RECORDS, "seed-unliked-long");
  assert.equal(seed.expectedDelta, "save");
  assert.equal(seed.cleanup, "unlike");
});

test("placeholder track ids are rejected", () => {
  const bad = structuredClone(RECORDS);
  bad[0].trackId = "seed-liked-long";
  const result = validateMatrix(bad);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /placeholder/i);
});

test("a save without unlike cleanup is rejected", () => {
  const bad = structuredClone(RECORDS);
  bad[1].cleanup = "none";
  const result = validateMatrix(bad);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /unlike/i);
});

test("assertDelta passes already-saved and fresh-save transitions", () => {
  assert.equal(assertDelta("liked", "liked", "none").pass, true);
  const save = assertDelta("unliked", "liked", "save");
  assert.equal(save.pass, true);
  assert.equal(save.observedDelta, "save");
  assert.equal(assertDelta("unliked", "unliked", "none").pass, true);
});

test("assertDelta fails closed on unreadable like state", () => {
  for (const likeBefore of ["unknown", ""]) {
    const verdict = assertDelta(likeBefore, "unliked", "none");
    assert.equal(verdict.pass, false);
    assert.equal(verdict.observedDelta, "unknown");
  }
  const removal = assertDelta("liked", "unliked", "none");
  assert.equal(removal.pass, false);
  assert.equal(removal.observedDelta, "removal");
});

test("partial short track can never reach threshold", () => {
  const seed = scenarioByTrack(RECORDS, "seed-unliked-short");
  const budget = planBudget(seed);
  assert.equal(budget.plan, "partial");
  assert.ok(budget.thresholdMs >= 60000);
  assert.ok(budget.maxCreditedMs < budget.thresholdMs);
});

test("seek-pause credits only real play windows", () => {
  const seed = scenarioByTrack(RECORDS, "seed-unliked-seek-pause");
  const budget = planBudget(seed);
  assert.equal(budget.plan, "seek-pause");
  assert.ok(budget.maxCreditedMs < budget.thresholdMs);
});

test("full plan targets the sounded threshold", () => {
  const seed = scenarioByTrack(RECORDS, "seed-unliked-long");
  const budget = planBudget(seed);
  assert.equal(budget.targetMs, budget.thresholdMs);
  assert.equal(budget.maxCreditedMs, budget.thresholdMs);
});
