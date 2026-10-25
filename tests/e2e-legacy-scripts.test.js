import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const entry = join(repo, "scripts/e2e-agent-browser.sh");
const harness = join(repo, "scripts/e2e-harness.sh");
const matrixLib = join(repo, "scripts/e2e-matrix-lib.mjs");
const matrix = join(repo, "scripts/e2e-matrix.json");

function quote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function makeAgentBrowser(dir, sessionId = "test-session") {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const log = join(dir, "calls.log");
  writeFileSync(
    join(bin, "agent-browser"),
    `#!/bin/sh
{
  printf '%s' "$#"
  for arg in "$@"; do printf '\\t%s' "$arg"; done
  printf '\\n'
} >> ${quote(log)}
if [ "$1" = "session" ] && [ "$2" = "id" ]; then
  printf '%s\\n' ${quote(sessionId)}
fi
exit 0
`,
    { mode: 0o755 },
  );
  return { bin, log };
}

function readCalls(log) {
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [count, ...args] = line.split("\t");
      assert.equal(Number(count), args.length, `malformed shim log line: ${line}`);
      return args;
    });
}

function runEntry(args, env) {
  return spawnSync("/bin/bash", [entry, ...args], {
    encoding: "utf8",
    env: { ...process.env, E2E_SESSION: "", ...env },
  });
}

function runMatrix(...args) {
  return spawnSync(process.execPath, [matrixLib, ...args], {
    cwd: repo,
    encoding: "utf8",
  });
}

test("ab resolves one session, reuses it, and close_quiet closes it", () => {
  const dir = tempDir("music-saver-harness-");
  const { bin, log } = makeAgentBrowser(dir);
  const profile = join(dir, "profile");
  const driver = join(dir, "driver.sh");
  writeFileSync(
    driver,
    `set -euo pipefail
. ${quote(harness)}
ab open "https://example.com/one"
ab open "https://example.com/two"
close_quiet
printf 'session=%s\\n' "$SESSION"
`,
  );

  const result = spawnSync("/bin/bash", [driver], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      SPOTIFY_E2E_PROFILE: profile,
      E2E_ARTIFACTS: join(dir, "artifacts"),
      E2E_SESSION: "",
    },
  });

  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(result.stdout.trim(), "session=test-session");

  const calls = readCalls(log);
  assert.deepEqual(
    calls.filter((call) => call[0] === "session"),
    [["session", "id", "--scope", "worktree", "--prefix", "ms-e2e"]],
  );

  const browserCalls = calls.filter((call) => call[0] === "--session");
  assert.equal(browserCalls.length, 3);
  for (const call of browserCalls) {
    assert.deepEqual(call.slice(0, 4), ["--session", "test-session", "--profile", profile]);
  }
  assert.deepEqual(browserCalls[0].slice(4), ["open", "https://example.com/one"]);
  assert.deepEqual(browserCalls[1].slice(4), ["open", "https://example.com/two"]);
  assert.deepEqual(browserCalls[2].slice(4), ["close"]);
});

test("close_quiet does not start a session when nothing opened the browser", () => {
  const dir = tempDir("music-saver-harness-");
  const { bin, log } = makeAgentBrowser(dir);
  const driver = join(dir, "driver.sh");
  writeFileSync(
    driver,
    `set -euo pipefail
. ${quote(harness)}
close_quiet
printf 'session=%s\\n' "\${SESSION:-unset}"
`,
  );

  const result = spawnSync("/bin/bash", [driver], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      SPOTIFY_E2E_PROFILE: join(dir, "profile"),
      E2E_ARTIFACTS: join(dir, "artifacts"),
      E2E_SESSION: "",
    },
  });

  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(result.stdout.trim(), "session=unset");
  assert.deepEqual(readCalls(log), []);
});

test("player fails closed before session creation when the profile is missing", () => {
  const dir = tempDir("music-saver-missing-profile-");
  const { bin, log } = makeAgentBrowser(dir);
  const profile = join(dir, "absent-profile");

  const result = runEntry(["player"], {
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    SPOTIFY_E2E_PROFILE: profile,
    E2E_ARTIFACTS: join(dir, "artifacts"),
  });

  assert.equal(result.status, 3, result.stderr + result.stdout);
  assert.match(result.stderr, /no login profile at /);
  assert.ok(result.stderr.includes(profile));
  assert.match(result.stderr, /run auth once first/);
  assert.deepEqual(readCalls(log), []);
});

