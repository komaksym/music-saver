import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
test("browser stack guard passes on agent-browser-only tree", () => {
  const r = spawnSync("bash", ["scripts/check-browser-stack.sh"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /agent-browser only/);
});

test("matrix skips locally without a profile", () => {
  const r = spawnSync("bash", ["scripts/e2e-matrix.sh"], {
    encoding: "utf8",
    env: { ...process.env, SPOTIFY_E2E_PROFILE: "/definitely/missing/profile" },
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /SKIP: no login profile/);
});

test("matrix fails closed when CI requires auth", () => {
  const r = spawnSync("bash", ["scripts/e2e-matrix.sh"], {
    encoding: "utf8",
    env: {
      ...process.env,
      E2E_REQUIRE_AUTH: "1",
      SPOTIFY_E2E_PROFILE: "/definitely/missing/profile",
    },
  });
  assert.equal(r.status, 3, r.stderr + r.stdout);
  assert.match(r.stderr, /auth required but no login profile/);
});
