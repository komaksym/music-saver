import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { readPlayback } from "../extension/lib/player-dom.js";
import { matrix, scenarios, liveScenarios, liveScenariosFor, assertLiveTrack } from './e2e/scenarios.mjs';
import { WatchLoop, shouldBoot } from '../extension/content.js';
import { SoundedTimeSampler } from '../extension/lib/player-dom.js';

const prWorkflow = readFileSync(new URL('../.github/workflows/pr.yml', import.meta.url), 'utf8');
const e2eJob = prWorkflow.slice(prWorkflow.indexOf('  e2e:'), prWorkflow.indexOf('  gate:'));
const liveWorkflow = readFileSync(new URL('../.github/workflows/spotify-e2e.yml', import.meta.url), 'utf8');

test('pull request checks run only the fixture e2e job', () => {
  assert.match(prWorkflow, /^  pull_request:$/m);
  assert.doesNotMatch(liveWorkflow, /^  pull_request:/m);
  assert.doesNotMatch(prWorkflow, /^  spotify-e2e-live:/m);
});

test('browser workflows install the locked harness without a global package install', () => {
  for (const workflow of [e2eJob, liveWorkflow]) {
    assert.match(workflow, /^        run: npm ci$/m);
    assert.match(workflow, /^        run: npx --no-install agent-browser install --with-deps$/m);
    assert.doesNotMatch(workflow, /npm install --global|npm install -g/);
  }
});

test('the canonical runner is the only E2E lane wired into CI', () => {
  assert.match(e2eJob, /node scripts\/spotify-e2e\.mjs fixture/);
  assert.match(liveWorkflow, /node scripts\/spotify-e2e\.mjs live/);
  for (const workflow of [prWorkflow, liveWorkflow]) {
    assert.doesNotMatch(workflow, /e2e-(?:agent-browser|matrix)\.sh/);
  }
  assert.equal(existsSync(new URL('../scripts/e2e-matrix.sh', import.meta.url)), false);
});

test('the live workflow records the authenticated browser session', () => {
  assert.match(liveWorkflow, /^          SPOTIFY_E2E_RECORD: '1'$/m);
  assert.match(readFileSync(new URL('../scripts/spotify-e2e.mjs', import.meta.url), 'utf8'), /ab\('record', 'start'/);
});

test('the live workflow explicitly opts into Liked-state mutations', () => {
  assert.match(liveWorkflow, /^          SPOTIFY_E2E_MUTATE_LIKED: '1'$/m);
  assert.match(readFileSync(new URL('../scripts/spotify-e2e.mjs', import.meta.url), 'utf8'), /SPOTIFY_E2E_MUTATE_LIKED/);
});

test('the watch loop boots on Spotify and on the loopback fixture host', () => {
  for (const href of ['https://open.spotify.com/track/abc', 'https://open.spotify.com/', 'http://127.0.0.1:41729/?id=song&liked=false']) {
    assert.equal(shouldBoot(href), true, href);
  }
  for (const href of ['', undefined, 'https://example.com/', 'https://open.spotify.com.evil.test/', 'http://127.0.0.1.evil.test/']) {
    assert.equal(shouldBoot(href), false, String(href));
  }
});

test('browser matrix covers every liked, ratio, and floor combination', () => {
  assert.equal(matrix.length, 8);
  assert.equal(new Set(matrix.map(s => s.id)).size, 8);
  assert.equal(new Set(scenarios.map(s => s.id)).size, scenarios.length);
  assert.equal(matrix.filter(s => s.expected === 'save').length, 1);
  assert.equal(matrix.filter(s => s.expected === 'skip').length, 1);
});

test('live matrix covers the four session states and one direct Undo case', () => {
  assert.deepEqual(liveScenarios, [
    { id: 'unliked-below', startLiked: false, reached: false, undo: false },
    { id: 'unliked-reached', startLiked: false, reached: true, undo: false },
    { id: 'liked-below', startLiked: true, reached: false, undo: false },
    { id: 'liked-reached', startLiked: true, reached: true, undo: false },
    { id: 'undo', startLiked: false, reached: true, undo: true },
  ]);
});

test('decision clip mode records only the save and skip decisions', () => {
  assert.deepEqual(liveScenariosFor(true).map(({ id }) => id), ['unliked-reached', 'liked-reached']);
  assert.equal(liveScenariosFor(false), liveScenarios);
});

test('decision clips require manual workflow dispatch', () => {
  assert.match(liveWorkflow, /^      decision_clips:$/m);
  assert.match(liveWorkflow, /^          SPOTIFY_E2E_DECISION_CLIPS:/m);
  assert.match(readFileSync(new URL('../scripts/spotify-e2e.mjs', import.meta.url), 'utf8'), /decision-\$\{/);
});

test('live songs require explicit Spotify track identities', () => {
  for (const id of ['', undefined, 'seed-unliked-long', '../profile']) assert.throws(() => assertLiveTrack(id));
  assert.equal(assertLiveTrack('7LoBfKLpz4BGrxCuOzAKRz'), '7LoBfKLpz4BGrxCuOzAKRz');
});

test('an advertisement resets the sampling boundary before music resumes', async () => {
  const sampler = new SoundedTimeSampler();
  const track = { id: 'song' };
  const sample = (wallMs, positionMs) => ({ kind: 'track', track, wallMs, positionMs, durationMs: 100000, playing: true });
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
  const title = { textContent: 'Song' };
  const artist = { textContent: 'Artist' };
  const anchor = { textContent: 'Song', getAttribute: (name) => name === 'href' ? 'spotify:track:abc' : null };
  const widget = { querySelector: (selector) => {
    if (selector.includes('info-title')) return title;
    if (selector.includes('info-artist')) return artist;
    if (selector.includes('context-link') || selector.includes('spotify:track')) return anchor;
    return null;
  } };
  const like = { getAttribute: () => 'false' };
  const doc = { querySelector: (selector) => {
    if (selector.includes('now-playing-widget-v2')) return null;
    if (selector.includes('now-playing-widget') && selector.includes('button')) return like;
    if (selector.includes('now-playing-widget')) return widget;
    if (selector.includes('playback-progressbar') && selector.includes('input')) return { value: 1000, max: 10000 };
    return null;
  } };
  assert.equal(readPlayback(doc, 1000).durationMs, 10000);
});
