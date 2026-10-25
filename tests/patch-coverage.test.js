import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluate, parseAddedLines, parseLcov } from "../scripts/patch-coverage.mjs";

const script = new URL("../scripts/patch-coverage.mjs", import.meta.url);
const prWorkflow = readFileSync(new URL("../.github/workflows/pr.yml", import.meta.url), "utf8");

const diff = [
  "diff --git a/extension/lib/queue.js b/extension/lib/queue.js",
  "index 1111111..2222222 100644",
  "--- a/extension/lib/queue.js",
  "+++ b/extension/lib/queue.js",
  "@@ -10,0 +11,3 @@ export function save(id) {",
  "+  guard(id);",
  "+  record(id);",
  "+  return id;",
  "diff --git a/extension/options.js b/extension/options.js",
  "--- a/extension/options.js",
  "+++ b/extension/options.js",
  "@@ -3,1 +3,1 @@",
  "-old line",
  "+new line",
  "@@ -20,0 +21,1 @@",
  "+shown();",
].join("\n");

test("diff parsing keeps only added head-side lines", () => {
  const added = parseAddedLines(diff);
  assert.deepEqual([...added.get("extension/lib/queue.js")], [11, 12, 13]);
  assert.deepEqual([...added.get("extension/options.js")], [3, 21]);
});

test("lcov paths are normalized to repository-relative names", () => {
  const lcov = [
    "TN:",
    "SF:/home/runner/work/music-saver/music-saver/extension/lib/queue.js",
    "DA:11,1",
    "DA:12,0",
    "end_of_record",
  ].join("\n");
  const files = parseLcov(lcov, "/home/runner/work/music-saver/music-saver");
  const queue = files.get("extension/lib/queue.js");
  assert.equal(queue.get(11), 1);
  assert.equal(queue.get(12), 0);
});

test("changed executable lines decide the verdict", () => {
  const lcov = parseLcov(
    [
      "SF:/repo/extension/lib/queue.js",
      "DA:11,1",
      "DA:12,0",
      "DA:13,0",
      "end_of_record",
      "SF:/repo/extension/options.js",
      "DA:3,1",
      "DA:21,0",
      "end_of_record",
    ].join("\n"),
    "/repo",
  );
  const half = evaluate(lcov, parseAddedLines(diff), 80);
  assert.equal(half.executed, 5);
  assert.equal(half.covered, 2);
  assert.equal(half.pass, false);
  assert.deepEqual(half.uncovered, ["extension/lib/queue.js:12", "extension/lib/queue.js:13", "extension/options.js:21"]);

  const full = parseLcov(
    [
      "SF:/repo/extension/lib/queue.js",
      "DA:11,2",
      "DA:12,1",
      "DA:13,7",
      "end_of_record",
      "SF:/repo/extension/options.js",
      "DA:3,1",
      "DA:21,1",
      "end_of_record",
    ].join("\n"),
    "/repo",
  );
  assert.equal(evaluate(full, parseAddedLines(diff), 80).pass, true);

  const commentOnly = evaluate(new Map(), parseAddedLines(diff), 80);
  assert.equal(commentOnly.executed, 0);
  assert.equal(commentOnly.pass, true, "documentation-only additions must not block");
});

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "patch-coverage-"));
  mkdirSync(join(dir, "extension"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "ci@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "CI"], { cwd: dir });
  writeFileSync(join(dir, "extension", "save.js"), "export const save = () => 1;\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: dir });
  const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  writeFileSync(
    join(dir, "extension", "save.js"),
    "export const save = () => 1;\nexport const restore = () => 2;\nexport const clear = () => 3;\n",
  );
  execFileSync("git", ["commit", "-qam", "add untested paths"], { cwd: dir });
  return { dir, base };
}

function runGate(dir, base, lcov) {
  const lcovPath = join(dir, "lcov.info");
  writeFileSync(lcovPath, lcov.join("\n"));
  return spawnSync(process.execPath, [script.pathname, "--base", base, "--lcov", lcovPath, "--root", dir], {
    cwd: dir,
    encoding: "utf8",
  });
}

test("the gate fails and passes through its real command line", () => {
  const { dir, base } = makeRepo();
  const lcov = (restoreHits, clearHits) => [
    `SF:${join(dir, "extension", "save.js")}`,
    "DA:1,1",
    `DA:2,${restoreHits}`,
    `DA:3,${clearHits}`,
    "end_of_record",
  ];

  const failing = runGate(dir, base, lcov(0, 0));
  assert.equal(failing.status, 1, failing.stderr || failing.stdout);
  assert.match(failing.stdout + failing.stderr, /below 80%/);
  assert.match(failing.stdout + failing.stderr, /extension\/save\.js:2/);

  const passing = runGate(dir, base, lcov(1, 1));
  assert.equal(passing.status, 0, passing.stderr || passing.stdout);
  assert.match(passing.stdout, /100%/);
});

test("the coverage job uploads the report before enforcing the rule", () => {
  const job = prWorkflow.slice(prWorkflow.indexOf("  coverage:"), prWorkflow.indexOf("  gate:"));
  assert.match(job, /node scripts\/patch-coverage\.mjs --base \"\$\{\{ github\.event\.pull_request\.base\.sha \}\}\"/);
  assert.ok(job.indexOf("codecov/codecov-action") < job.indexOf("patch-coverage"));
});
