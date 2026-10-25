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
  "sameSite",
  "hostOnly",
];

const SAME_SITE_VALUES = ["Strict", "Lax", "None"];

// Messages from this class are safe to print. Operator input and cookie
// values never pass through. Everything else prints as a name only.
class CliError extends Error {}

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
  return Object.fromEntries(
    FIELDS
      .filter((field) => cookie[field] !== undefined)
      .map((field) => [field, cookie[field]]),
  );
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

function cookieLabel(cookie) {
  return cookie.name ?? "unknown";
}

function cookieDomain(cookie) {
  if (typeof cookie.domain !== "string" || cookie.domain.length === 0) {
    throw new CliError(`cookie ${cookieLabel(cookie)} has no domain`);
  }
  return cookie.domain;
}

function isHostOnly(cookie) {
  if (typeof cookie.name === "string" && cookie.name.startsWith("__Host-")) return true;
  if (cookie.hostOnly === true) return true;
  return !cookieDomain(cookie).startsWith(".");
}

// CDP accepts either url or domain+path. A host-only cookie must use url, so
// its path goes in the URL; --domain would widen it to subdomains.
function hostOnlyUrl(cookie) {
  const host = cookieDomain(cookie).replace(/^\./, "");
  if (!host) throw new CliError(`cookie ${cookieLabel(cookie)} has no host`);
  const path = typeof cookie.path === "string" && cookie.path.startsWith("/")
    ? cookie.path
    : "/";
  return `${cookie.secure ? "https" : "http"}://${host}${path}`;
}

function sameSitePolicy(cookie) {
  if (cookie.sameSite === undefined || cookie.sameSite === null || cookie.sameSite === "") {
    return cookie.secure ? "None" : "Lax";
  }
  const requested = String(cookie.sameSite);
  const policy = SAME_SITE_VALUES.find(
    (value) => value.toLowerCase() === requested.toLowerCase(),
  );
  if (!policy) {
    throw new CliError(`cookie ${cookieLabel(cookie)} has an unsupported SameSite policy`);
  }
  if (policy === "None" && !cookie.secure) {
    throw new CliError(`cookie ${cookieLabel(cookie)} has SameSite=None without Secure`);
  }
  return policy;
}

export function cookieSetArgs(cookie) {
  const args = ["cookies", "set", cookie.name, cookie.value];
  const sameSite = sameSitePolicy(cookie);
  if (isHostOnly(cookie)) {
    args.push("--url", hostOnlyUrl(cookie));
  } else {
    args.push("--domain", cookieDomain(cookie), "--path", cookie.path || "/");
  }
  if (cookie.httpOnly) args.push("--httpOnly");
  if (cookie.secure) args.push("--secure");
  args.push("--sameSite", sameSite);
  if (!cookie.session && cookie.expires > 0) {
    args.push("--expires", String(Math.floor(cookie.expires)));
  }
  return args;
}

function merge([openPath, accountsPath, outPath]) {
  if (!openPath || !accountsPath || !outPath) {
    throw new CliError("usage: e2e-cookies.mjs merge <open-snapshot> <accounts-snapshot> <output>");
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
    throw new CliError("restore needs a cookie file, SESSION, and PROFILE");
  }
  const run = (args) => execFileSync("agent-browser", [
    "--session",
    process.env.SESSION,
    "--profile",
    process.env.PROFILE,
    ...args,
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  const cookies = JSON.parse(readFileSync(cookiesPath, "utf8"));
  const commands = cookies.map((cookie) => ({ cookie, args: cookieSetArgs(cookie) }));
  run(["open", "https://open.spotify.com/"]);
  for (const { cookie, args } of commands) {
    try {
      run(args);
    } catch (error) {
      throw new CliError(`failed to restore cookie ${cookie.name ?? "unknown"} (${error.name})`);
    }
  }
  console.log(`cookies restored: ${cookies.length}`);
}

function main([command, ...args]) {
  if (command === "merge") return merge(args);
  if (command === "restore") return restore(args);
  throw new CliError("usage: e2e-cookies.mjs <merge|restore> ...");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliError) {
      console.error(error.message);
    } else {
      console.error(`E2E cookie operation failed (${error?.name ?? "Error"}); details omitted to protect cookie values`);
    }
    process.exitCode = 1;
  }
}
