import test from "node:test";
import assert from "node:assert/strict";
import { assertSongIdentity } from "../scripts/spotify-e2e-identity.mjs";

const target = {
  trackId: "7LoBfKLpz4BGrxCuOzAKRz",
  title: "Dedicated test song",
  artist: "Dedicated test artist",
  albumHref: "/album/dedicated-album",
};

test("accepts the exact dedicated song", () => {
  assert.doesNotThrow(() => assertSongIdentity(target, { ...target }));
});

test("rejects a different track with the same title and artist", () => {
  assert.throws(
    () => assertSongIdentity(target, { ...target, trackId: "5ghIJDpPoe3CfHMGu71E6T" }),
    /now-playing track ID/,
  );
});

test("accepts a player without a track link when title, artist, and album match", () => {
  assert.doesNotThrow(() => assertSongIdentity(target, {
    title: target.title,
    artist: target.artist,
    albumHref: target.albumHref,
  }));
});

test("fails closed when the player has neither a matching ID nor album", () => {
  assert.throws(
    () => assertSongIdentity(target, { title: target.title, artist: target.artist }),
    /now-playing album/,
  );
});

test("rejects an album mismatch", () => {
  assert.throws(
    () => assertSongIdentity(target, { ...target, albumHref: "/album/another-album" }),
    /now-playing album/,
  );
});

test("rejects a title mismatch", () => {
  assert.throws(
    () => assertSongIdentity(target, { ...target, title: "Another song" }),
    /now-playing title/,
  );
});

test("rejects an artist mismatch", () => {
  assert.throws(
    () => assertSongIdentity(target, { ...target, artist: "Another artist" }),
    /now-playing artist/,
  );
});
