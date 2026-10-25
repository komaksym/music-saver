import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));

test("extension asks only for storage, so a new permission requires a deliberate change", () => {
  assert.deepEqual(manifest.permissions, ["storage"]);
});

test("extension reaches only the Spotify host", () => {
  assert.deepEqual(manifest.host_permissions, ["https://open.spotify.com/*"]);
});

test("extension injects only the built content script", () => {
  assert.deepEqual(manifest.content_scripts[0].js, ["content.bundle.js"]);
});
