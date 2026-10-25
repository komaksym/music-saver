import assert from 'node:assert/strict';

const TARGET_FIELDS = ['trackId', 'title', 'artist', 'albumHref'];

function targetField(target, name) {
  assert.ok(target && typeof target === 'object', 'target song identity is required');
  const value = target[name];
  assert.equal(typeof value, 'string', `target ${name} must be a string`);
  assert.notEqual(value, '', `target ${name} must not be empty`);
  return value;
}

export function assertSongIdentity(target, actual) {
  const expected = Object.fromEntries(TARGET_FIELDS.map(name => [name, targetField(target, name)]));
  const trackId = actual?.trackId;
  assert.equal(typeof trackId, 'string', 'now-playing track ID must be a string');
  assert.equal(trackId, expected.trackId, 'now-playing track ID must match the dedicated target');
  assert.equal(actual?.albumHref, expected.albumHref, 'now-playing album must match the dedicated target');
  assert.equal(actual?.title, expected.title, 'now-playing title must match the dedicated target');
  assert.equal(actual?.artist, expected.artist, 'now-playing artist must match the dedicated target');
}
