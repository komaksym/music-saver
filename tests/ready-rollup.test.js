import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const script = resolve("scripts/check-ready-rollup.sh");
const head = "a".repeat(40);

const REVIEWER = "cubic · AI code reviewer";

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

async function runRollup(verdicts) {
  const dir = await mkdtemp(join(tmpdir(), "ready-rollup-"));
  const gh = join(dir, "gh");
  const arms = Object.entries(verdicts)
    .map(([ctx, verdict], i) => `    ${i === 0 ? "if" : "elif"} [ "$ctx" = "${ctx}" ]; then echo ${verdict};`)
    .join("\n");
  await writeFile(
    gh,
    `#!/usr/bin/env bash
url="$2"
case "$url" in
  */status) echo pending; exit 0 ;;
esac
ctx=""
for a in "$@"; do
  case "$a" in
    *check_name=*) ctx="\${a##*check_name=}"; ctx="\${ctx%%&*}" ;;
  esac
done
ctx=\$(printf '%b' "\${ctx//%/\\x}")
if [ -z "$ctx" ]; then echo success; exit 0; fi
${arms || "if true; then echo success;"}
else echo success; fi
`,
    "utf8",
  );
  await chmod(gh, 0o755);
  try {
    return spawnSync("bash", [script, head, "owner/repo", "0"], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
      encoding: "utf8",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

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
    assert.equal(result.status, 1, `${ctx}: ${result.stdout}`);
    assert.ok(result.stderr.includes(`FAILED contexts: ${ctx}`), ctx);
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

test("a pending reviewer blocks ready", async () => {
  const result = await runRollup({ [REVIEWER]: "pending" });
  assert.equal(result.status, 1, result.stdout);
  assert.ok(result.stderr.includes(`PENDING contexts at timeout: ${REVIEWER}`));
});

const jqSkip = spawnSync("jq", ["--version"]).status === 0 ? false : "jq not installed";

// Serves raw check-run payloads and lets the hotspot script own --jq query pick the
// newest run, so ordering bugs surface instead of being flattened by the stub.
async function runRollupRuns(runsByContext) {
  const dir = await mkdtemp(join(tmpdir(), "ready-rollup-runs-"));
  const gh = join(dir, "gh");
  const arms = [];
  let n = 0;
  for (const [ctx, runs] of Object.entries(runsByContext)) {
    const file = join(dir, `${n}.json`);
    n += 1;
    await writeFile(file, JSON.stringify({ check_runs: runs }), "utf8");
    arms.push(`${arms.length === 0 ? "if" : "elif"} [ "$ctx" = "${ctx}" ]; then file="${file}";`);
  }
  await writeFile(
    gh,
    `#!/usr/bin/env bash
url="$2"
case "$url" in
  */status) echo success; exit 0 ;;
esac
prev=""
filter=""
ctx=""
for a in "$@"; do
  case "$a" in
    *check_name=*) ctx="\${a##*check_name=}"; ctx="\${ctx%%&*}" ;;
  esac
  if [ "$prev" = "--jq" ]; then filter="$a"; fi
  prev="$a"
done
ctx=\$(printf '%b' "\${ctx//%/\\x}")
if [ -z "$ctx" ]; then echo success; exit 0; fi
file=""
${arms.join("\n")}
else echo success; exit 0; fi
if [ -n "$filter" ]; then jq -r "$filter" "$file"; else cat "$file"; fi
`,
    "utf8",
  );
  await chmod(gh, 0o755);
  try {
    return spawnSync("bash", [script, head, "owner/repo", "0"], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GH_HEAD: head },
      encoding: "utf8",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const run = (id, fields) => ({ id, head_sha: head, ...fields });

test("ready ignores its own in-progress run", { skip: jqSkip }, async () => {
  const result = await runRollupRuns({
    ready: [
      run(11, { status: "in_progress", conclusion: null, completed_at: null }),
    ],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ready: all listed workflow contexts green/);
});

test("a completed ready failure still blocks", { skip: jqSkip }, async () => {
  const result = await runRollupRuns({
    ready: [
      run(11, { status: "completed", conclusion: "failure", completed_at: "2026-10-22T10:00:00Z" }),
    ],
  });
  assert.equal(result.status, 1, result.stdout);
  assert.ok(result.stderr.includes("FAILED contexts: ready"));
});

test("a newer in-progress rerun outranks an older success", { skip: jqSkip }, async () => {
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

test("a newer completed run outranks an older in-progress one", { skip: jqSkip }, async () => {
  const result = await runRollupRuns({
    ci: [
      run(11, { status: "in_progress", conclusion: null, completed_at: null }),
      run(12, { status: "completed", conclusion: "success", completed_at: "2026-10-22T10:05:00Z" }),
    ],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ready: all listed workflow contexts green/);
});

test("a newer failure outranks an older success", { skip: jqSkip }, async () => {
  const result = await runRollupRuns({
    ci: [
      run(11, { status: "completed", conclusion: "success", completed_at: "2026-10-22T10:00:00Z" }),
      run(12, { status: "completed", conclusion: "failure", completed_at: "2026-10-22T10:05:00Z" }),
    ],
  });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /FAILED contexts: ci/);
});

test("runs for another head sha are ignored", { skip: jqSkip }, async () => {
  const result = await runRollupRuns({
    ci: [
      run(11, { status: "completed", conclusion: "success", completed_at: "2026-10-22T10:00:00Z" }),
      { id: 12, head_sha: "b".repeat(40), status: "in_progress", conclusion: null, completed_at: null },
    ],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ready: all listed workflow contexts green/);
});
