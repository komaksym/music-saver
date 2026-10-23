import test from "node:test";
import assert from "node:assert/strict";
import { readPlayback } from "../extension/lib/player-dom.js";
import { matrix, scenarios, assertLiveTrack } from './e2e/scenarios.mjs';
import { WatchLoop } from '../extension/content.js';
import { SoundedTimeSampler } from '../extension/lib/player-dom.js';

test('browser matrix covers every liked, ratio, and floor combination', () => {
  assert.equal(matrix.length, 8);
  assert.equal(new Set(matrix.map(s => s.id)).size, 8);
  assert.equal(new Set(scenarios.map(s => s.id)).size, scenarios.length);
  assert.equal(matrix.filter(s => s.expected === 'save').length, 1);
  assert.equal(matrix.filter(s => s.expected === 'skip').length, 1);
});

test('live songs require explicit Spotify track identities', () => {
  for (const id of ['', undefined, 'seed-unliked-long', '../profile']) assert.throws(() => assertLiveTrack(id));
  assert.equal(assertLiveTrack('7LoBfKLpz4BGrxCuOzAKRz'), '7LoBfKLpz4BGrxCuOzAKRz');
});

test('an advertisement resets the sampling boundary before music resumes', async () => {
  const sampler = new SoundedTimeSampler();
  const track = { id: 'song' };
  const sample = (wallMs, positionMs) => ({ track, wallMs, positionMs, durationMs: 100000, playing: true });
  sampler.observe(sample(0, 0));
  sampler.observe(sample(1000, 1000));
  const loop = new WatchLoop({ read: () => null, settings: { enabled: true }, sampler });
  await loop.tick();
  assert.equal(sampler.observe(sample(31000, 31000)), 0, 'ad time cannot become sounded song credit');
});

for (const marker of ['[data-testid="ad-slot"]', '[data-testid="advertisement"]']) {
  test(`advertisements reject playback even with stale song controls: ${marker}`, () => {
    const doc = { querySelector: (selector) => {
      if (selector === marker) return { getClientRects: () => [{}] };
      if (selector.includes('input')) return { value: 90000, max: 100000 };
      if (selector.includes('playpause')) return { getAttribute: () => 'Pause' };
      return null;
    } };
    assert.equal(readPlayback(doc, 1000), null);
  });
}

test('missing ad markers do not discard valid time readings', () => {
  const doc = { querySelector: (selector) => selector.includes('input') ? { value: 1000, max: 10000 } : null };
  assert.equal(readPlayback(doc, 1000).durationMs, 10000);
});
