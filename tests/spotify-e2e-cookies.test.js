import test from "node:test";
import assert from "node:assert/strict";
import { importCookies } from "../scripts/spotify-e2e-cookies.mjs";

function cookie(name, value, domain) {
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
      "--url", "https://accounts.spotify.com/", "--path", "/",
      "--httpOnly", "--secure", "--sameSite", "None", "--expires", "1900000000",
    ],
  ]);
});
