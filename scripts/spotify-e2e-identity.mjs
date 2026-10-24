import assert from 'node:assert/strict';

function field(actual, name) {
  const value = actual?.[name];
  return typeof value === 'string' ? value : null;
}

export function assertSongIdentity(target, actual) {
  const trackId = field(actual, 'trackId');
  if (trackId !== null) assert.equal(trackId, target?.trackId, 'now-playing track ID must match the dedicated target');
  assert.equal(field(actual, 'albumHref'), target?.albumHref, 'now-playing album must match the dedicated target');
  assert.equal(field(actual, 'title'), target?.title, 'now-playing title must match the dedicated target');
  assert.equal(field(actual, 'artist'), target?.artist, 'now-playing artist must match the dedicated target');
}
