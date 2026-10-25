import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cookieSetArgs,
  mergeSpotifyCookieSnapshots,
} from "../scripts/e2e-cookies.mjs";

function cookie(name, domain, value, overrides = {}) {
  return {
    name,
    value,
    domain,
    path: "/",
    httpOnly: true,
    secure: true,
    session: false,
    expires: 1_900_000_000,
    ...overrides,
  };
}

test("merges the open and accounts snapshots with accounts taking precedence", () => {
  const open = { data: { cookies: [
    cookie("sp_dc", ".spotify.com", "stale"),
    cookie("sp_key", ".spotify.com", "key"),
  ] } };
  const accounts = { data: { cookies: [
    cookie("sp_dc", ".spotify.com", "fresh"),
    cookie("__Host-sp_csrf_sid", "accounts.spotify.com", "csrf"),
  ] } };

  assert.deepEqual(mergeSpotifyCookieSnapshots(open, accounts), [
    cookie("sp_dc", ".spotify.com", "fresh"),
    cookie("sp_key", ".spotify.com", "key"),
    cookie("__Host-sp_csrf_sid", "accounts.spotify.com", "csrf"),
  ]);
});

test("preserves host-only scope and SameSite through merge", () => {
  const hostOnly = cookie("sp_t", "open.spotify.com", "host-token", {
    hostOnly: true,
    sameSite: "Lax",
  });
  const domainScoped = cookie("sp_dc", ".spotify.com", "domain-token", {
    hostOnly: false,
    sameSite: "Strict",
  });

  assert.deepEqual(mergeSpotifyCookieSnapshots({ data: { cookies: [hostOnly, domainScoped] } }, []), [
    hostOnly,
    domainScoped,
  ]);
});

test("preserves explicit SameSite values through merge and import", () => {
  for (const sameSite of ["Strict", "Lax", "None"]) {
    const source = cookie("sp_dc", ".spotify.com", "token", { sameSite });
    const [merged] = mergeSpotifyCookieSnapshots({ data: { cookies: [source] } }, []);

    assert.equal(merged.sameSite, sameSite);
    const args = cookieSetArgs(merged);
    assert.equal(args[args.indexOf("--sameSite") + 1], sameSite);
  }
});

test("derives SameSite only when the snapshot omits it", () => {
  const secureArgs = cookieSetArgs(cookie("sp_dc", ".spotify.com", "token"));
  assert.equal(secureArgs[secureArgs.indexOf("--sameSite") + 1], "None");

  const laxArgs = cookieSetArgs(cookie("sp_lax", "open.spotify.com", "token", { secure: false }));
  assert.equal(laxArgs[laxArgs.indexOf("--sameSite") + 1], "Lax");
});

test("SameSite=None without Secure fails closed and names only the cookie", () => {
  const sentinel = "SENTINEL-COOKIE-VALUE";
  const unsafe = cookie("sp_dc", ".spotify.com", sentinel, { sameSite: "None", secure: false });

  assert.throws(() => cookieSetArgs(unsafe), (error) => {
    assert.match(error.message, /sp_dc/);
    assert.equal(error.message.includes(sentinel), false);
    return true;
  });
});

test("drops cookies outside Spotify domains and lookalikes", () => {
  const open = { data: { cookies: [
    cookie("sp_t", ".spotify.com", "spotify"),
    cookie("ga", ".google.com", "google"),
    cookie("lookalike", ".notspotify.com", "bad"),
    cookie("suffix", ".spotify.com.evil", "bad"),
  ] } };

  assert.deepEqual(mergeSpotifyCookieSnapshots(open, []), [
    cookie("sp_t", ".spotify.com", "spotify"),
  ]);
});