test("smoke fails closed before session creation when agent-browser is missing", () => {
  const dir = tempDir("music-saver-missing-browser-");
  const bin = join(dir, "bin");
  mkdirSync(bin);
  symlinkSync(execFileSync("sh", ["-c", "command -v dirname"], { encoding: "utf8" }).trim(), join(bin, "dirname"));

  const result = runEntry(["smoke"], {
    PATH: bin,
    SPOTIFY_E2E_PROFILE: join(dir, "profile"),
    E2E_ARTIFACTS: join(dir, "artifacts"),
  });

  assert.equal(result.status, 2, result.stderr + result.stdout);
  assert.match(result.stderr, /missing required command: agent-browser/);
  assert.equal(existsSync(join(dir, "calls.log")), false);
});

test("smoke waits for Example Domain and closes the session it opened", () => {
  const dir = tempDir("music-saver-smoke-");
  const { bin, log } = makeAgentBrowser(dir);
  const artifacts = join(dir, "artifacts");

  const result = runEntry(["smoke"], {
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    SPOTIFY_E2E_PROFILE: join(dir, "profile"),
    E2E_ARTIFACTS: artifacts,
  });

  assert.equal(result.status, 0, result.stderr + result.stdout);
  const calls = readCalls(log);
  const browserCalls = calls.filter((call) => call[0] === "--session");
  assert.deepEqual(
    browserCalls.map((call) => call.slice(4)),
    [
      ["open", "https://example.com"],
      ["wait", "--text", "Example Domain"],
      ["snapshot", "-i"],
      ["screenshot", join(artifacts, "smoke.png")],
      ["close"],
    ],
  );
  for (const call of browserCalls) {
    assert.deepEqual(call.slice(0, 4), ["--session", "test-session", "--profile", join(dir, "profile")]);
  }
  assert.equal(calls.some((call) => call.includes("documentation")), false);
});

test("matrix assert exits 1 when the verdict fails", () => {
  const result = runMatrix("assert", "unliked", "unliked", "save");

  assert.equal(result.status, 1, result.stderr + result.stdout);
  assert.equal(result.stderr, "");
  assert.deepEqual(result.stdout.trim().split("\n"), [
    "pass=false",
    "observed=none",
    "detail=expected save, observed none",
  ]);
});

test("matrix assert exits 1 when Like state is unreadable", () => {
  const result = runMatrix("assert", "unknown", "liked", "save");

  assert.equal(result.status, 1, result.stderr + result.stdout);
  assert.deepEqual(result.stdout.trim().split("\n"), [
    "pass=false",
    "observed=unknown",
    "detail=Like state unreadable; failing closed",
  ]);
});

test("matrix assert exits 0 when the verdict passes", () => {
  const result = runMatrix("assert", "unliked", "liked", "save");

  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(result.stderr, "");
  assert.deepEqual(result.stdout.trim().split("\n"), [
    "pass=true",
    "observed=save",
    "detail=observed delta matches expected delta",
  ]);
});

test("matrix validate keeps the contract npm run verify uses", () => {
  const result = runMatrix("validate", matrix);

  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(result.stdout.trim(), "matrix: 5 scenarios valid");
});

test("npm verify still validates the matrix", () => {
  const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
  assert.match(
    pkg.scripts.verify,
    /node scripts\/e2e-matrix-lib\.mjs validate scripts\/e2e-matrix\.json$/,
  );
});

test("retired cookies-restore exits 2 and stays out of the usage text", () => {
  const dir = tempDir("music-saver-retired-command-");
  const { bin, log } = makeAgentBrowser(dir);

  const result = runEntry(["cookies-restore"], {
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    SPOTIFY_E2E_PROFILE: join(dir, "profile"),
    E2E_ARTIFACTS: join(dir, "artifacts"),
  });

  assert.equal(result.status, 2, result.stderr + result.stdout);
  assert.match(result.stderr, /usage: auth, cookies-export, smoke, or player/);
  assert.doesNotMatch(result.stderr, /cookies-restore/);
  assert.deepEqual(readCalls(log), []);
});

test("unknown legacy commands exit 2 with the supported command list", () => {
  const dir = tempDir("music-saver-unknown-command-");
  const { bin } = makeAgentBrowser(dir);

  const result = runEntry(["nightly"], {
    PATH: `${bin}:${process.env.PATH ?? ""}`,
  });

  assert.equal(result.status, 2, result.stderr + result.stdout);
  assert.match(result.stderr, /usage: auth, cookies-export, smoke, or player/);
});
