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
