import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const script = resolve("scripts/check-ready-rollup.sh");
const head = "a".repeat(40);

async function runRollup(verdicts) {
  const dir = await mkdtemp(join(tmpdir(), "ready-rollup-"));
  const gh = join(dir, "gh");
  const cases = Object.entries(verdicts)
    .map(([ctx, verdict]) => `  *check_name=${ctx}*) echo ${verdict} ;;`)
    .join("\n");
  await writeFile(
    gh,
    `#!/usr/bin/env bash
url="$2"
case "$url" in
${cases}
  *check_name=*) echo success ;;
  *status*) echo pending ;;
  *) echo success ;;
esac
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

test("ready passes while CodeRabbit is still pending", async () => {
  const result = await runRollup({ CodeRabbit: "pending" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ready: all listed workflow contexts green/);
});

test("ready still fails when a workflow context fails", async () => {
  const result = await runRollup({ ci: "failure", CodeRabbit: "success" });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /FAILED contexts: ci/);
});

const jqSkip = spawnSync("jq", ["--version"]).status === 0 ? false : "jq not installed";

// Serves raw check-run payloads and lets the script's own --jq query pick the
// newest run, so ordering bugs surface instead of being flattened by the stub.
async function runRollupRuns(runsByContext) {
  const dir = await mkdtemp(join(tmpdir(), "ready-rollup-runs-"));
  const gh = join(dir, "gh");
  const arms = [];
  for (const [ctx, runs] of Object.entries(runsByContext)) {
    const file = join(dir, `${ctx}.json`);
    await writeFile(file, JSON.stringify({ check_runs: runs }), "utf8");
    arms.push(`  *check_name=${ctx}\\&*) file='${file}' ;;`);
  }
  await writeFile(
    gh,
    `#!/usr/bin/env bash
url="$2"
filter=""
shift 2
while [ $# -gt 0 ]; do
  case "$1" in
    --jq) filter="$2"; shift 2 ;;
    *) shift ;;
  esac
done
case "$url" in
${arms.join("\n")}
  *) echo success; exit 0 ;;
esac
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
