import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Same PATH-injected `gh` stub idea as the rollup tests: a fake `gh` earlier
// on PATH answers the script's GraphQL call with a canned reviewThreads
// payload, so every verdict resolves with TIMEOUT 0 and no network.
const SCRIPT = fileURLToPath(
  new URL("../scripts/check-cubic-gate.sh", import.meta.url),
);

const thread = ({
  id = "TR_1",
  resolved = false,
  outdated = false,
  file = "pr-ready.yml",
  line = 19,
  author = "cubic-dev-ai[bot]",
  body = "P1 wrong SHA passed to rollup",
  createdAt = "2026-10-22T15:00:00Z",
} = {}) => ({
  id,
  isResolved: resolved,
  isOutdated: outdated,
  path: file,
  line,
  comments: { nodes: [{ author: { login: author }, body, createdAt }] },
});

const runGate = ({ threads = [], reviews = [], env = {} } = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cubic-gate-"));
  try {
    const fixtureFile = path.join(dir, "fixture.json");
    fs.writeFileSync(
      fixtureFile,
      JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: threads,
              },
              reviews: { nodes: reviews },
            },
          },
        },
      }),
    );
    const ghStub = path.join(dir, "gh");
    fs.writeFileSync(ghStub, `#!/bin/sh\ncat "${fixtureFile}"\n`);
    fs.chmodSync(ghStub, 0o755);
    return spawnSync(
      "bash",
      [SCRIPT, "c1d6342", "8", "komaksym/music-saver", "0"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          BLOCK_PRIORITIES: "P0 P1",
          RUN_STARTED_AT: "",
          ...env,
        },
      },
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test("open P1 thread blocks and the log names id, priority, and path", () => {
  const r = runGate({
    threads: [
      thread({
        id: "TR_P1_BLOCK",
        body: "P1 wrong SHA passed to rollup",
        file: "pr-ready.yml",
      }),
    ],
  });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /TR_P1_BLOCK/);
  assert.match(r.stdout, /P1/);
  assert.match(r.stdout, /pr-ready\.yml/);
});

test("P2/P3-only threads pass", () => {
  const r = runGate({
    threads: [
      thread({ id: "TR_P2", body: "P2 nit on wording" }),
      thread({ id: "TR_P3", body: "P3 low-risk polish" }),
    ],
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /CLEAR/);
});

test("resolved P1 thread passes", () => {
  const r = runGate({
    threads: [thread({ id: "TR_RESOLVED", resolved: true })],
  });
  assert.equal(r.status, 0);
});

test("outdated P1 thread passes", () => {
  const r = runGate({
    threads: [thread({ id: "TR_OUTDATED", outdated: true })],
  });
  assert.equal(r.status, 0);
});

test("unprioritized Cubic thread blocks", () => {
  const r = runGate({
    threads: [
      thread({
        id: "TR_UNTAGGED",
        body: "please reconsider this hunk, no priority tag",
      }),
    ],
  });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /TR_UNTAGGED/);
});

test("silent Cubic with TIMEOUT 0 fails closed", () => {
  const r = runGate({ threads: [], reviews: [] });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /no cubic signal/);
});

test("impersonator author is not a Cubic signal and does not block", () => {
  const r = runGate({
    threads: [
      thread({
        id: "TR_IMPOSTOR",
        author: "not-cubic-dev-ai",
        body: "P1 fake blocker",
      }),
    ],
    reviews: [
      {
        author: { login: "not-cubic-dev-ai" },
        state: "COMMENTED",
        submittedAt: "2026-10-22T17:00:00Z",
      },
    ],
  });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /no cubic signal/);
  assert.doesNotMatch(r.stdout, /TR_IMPOSTOR/);
});

test("bare cubic-dev-ai login (GraphQL form) still blocks", () => {
  const r = runGate({
    threads: [thread({ id: "TR_BARE_LOGIN", author: "cubic-dev-ai" })],
  });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /TR_BARE_LOGIN/);
});

test("stale unresolved P1 still blocks despite the freshness cutoff", () => {
  const r = runGate({
    threads: [
      thread({ id: "TR_STALE_P1", createdAt: "2026-10-22T15:00:00Z" }),
    ],
    env: { RUN_STARTED_AT: "2026-10-22T16:00:00Z" },
  });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /TR_STALE_P1/);
});

test("stale P1 plus a fresh P2-only review still BLOCKS", () => {
  const r = runGate({
    threads: [
      thread({ id: "TR_STALE_P1", createdAt: "2026-10-22T15:00:00Z" }),
    ],
    reviews: [
      {
        author: { login: "cubic-dev-ai[bot]" },
        state: "COMMENTED",
        submittedAt: "2026-10-22T17:00:00Z",
      },
    ],
    env: { RUN_STARTED_AT: "2026-10-22T16:00:00Z" },
  });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /TR_STALE_P1/);
});

test("stale pre-event threads alone cannot CLEAR without a fresh signal", () => {
  const r = runGate({
    threads: [
      thread({
        id: "TR_STALE_P2",
        body: "P2 nit on wording",
        createdAt: "2026-10-22T15:00:00Z",
      }),
    ],
    env: { RUN_STARTED_AT: "2026-10-22T16:00:00Z" },
  });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /no cubic signal/);
});

test("fresh Cubic review after the cutoff yields CLEAR", () => {
  const r = runGate({
    reviews: [
      {
        author: { login: "cubic-dev-ai[bot]" },
        state: "COMMENTED",
        submittedAt: "2026-10-22T17:00:00Z",
      },
    ],
    env: { RUN_STARTED_AT: "2026-10-22T16:00:00Z" },
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /CLEAR/);
});
