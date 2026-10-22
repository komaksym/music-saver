#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const FIELDS = [
  "name",
  "value",
  "domain",
  "path",
  "httpOnly",
  "secure",
  "session",
  "expires",
];

function cookiesFrom(snapshot) {
  if (Array.isArray(snapshot)) return snapshot;
  if (Array.isArray(snapshot?.data?.cookies)) return snapshot.data.cookies;
  if (Array.isArray(snapshot?.cookies)) return snapshot.cookies;
  throw new TypeError("cookie snapshot has no cookies array");
}

function spotifyDomain(domain) {
  if (typeof domain !== "string") return false;
  const host = domain.replace(/^\./, "").toLowerCase();
  return host === "spotify.com" || host.endsWith(".spotify.com");
}

function cookieKey(cookie) {
  return [
    cookie.name,
    String(cookie.domain).toLowerCase(),
    cookie.path || "/",
  ].join("\0");
}

function keepFields(cookie) {
  return Object.fromEntries(FIELDS.map((field) => [field, cookie[field]]));
}

export function mergeSpotifyCookieSnapshots(openSnapshot, accountsSnapshot) {
  const merged = new Map();
  for (const cookie of [...cookiesFrom(openSnapshot), ...cookiesFrom(accountsSnapshot)]) {
    if (!spotifyDomain(cookie.domain)) continue;
    const clean = keepFields(cookie);
    merged.set(cookieKey(clean), clean);
  }
  return [...merged.values()];
}

export function cookieSetArgs(cookie) {
  const args = ["cookies", "set", cookie.name, cookie.value];
  if (cookie.name.startsWith("__Host-")) {
    args.push("--url", "https://accounts.spotify.com/");
  } else {
    args.push("--domain", cookie.domain);
  }
  args.push("--path", cookie.path || "/");
  if (cookie.httpOnly) args.push("--httpOnly");
  if (cookie.secure) args.push("--secure");
  args.push("--sameSite", cookie.secure ? "None" : "Lax");
  if (!cookie.session && cookie.expires > 0) {
    args.push("--expires", String(Math.floor(cookie.expires)));
  }
  return args;
}

function merge([openPath, accountsPath, outPath]) {
  if (!openPath || !accountsPath || !outPath) {
    throw new Error("usage: e2e-cookies.mjs merge <open-snapshot> <accounts-snapshot> <output>");
  }
  const merged = mergeSpotifyCookieSnapshots(
    JSON.parse(readFileSync(openPath, "utf8")),
    JSON.parse(readFileSync(accountsPath, "utf8")),
  );
  writeFileSync(outPath, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
  chmodSync(outPath, 0o600);
}

function restore([cookiesPath]) {
  if (!cookiesPath || !process.env.SESSION || !process.env.PROFILE) {
    throw new Error("restore needs a cookie file, SESSION, and PROFILE");
  }
  const run = (args) => execFileSync("agent-browser", [
    "--session",
    process.env.SESSION,
    "--profile",
    process.env.PROFILE,
    ...args,
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  run(["open", "https://open.spotify.com/"]);
  const cookies = JSON.parse(readFileSync(cookiesPath, "utf8"));
  for (const cookie of cookies) run(cookieSetArgs(cookie));
  console.log(`cookies restored: ${cookies.length}`);
}

function main([command, ...args]) {
  if (command === "merge") return merge(args);
  if (command === "restore") return restore(args);
  throw new Error("usage: e2e-cookies.mjs <merge|restore> ...");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
