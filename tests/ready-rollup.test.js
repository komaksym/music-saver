import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const script = resolve("scripts/check-ready-rollup.sh");
const head = "a".repeat(40);

const REVIEWER = "cubic \u00b7 AI code reviewer";

const REQUIRED = [
  "ci",
  "pr-title",
  "ready",
  "pr-hygiene",
  "commit-lint",
  "cubic-gate",
  "actionlint",
  "trufflehog",
  "zizmor",
  REVIEWER,
];

// Fake gh serves one check-runs payload and applies the script own
// --jq filter, so verdict, ordering, and Unicode-name bugs surface instead
// of being flattened by the stub. Context names never match in shell; they
// flow through JSON and jq only. The status endpoint always reports
// success so the check-runs payload alone drives the verdict.
const STUB = "#!/usr/bin/env bash\nurl=\"$2\"\ncase \"$url\" in\n  */status) echo success; exit 0 ;;\nesac\nfilter=\"\"\nprev=\"\"\nfor a in \"$@\"; do\n  if [ \"$prev\" = \"--jq\" ]; then filter=\"$a\"; fi\n  prev=\"$a\"\ndone\nif [ -n \"$filter\" ]; then jq -r \"$filter\" \"$GH_STUB_PAYLOAD\"; else cat \"$GH_STUB_PAYLOAD\"; fi\n";

function makeRun(id, name, verdict) {
  if (verdict === "pending") {
    return { id: id, head_sha: head, name: name, status: "in_progress", conclusion: null };
  }
  return { id: id, head_sha: head, name: name, status: "completed", conclusion: verdict };
}

async function spawnStub(dir, payload) {
  await writeFile(join(dir, "runs.json"), JSON.stringify({ check_runs: payload }), "utf8");
  await writeFile(join(dir, "gh"), STUB, "utf8");
  await chmod(join(dir, "gh"), 0o755);
  try {
    return spawnSync("bash", [script, head, "owner/repo", "0"], {
      env: { ...process.env, PATH: dir + ":" + process.env.PATH, GH_STUB_PAYLOAD: join(dir, "runs.json") },
      encoding: "utf8",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Every required context defaults to green; each test only states the
// verdicts it varies. Extra contexts prove the rollup ignores them.
async function runRollup(verdicts) {
  const dir = await mkdtemp(join(tmpdir(), "ready-rollup-"));
  let id = 1;
  const payload = [];
  for (const ctx of REQUIRED) {
    const v = Object.hasOwn(verdicts, ctx) ? verdicts[ctx] : "success";
    payload.push(makeRun(id++, ctx, v));
  }
  for (const ctx of Object.keys(verdicts)) {
    if (!REQUIRED.includes(ctx)) payload.push(makeRun(id++, ctx, verdicts[ctx]));
  }
  return spawnStub(dir, payload);
}

// Explicit per-context run lists; unmentioned contexts default to one green
// run so ordering tests only state what they vary. The script under test
// owns name matching and newest-run selection in jq.
async function runRollupRuns(runsByContext) {
  const dir = await mkdtemp(join(tmpdir(), "ready-rollup-runs-"));
  let id = 500;
  const payload = [];
  for (const ctx of REQUIRED) {
    if (Object.hasOwn(runsByContext, ctx)) {
      for (const r of runsByContext[ctx]) payload.push({ name: ctx, ...r });
    } else {
      payload.push({ id: id++, head_sha: head, name: ctx, status: "completed", conclusion: "success" });
    }
  }
  return spawnStub(dir, payload);
}

const run = (id, fields) => ({ id, head_sha: head, ...fields });

test("ready passes when every required context is green", async () => {
  const result = await runRollup({});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ready: all listed workflow contexts green/);
});

test("ready ignores contexts outside the required set", async () => {
  const result = await runRollup({ CodeRabbit: "pending" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ready: all listed workflow contexts green/);
});

test("ready still fails when a workflow context fails", async () => {
  const result = await runRollup({ ci: "failure" });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /FAILED contexts:.*ci/);
});

test("every required context blocks ready on failure", async () => {
  for (const ctx of REQUIRED.filter((c) => c !== "ready")) {
    const result = await runRollup({ [ctx]: "failure" });
    assert.equal(result.status, 1, ctx + ": " + result.stdout);
    assert.ok(result.stderr.includes("FAILED contexts: " + ctx), ctx);
  }
});

test("a skipped context fails instead of waiting", async () => {
  const result = await runRollup({ zizmor: "skipped" });
  assert.equal(result.status, 1, result.stdout);
  assert.ok(result.stderr.includes("FAILED contexts: zizmor"));
});

test("a neutral context fails instead of waiting", async () => {
  const result = await runRollup({ actionlint: "neutral" });
  assert.equal(result.status, 1, result.stdout);
  assert.ok(result.stderr.includes("FAILED contexts: actionlint"));
});

test("a skipped reviewer fails instead of waiting", async () => {
  const result = await runRollup({ [REVIEWER]: "skipped" });
  assert.equal(result.status, 1, result.stdout);
  assert.ok(result.stderr.includes("FAILED contexts: " + REVIEWER));
});

test("a pending reviewer blocks ready", async () => {
  const result = await runRollup({ [REVIEWER]: "pending" });
  assert.equal(result.status, 1, result.stdout);
  assert.ok(result.stderr.includes("PENDING contexts at timeout: " + REVIEWER));
});

test("ready ignores its own in-progress run", async () => {
  const result = await runRollupRuns({
    ready: [
      run(11, { status: "in_progress", conclusion: null, completed_at: null }),
    ],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ready: all listed workflow contexts green/);
});

test("a completed ready failure still blocks", async () => {
  const result = await runRollupRuns({
    ready: [
      run(11, { status: "completed", conclusion: "failure", completed_at: "2026-10-22T10:00:00Z" }),
    ],
  });
  assert.equal(result.status, 1, result.stdout);
  assert.ok(result.stderr.includes("FAILED contexts: ready"));
});

test("a newer in-progress rerun outranks an older success", async () => {
  const result = await runRollupRuns({
    ci: [
      run(11, { status: "completed", conclusion: "success", completed_at: "2026-10-22T10:00:00Z" }),
      run(12, { status: "in_progress", conclusion: null, completed_at: null }),
    ],
  });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /PENDING contexts at timeout: ci/);
  assert.doesNotMatch(result.stdout, /ready: all listed workflow contexts green/);
});

test("a newer completed run outranks an older in-progress one", async () => {
  const result = await runRollupRuns({
    ci: [
      run(11, { status: "in_progress", conclusion: null, completed_at: null }),
      run(12, { status: "completed", conclusion: "success", completed_at: "2026-10-22T10:05:00Z" }),
    ],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ready: all listed workflow contexts green/);
});

test("a newer failure outranks an older success", async () => {
  const result = await runRollupRuns({
    ci: [
      run(11, { status: "completed", conclusion: "success", completed_at: "2026-10-22T10:00:00Z" }),
      run(12, { status: "completed", conclusion: "failure", completed_at: "2026-10-22T10:05:00Z" }),
    ],
  });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /FAILED contexts: ci/);
});

test("runs for another head sha are ignored", async () => {
  const result = await runRollupRuns({
    ci: [
      run(11, { status: "completed", conclusion: "success", completed_at: "2026-10-22T10:00:00Z" }),
      { id: 12, head_sha: "b".repeat(40), status: "in_progress", conclusion: null, completed_at: null },
    ],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ready: all listed workflow contexts green/);
});