test("merge CLI writes the sanitized cookie file", () => {
  const dir = mkdtempSync(join(tmpdir(), "music-saver-cookies-"));
  const openPath = join(dir, "open.json");
  const accountsPath = join(dir, "accounts.json");
  const outPath = join(dir, "cookies.json");
  writeFileSync(openPath, JSON.stringify({ data: { cookies: [
    cookie("sp_dc", ".spotify.com", "token"),
    cookie("tracking", ".example.com", "drop"),
  ] } }));
  writeFileSync(accountsPath, JSON.stringify({ data: { cookies: [
    cookie("__Host-sp_csrf_sid", "accounts.spotify.com", "csrf"),
  ] } }));

  const result = spawnSync(process.execPath, [
    "scripts/e2e-cookies.mjs",
    "merge",
    openPath,
    accountsPath,
    outPath,
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.deepEqual(JSON.parse(readFileSync(outPath, "utf8")), [
    cookie("sp_dc", ".spotify.com", "token"),
    cookie("__Host-sp_csrf_sid", "accounts.spotify.com", "csrf"),
  ]);
});

test("host cookies use the accounts URL and other cookies use their domain", () => {
  const hostArgs = cookieSetArgs(cookie("__Host-device_id", "accounts.spotify.com", "id"));
  assert.deepEqual(hostArgs.slice(0, 5), [
    "cookies",
    "set",
    "__Host-device_id",
    "id",
    "--url",
  ]);
  assert.equal(hostArgs[5], "https://accounts.spotify.com/");
  assert.equal(hostArgs.includes("--domain"), false);

  const domainArgs = cookieSetArgs(cookie("sp_dc", ".spotify.com", "token"));
  assert.equal(domainArgs.includes("--url"), false);
  assert.equal(domainArgs[domainArgs.indexOf("--domain") + 1], ".spotify.com");
});

test("domain cookies keep their leading dot and path on import", () => {
  const args = cookieSetArgs(cookie("sp_dc", ".spotify.com", "token", {
    sameSite: "Lax",
    path: "/api",
  }));

  assert.equal(args.includes("--url"), false);
  assert.equal(args[args.indexOf("--domain") + 1], ".spotify.com");
  assert.equal(args[args.indexOf("--path") + 1], "/api");
});

test("host-only cookies use a URL and keep their path", () => {
  const args = cookieSetArgs(cookie("sp_t", "open.spotify.com", "token", {
    hostOnly: true,
    sameSite: "Lax",
    path: "/api",
  }));

  assert.equal(args.includes("--domain"), false);
  assert.equal(args.includes("--path"), false);
  assert.equal(args[args.indexOf("--url") + 1], "https://open.spotify.com/api");
});

test("restore failure names the cookie without printing its value", () => {
  const dir = mkdtempSync(join(tmpdir(), "music-saver-restore-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "agent-browser"), `#!/bin/sh
case "$*" in
  *" open "*) exit 0 ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 });
  const cookiesPath = join(dir, "cookies.json");
  const sentinel = "SENTINEL-COOKIE-VALUE";
  writeFileSync(cookiesPath, JSON.stringify([
    cookie("sp_dc", ".spotify.com", sentinel),
  ]));

  const result = spawnSync(process.execPath, [
    "scripts/e2e-cookies.mjs",
    "restore",
    cookiesPath,
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      SESSION: "test-session",
      PROFILE: dir,
    },
  });

  assert.equal(result.status, 1, result.stderr + result.stdout);
  assert.match(result.stderr, /failed to restore cookie sp_dc \(Error\)/);
  assert.equal(result.stderr.includes(sentinel), false);
  assert.equal(result.stderr.includes("--domain"), false);
});

test("restore rejects SameSite=None without Secure without printing the value", () => {
  const dir = mkdtempSync(join(tmpdir(), "music-saver-restore-unsafe-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "agent-browser"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const cookiesPath = join(dir, "cookies.json");
  const sentinel = "SENTINEL-COOKIE-VALUE";
  writeFileSync(cookiesPath, JSON.stringify([
    cookie("sp_dc", ".spotify.com", sentinel, { sameSite: "None", secure: false }),
  ]));

  const result = spawnSync(process.execPath, [
    "scripts/e2e-cookies.mjs",
    "restore",
    cookiesPath,
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      SESSION: "test-session",
      PROFILE: dir,
    },
  });

  assert.equal(result.status, 1, result.stderr + result.stdout);
  assert.match(result.stderr, /cookie sp_dc has SameSite=None without Secure/);
  assert.equal(result.stderr.includes(sentinel), false);
});
