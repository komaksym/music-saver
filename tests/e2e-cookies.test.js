import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cookieSetArgs,
  mergeSpotifyCookieSnapshots,
} from "../scripts/e2e-cookies.mjs";

function cookie(name, domain, value) {
  return {
    name,
    value,
    domain,
    path: "/",
    httpOnly: true,
    secure: true,
    session: false,
    expires: 1_900_000_000,
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
