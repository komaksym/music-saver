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

test("rejects a different track with the same title, artist, and album", () => {
  assert.throws(
    () => assertSongIdentity(target, { ...target, trackId: "5ghIJDpPoe3CfHMGu71E6T" }),
    /now-playing track ID/,
  );
});

test("fails closed when the now-playing widget has no track ID", () => {
  assert.throws(
    () => assertSongIdentity(target, {
      title: target.title,
      artist: target.artist,
      albumHref: target.albumHref,
    }),
    /now-playing track ID/,
  );
});

test("fails closed when the now-playing track ID is not a string", () => {
  assert.throws(
    () => assertSongIdentity(target, { ...target, trackId: 7 }),
    /now-playing track ID/,
  );
});

test("rejects an album mismatch", () => {
  assert.throws(
    () => assertSongIdentity(target, { ...target, albumHref: "/album/another-album" }),
    /now-playing album/,
  );
});

test("rejects a missing album", () => {
  const { albumHref, ...actual } = target;
  assert.ok(albumHref);
  assert.throws(() => assertSongIdentity(target, actual), /now-playing album/);
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

for (const field of ["trackId", "title", "artist", "albumHref"]) {
  test(`rejects a target without ${field}`, () => {
    const incomplete = { ...target };
    delete incomplete[field];
    assert.throws(
      () => assertSongIdentity(incomplete, { ...target }),
      new RegExp(`target ${field}`),
    );
  });
}

test("rejects a non-string target field", () => {
  assert.throws(
    () => assertSongIdentity({ ...target, trackId: 7 }, { ...target }),
    /target trackId/,
  );
});

for (const field of ["title", "artist", "albumHref"]) {
  test(`rejects a non-string target ${field}`, () => {
    assert.throws(
      () => assertSongIdentity({ ...target, [field]: 7 }, { ...target }),
      new RegExp(`target ${field}`),
    );
  });
}

test("rejects a missing target", () => {
  assert.throws(() => assertSongIdentity(undefined, { ...target }), /target song identity/);
});
