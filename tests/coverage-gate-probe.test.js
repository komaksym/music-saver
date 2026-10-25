import test from "node:test";
import assert from "node:assert/strict";
import { coverageGateProbe } from "../extension/lib/coverage-gate-probe.js";

test("coverage gate probe returns the verified marker", () => {
  assert.equal(coverageGateProbe(), "codecov-verified");
});
