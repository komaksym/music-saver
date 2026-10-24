import assert from 'node:assert/strict';

function field(actual, name) {
  const value = actual?.[name];
  return typeof value === 'string' ? value : null;
}

export function assertSongIdentity(target, actual) {
  assert.equal(field(actual, 'trackId'), target?.trackId, 'now-playing track ID must match the dedicated target');
  assert.equal(field(actual, 'title'), target?.title, 'now-playing title must match the dedicated target');
  assert.equal(field(actual, 'artist'), target?.artist, 'now-playing artist must match the dedicated target');
}
