import test from "node:test";
import assert from "node:assert/strict";
import { readPlayback } from "../extension/lib/player-dom.js";
import { matrix, scenarios, finalLiked, validateScenarios, assertLiveTrack } from './e2e/scenarios.mjs';
import { WatchLoop } from '../extension/content.js';
import { SoundedTimeSampler } from '../extension/lib/player-dom.js';

test('browser matrix covers every liked, ratio, and floor combination', () => {
  assert.equal(matrix.length, 8);
  assert.equal(new Set(matrix.map(s => s.id)).size, 8);
  assert.equal(new Set(scenarios.map(s => s.id)).size, scenarios.length);
  assert.equal(matrix.filter(s => s.expected[0] === 'save').length, 1);
  assert.equal(matrix.filter(s => s.expected[0] === 'skip').length, 1);
});

test('the scenario table is valid data the runner can execute', () => {
  assert.equal(validateScenarios(scenarios), scenarios);
  assert.equal(scenarios.length, 18);
});

test('a scenario that fails validation never reaches the browser', () => {
  const base = { id: 'x', liked: false, mode: 'listen', settings: { thresholdRatio: 0.5, minSoundedMs: 1000, enabled: true }, steps: [{ act: 'wait', ms: 10 }], expected: [], expect: { opens: 0, saves: 0 } };
  const broken = [
    { ...base, id: '' },
    { ...base, steps: [] },
    { ...base, steps: [{ act: 'teleport' }] },
    { ...base, expected: ['save', 'explode'] },
    { ...base, expect: { opens: 0 } },
    { ...base, fail: 'sometimes' },
    { ...base, tracks: ['onlyone'] },
  ];
  for (const scenario of broken) assert.throws(() => validateScenarios([scenario]));
  assert.throws(() => validateScenarios([base, { ...base }]), /duplicate scenario id/);
});

test('final liked state follows the recorded events, not the scenario family', () => {
  assert.equal(finalLiked(false, []), false);
  assert.equal(finalLiked(true, []), true);
  assert.equal(finalLiked(false, ['save']), true);
  assert.equal(finalLiked(true, ['skip']), true);
  assert.equal(finalLiked(false, ['save', 'undo']), false);
  assert.equal(finalLiked(false, ['fail', 'save']), true);
  assert.equal(finalLiked(false, ['fail']), false);
});

test('retry recovery asserts the queued failure is resolved by a later save', () => {
  const scenario = scenarios.find(s => s.id === 'retry-recovery');
  assert.deepEqual(scenario.expected, ['fail', 'save']);
  assert.equal(scenario.fail, 'once');
  assert.equal(scenario.expect.saves, 1);
  assert.equal(scenario.expect.opens, undefined, 'a retry poll can race the read, so opens is not asserted');
  assert.equal(finalLiked(scenario.liked, scenario.expected), true);
  assert.equal(scenario.retry, undefined);
});

test('track change asserts a per-track budget and a second decision', () => {
  const scenario = scenarios.find(s => s.id === 'track-change');
  assert.deepEqual(scenario.expected, ['save', 'skip']);
  assert.deepEqual(scenario.tracks, ['trackchange', 'trackb']);
  assert.equal(new Set(scenario.tracks).size, 2);
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
