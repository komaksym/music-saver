import test from "node:test";
import assert from "node:assert/strict";
import { mergeSpotifyCookieSnapshots } from "../scripts/e2e-cookies.mjs";
import { importCookies } from "../scripts/spotify-e2e-cookies.mjs";

function cookie(name, value, domain, overrides = {}) {
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

test("imports cookies with individual supported cookies set commands", () => {
  const calls = [];

  importCookies([
    cookie("sp_dc", "session-token", ".spotify.com"),
    cookie("__Host-device_id", "device-id", "accounts.spotify.com"),
  ], (...args) => calls.push(args));

  assert.deepEqual(calls, [
    [
      "cookies", "set", "sp_dc", "session-token",
      "--domain", ".spotify.com", "--path", "/",
      "--httpOnly", "--secure", "--sameSite", "None", "--expires", "1900000000",
    ],
    [
      "cookies", "set", "__Host-device_id", "device-id",
      "--url", "https://accounts.spotify.com/",
      "--httpOnly", "--secure", "--sameSite", "None", "--expires", "1900000000",
    ],
  ]);
});

test("host-only cookies round-trip without widening their domain", () => {
  const calls = [];
  const source = cookie("sp_t", "host-token", "open.spotify.com", {
    hostOnly: true,
    sameSite: "Lax",
  });
  const [merged] = mergeSpotifyCookieSnapshots({ data: { cookies: [source] } }, []);

  assert.equal(merged.hostOnly, true);
  importCookies([merged], (...args) => calls.push(args));

  assert.equal(calls.length, 1);
  const args = calls[0];
  assert.equal(args.includes("--domain"), false);
  assert.equal(args.includes("--path"), false);
  assert.equal(args[args.indexOf("--url") + 1], "https://open.spotify.com/");
  assert.equal(args[args.indexOf("--sameSite") + 1], "Lax");
});

test("preserves SameSite values through the importer", () => {
  for (const sameSite of ["Strict", "Lax", "None"]) {
    const calls = [];
    importCookies([cookie("sp_dc", "token", ".spotify.com", { sameSite })], (...args) => calls.push(args));

    assert.equal(calls[0][calls[0].indexOf("--sameSite") + 1], sameSite);
  }
});

test("SameSite=None without Secure fails closed before running the browser", () => {
  const sentinel = "SENTINEL-COOKIE-VALUE";
  let calls = 0;

  assert.throws(
    () => importCookies([
      cookie("sp_t", "safe-token", "open.spotify.com"),
      cookie("sp_dc", sentinel, ".spotify.com", { sameSite: "None", secure: false }),
    ], () => { calls += 1; }),
    (error) => {
      assert.match(error.message, /sp_dc/);
      assert.equal(error.message.includes(sentinel), false);
      return true;
    },
  );
  assert.equal(calls, 0);
});
