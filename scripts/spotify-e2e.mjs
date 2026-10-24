import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenarios, liveScenarios, assertLiveTrack } from '../tests/e2e/scenarios.mjs';
import { importCookies } from './spotify-e2e-cookies.mjs';
import { assertSongIdentity } from './spotify-e2e-identity.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];
assert(['fixture', 'live'].includes(mode), 'usage: node scripts/spotify-e2e.mjs fixture|live');
assert(process.platform === 'linux', 'Run extension browsers on Linux with Xvfb. Do not launch a foreground browser on the operator workstation.');
const work = mkdtempSync(resolve(tmpdir(), 'music-saver-e2e-'));
const artifacts = resolve(process.env.E2E_ARTIFACTS || resolve(root, 'e2e-artifacts', mode));
mkdirSync(artifacts, { recursive: true });
const profile = mode === 'live' ? process.env.SPOTIFY_E2E_PROFILE : resolve(work, 'profile');
assert(profile, 'SPOTIFY_E2E_PROFILE must name a dedicated persistent account profile');
const extension = resolve(work, 'extension');
cpSync(resolve(root, 'extension'), extension, { recursive: true });
const manifest = JSON.parse(readFileSync(resolve(extension, 'manifest.json')));
const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const key = publicKey.export({ type: 'spki', format: 'der' });
manifest.key = key.toString('base64');
if (mode === 'fixture') {
  manifest.host_permissions.push('http://127.0.0.1/*');
  manifest.content_scripts[0].matches.push('http://127.0.0.1/*');
}
writeFileSync(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
const id = createHash('sha256').update(key).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, c => String.fromCharCode(97 + parseInt(c, 16)));
const options = `chrome-extension://${id}/options.html`;
const session = `ms-${mode}-${process.pid}`;
const flags = ['--session', session, '--profile', resolve(profile), '--extension', extension, '--headed', '--json'];
let phase = 'browser launch';
let requestedSong;
const nowPlayingTrackId = `(() => {
  const widget=document.querySelector('[data-testid="now-playing-widget"]');
  const link=widget?.querySelector('[data-testid="context-item-link"]');
  const anchor=widget?.querySelector('a[data-testid="context-link"][data-context-item-type="track"]');
  const candidates=[link?.getAttribute('href'),anchor?.getAttribute('href'),anchor?.getAttribute('data-uri'),anchor?.getAttribute('data-context-uri')].filter(Boolean);
  const pattern=new RegExp('(?:spotify:track:|spotify%3atrack%3a|/track/)([A-Za-z0-9]{22})(?:[/?#]|$)','i');
  const ids=new Set(candidates.map(value=>value.match(pattern)?.[1]).filter(Boolean));
  return ids.size===1 ? [...ids][0] : null;
})()`;
function ab(...args) {
  let output;
  try {
    output = execFileSync('agent-browser', [...flags, ...args], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
    const result = JSON.parse(output);
    assert.notEqual(result.success, false, 'agent-browser command failed');
    return result.data;
  } catch (error) {
    const detail = String(error.stdout || output || '') + String(error.stderr || '');
    const reason = ['no song Like control', 'no Liked Songs row', 'no Like menu submit', 'no Cancel', 'strict mode violation', 'Timeout'].find(value => detail.includes(value));
    throw new Error(`agent-browser ${args[0]} failed during ${phase}${reason ? ` (${reason})` : ''}. Browser output is suppressed to protect authentication.`, { cause: error });
  }
}
function evaluate(code) { return ab('eval', code).result; }
function wait(ms) { ab('wait', String(ms)); }
function open(url) { ab('tab', 'player'); ab('open', url); }
function screenshot(name) {
  if (mode === 'live') evaluate(`(() => {
    const style=document.createElement('style');
    style.id='ms-e2e-privacy';
    style.textContent='body *{visibility:hidden!important}[data-testid="now-playing-widget"],[data-testid="now-playing-widget"] *,[data-testid="music-saver-toast"],[data-testid="music-saver-toast"] *{visibility:visible!important}';
    document.head.append(style);
  })()`);
  try { ab('screenshot', resolve(artifacts, `${name}.png`)); }
  finally { if (mode === 'live') evaluate("document.querySelector('#ms-e2e-privacy')?.remove()"); }
}
function storage(code) {
  ab('tab', 'options');
  try { ab('wait', '#enabled'); return evaluate(code); }
  finally { ab('tab', 'player'); }
}
function configure(settings) {
  const stored = storage(`chrome.storage.local.set({settings:${JSON.stringify(settings)},'activity-log':[],'retry-queue':[]}).then(()=>chrome.storage.local.get('settings')).then(x=>x.settings)`);
  assert.deepEqual(stored, settings, 'scenario settings persisted');
}
function events() { return storage("chrome.storage.local.get(['activity-log','retry-queue']).then(x=>({recent:x['activity-log']||[],pending:x['retry-queue']||[]}))"); }
const results = [];
let server;
let restore;
let initialLiked;
let cleanupError;
const recording = mode === 'live' && process.env.SPOTIFY_E2E_RECORD === '1' ? resolve(artifacts, 'agent-session.webm') : null;
let recordingStarted = false;
try {
  ab('open', 'about:blank');
  ab('tab', 'new', '--label', 'player', 'about:blank');
  ab('tab', 'new', '--label', 'options', options);
  ab('tab', 'player');
  if (mode === 'fixture') {
    const html = readFileSync(resolve(root, 'tests/e2e/player.html'));
    server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    // The server must serve while synchronous browser subprocesses run.
    const address = server.address();
    server.close();
    const serverCode = `require('http').createServer((q,s)=>{s.setHeader('content-type','text/html');s.end(require('fs').readFileSync(process.argv[1]))}).listen(Number(process.argv[2]),'127.0.0.1')`;
    const { spawn } = await import('node:child_process');
    server = spawn(process.execPath, ['-e', serverCode, resolve(root, 'tests/e2e/player.html'), String(address.port)], { stdio: 'ignore' });
    await new Promise((done, reject) => { server.once('error', reject); setTimeout(done, 300); });
    for (const scenario of scenarios) {
      phase = scenario.id;
      configure(scenario.settings);
      const startedAt = Date.now();
      const trackId = scenario.id.replace(/-/g, '');
      open(`http://127.0.0.1:${address.port}/?id=${trackId}&liked=${scenario.liked}&fail=${scenario.mode === 'failure'}`);
      ab('wait', '#play');
      if (scenario.mode === 'ad-only') evaluate('fixture.ad(true)');
      if (scenario.mode === 'paused') {
        wait(6000); ab('click', '#play'); wait(1500);
      } else if (scenario.mode === 'seek') {
        ab('click', '#play'); wait(1500); evaluate('fixture.seek(9500)'); wait(1500); ab('click', '#play'); wait(1500);
      } else if (scenario.mode === 'ad-break') {
        ab('click', '#play'); wait(2500); evaluate('fixture.ad(true)'); wait(6000); evaluate('fixture.ad(false)'); wait(1500);
      } else {
        ab('click', '#play'); wait(7500);
      }
      if (scenario.mode === 'undo') {
        ab('wait', 'button');
        ab('find', 'role', 'button', 'click', '--name', 'Undo', '--exact');
        wait(1500);
      }
      if (scenario.mode === 'once') {
        evaluate('fixture.seek(0)'); wait(7500);
      }
      const state = evaluate('fixture.state()');
      screenshot(scenario.id);
      const observed = events();
      // A clear is not synchronous in the background's cached copy, and an event
      // created just before the previous navigation can land after it. Judge only
      // the events stamped inside this scenario.
      const kinds = observed.recent.filter(event => event.ts >= startedAt).map(event => event.kind);
      const expectedKinds = scenario.mode === 'undo' ? ['save', 'undo'] : scenario.expected ? [scenario.expected] : [];
      assert.deepEqual(kinds, expectedKinds, `${scenario.id}: activity log`);
      assert.equal(state.liked, scenario.mode === 'undo' || scenario.mode === 'failure' ? false : scenario.expected === 'save' || scenario.liked, `${scenario.id}: liked state`);
      if (!scenario.expected) assert.equal(state.clicks, 0, `${scenario.id}: no save control touched`);
      assert.equal(observed.pending.length, scenario.mode === 'failure' ? 1 : 0, `${scenario.id}: retry queue`);
      results.push({ id: scenario.id, status: 'passed', state, kinds });
      console.log(`PASS fixture ${scenario.id}`);
    }
  } else {
    const track = assertLiveTrack(process.env.SPOTIFY_E2E_TRACK_ID);
    assert.equal(process.env.SPOTIFY_E2E_MUTATE_LIKED, '1', 'Live E2E permission required: set SPOTIFY_E2E_MUTATE_LIKED=1');
    phase = 'cookie import';
    if (process.env.SPOTIFY_E2E_COOKIE_FILE) {
      importCookies(JSON.parse(readFileSync(resolve(process.env.SPOTIFY_E2E_COOKIE_FILE), 'utf8')), ab);
    }
    phase = 'Spotify authentication';
    open('https://open.spotify.com/');
    try {
      ab('wait', '--fn', "!!document.querySelector('[data-testid=\"user-widget-link\"], [data-testid=\"user-widget-avatar\"]') && !document.querySelector('[data-testid=\"login-button\"]')");
    } catch {
      const status = evaluate(`({
        loginButton: !!document.querySelector('[data-testid="login-button"]'),
        userWidget: !!document.querySelector('[data-testid="user-widget-link"], [data-testid="user-widget-avatar"]'),
        trackPage: !!document.querySelector('[data-testid="play-button"]'),
        spotifyPage: location.hostname === 'open.spotify.com',
        accessDenied: /access denied|blocked|unusual traffic|captcha/i.test(document.body.innerText)
      })`);
      throw new Error('Spotify login check timed out: ' + JSON.stringify(status));
    }
    phase = 'extension settings';
    const originalSettings = storage("chrome.storage.local.get('settings').then(x=>x.settings||null)");
    const restoreSettings = () => {
      storage(originalSettings === null ? "chrome.storage.local.remove('settings')" : `chrome.storage.local.set({settings:${JSON.stringify(originalSettings)}})`);
      assert.deepEqual(storage("chrome.storage.local.get('settings').then(x=>x.settings||null)"), originalSettings, 'original extension settings restored');
    };
    restore = async () => { restoreSettings(); };
    const url = `https://open.spotify.com/track/${track}`;
    const playButton = '[data-testid="action-bar-row"] [data-testid="play-button"]';
    configure({ enabled: false, thresholdRatio: 0.9, minSoundedMs: 60000 });
    phase = 'Spotify track play button';
    open(url);
    ab('wait', playButton);
    requestedSong = {
      trackId: track,
      ...evaluate(`({
      title: document.querySelector('main h1')?.textContent.trim(),
      artist: [...document.querySelectorAll('main a[href*="/artist/"]')].map(link => link.textContent.trim()).find(Boolean)
    })`),
    };
    assert(requestedSong.title && requestedSong.artist, 'requested track page identifies its title and artist');
    if (recording) {
      phase = 'video recording';
      ab('record', 'start', recording, '--fps', '10', '--cursor');
      recordingStarted = true;
    }
    const playingRequestedSong = `document.querySelector('[data-testid="now-playing-widget"] [data-testid="context-item-info-title"]')?.textContent.trim() === ${JSON.stringify(requestedSong.title)} && document.querySelector('[data-testid="now-playing-widget"] [data-testid="context-item-info-artist"]')?.textContent.trim() === ${JSON.stringify(requestedSong.artist)} && (${nowPlayingTrackId}) === ${JSON.stringify(requestedSong.trackId)} && document.querySelector('[data-testid="control-button-playpause"]')?.getAttribute('aria-label') === 'Pause'`;
    const progressingRequestedSong = `(() => {
      const position = Number(document.querySelector('[data-testid="playback-progressbar"] input')?.value);
      const previous = window.__msE2EProgress;
      window.__msE2EProgress = position;
      return (${playingRequestedSong}) && Number.isFinite(previous) && position > previous;
    })()`;
    function pausePlayer() {
      if (evaluate("document.querySelector('[data-testid=\"control-button-playpause\"]')?.getAttribute('aria-label')==='Pause'")) {
        ab('click', '[data-testid="control-button-playpause"]');
        ab('wait', '--fn', "document.querySelector('[data-testid=\"control-button-playpause\"]')?.getAttribute('aria-label')==='Play'");
      }
    }
    function readNowPlayingIdentity() {
      return evaluate(`(() => {
        const widget=document.querySelector('[data-testid="now-playing-widget"]');
        const link=widget?.querySelector('[data-testid="context-item-link"]');
        const anchor=widget?.querySelector('a[data-testid="context-link"][data-context-item-type="track"]');
        const candidates=[link?.getAttribute('href'),anchor?.getAttribute('href'),anchor?.getAttribute('data-uri'),anchor?.getAttribute('data-context-uri')].filter(Boolean);
        const pattern=new RegExp('(?:spotify:track:|spotify%3atrack%3a|/track/)([A-Za-z0-9]{22})(?:[/?#]|$)','i');
        const ids=new Set(candidates.map(value=>value.match(pattern)?.[1]).filter(Boolean));
        return {
          trackId: ids.size===1 ? [...ids][0] : null,
          title: document.querySelector('[data-testid="now-playing-widget"] [data-testid="context-item-info-title"]')?.textContent.trim() || null,
          artist: document.querySelector('[data-testid="now-playing-widget"] [data-testid="context-item-info-artist"]')?.textContent.trim() || null
        };
      })()`);
    }
    function assertRequestedSong(action) {
      const actual = readNowPlayingIdentity();
      try { assertSongIdentity(requestedSong, actual); }
      catch (error) { throw new Error(`${action}: ${error.message}`, { cause: error }); }
      return actual;
    }
    function startRequestedSong() {
      pausePlayer();
      open(url);
      ab('wait', playButton);
      evaluate('window.__msE2EProgress = null');
      ab('click', playButton);
      ab('wait', '--fn', progressingRequestedSong);
      pausePlayer();
      return assertRequestedSong('requested song selected');
    }
    evaluate('window.__msE2EProgress = null');
    ab('click', playButton);
    phase = 'Spotify playback start';
    ab('wait', '--fn', progressingRequestedSong);
    const likeButton = '[data-testid="now-playing-widget"] button[aria-checked]';
    async function liked(next) {
      return evaluate(`(async()=>{
        const b=document.querySelector(${JSON.stringify(likeButton)});
        if(!b) throw Error('no song Like control');
        if(b.getAttribute('aria-checked')==='false') {
          if(${JSON.stringify(next)}===true) {b.click();await new Promise(r=>setTimeout(r,500));return document.querySelector(${JSON.stringify(likeButton)}).getAttribute('aria-checked')==='true';}
          return false;
        }
        b.click();
        let menu,box;
        for(let i=0;i<30;i++) {
          menu=document.querySelector('[data-testid="context-menu"]');
          box=menu?.querySelector('[aria-labelledby="listrow-title-spotify:collection:tracks"]')?.closest('button[role="menuitemcheckbox"]');
          if(box)break;
          await new Promise(r=>setTimeout(r,100));
        }
        if(!box) throw Error('no Liked Songs row');
        const before=box.getAttribute('aria-checked')==='true';
        if(${JSON.stringify(next)}!==null && before!==${JSON.stringify(next)}) {
          box.click();
          let done, removed;
          for(let i=0;i<30;i++) {
            done=document.querySelector('[data-testid="context-menu"] button[type="submit"]');
            removed=${JSON.stringify(next)}===false && document.querySelector(${JSON.stringify(likeButton)})?.getAttribute('aria-checked')==='false';
            if(done || removed)break;
            await new Promise(r=>setTimeout(r,100));
          }
          if(done)done.click();
          else if(!removed)throw Error('no Like menu submit');
          await new Promise(r=>setTimeout(r,500));
          return ${JSON.stringify(next)};
        }
        const cancel=[...menu.querySelectorAll('button')].find(x=>x.textContent.trim()==='Cancel');
        if(!cancel)throw Error('no Cancel');cancel.click();return before;
      })()`);
    }
    phase = 'initial Liked Songs state';
    ab('wait', likeButton);
    initialLiked = await guardedLiked(null);
    restore = async () => {
      phase = 'restore original state';
      pausePlayer();
      storage("chrome.storage.local.set({settings:{enabled:false,thresholdRatio:0.9,minSoundedMs:60000}})");
      try {
        startRequestedSong();
        ab('wait', likeButton);
        await guardedLiked(initialLiked);
        startRequestedSong();
        ab('wait', likeButton);
        assert.equal(await guardedLiked(null), initialLiked, 'original liked state restored after reload');
        screenshot('restored');
      } finally { restoreSettings(); }
    };
    evaluate(`window.__msE2EDocument = ${JSON.stringify(session)}`);
    function assertSamePlayer() {
      assert.equal(evaluate('window.__msE2EDocument'), session, 'options access preserves the Spotify document');
    }
    async function guardedLiked(next) {
      const action = next === null ? 'Liked-state inspection' : `Liked-state change to ${next}`;
      assertRequestedSong(`before ${action}`);
      const value = await liked(next);
      assertRequestedSong(`after ${action}`);
      return value;
    }
    for (const { id: name, startLiked, reached, undo } of liveScenarios) {
      phase = name;
      startRequestedSong();
      evaluate(`window.__msE2EDocument = ${JSON.stringify(session)}`);
      configure({ enabled: false, thresholdRatio: 0.01, minSoundedMs: 60000 });
      assertSamePlayer();
      ab('wait', likeButton);
      await guardedLiked(startLiked);
      assert.equal(await guardedLiked(null), startLiked, 'live precondition');
      configure({ enabled: true, thresholdRatio: reached ? 0.01 : 1, minSoundedMs: reached ? 6000 : 3600000 });
      assertSamePlayer();
      ab('wait', playButton);
      if (undo) evaluate(`(() => {
        window.__msE2EUndo = { created: false, visible: false };
        new MutationObserver(records => {
          const button = document.querySelector('[data-testid="music-saver-undo"]');
          const toast = document.querySelector('[data-testid="music-saver-toast"]');
          if (toast && button) {
            const rootStyle = getComputedStyle(toast);
            const buttonStyle = getComputedStyle(button);
            const rect = toast.getBoundingClientRect();
            const buttonRect = button.getBoundingClientRect();
            window.__msE2EUndo.layout = {
              rootDisplay: rootStyle.display, rootVisibility: rootStyle.visibility,
              buttonDisplay: buttonStyle.display, buttonVisibility: buttonStyle.visibility,
              width: rect.width, height: rect.height, x: rect.x, y: rect.y,
              buttonWidth: buttonRect.width, buttonHeight: buttonRect.height,
              inlineStyle: toast.getAttribute('style'), parent: toast.parentElement?.tagName,
              privacyMaskPresent: !!document.querySelector('#ms-e2e-privacy')
            };
          }
          if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 && (node.matches('[data-testid="music-saver-toast"]') || node.querySelector('[data-testid="music-saver-toast"]'))))) window.__msE2EUndo.created = true;
          if (button?.getClientRects().length && getComputedStyle(button).visibility !== 'hidden') window.__msE2EUndo.visible = true;
        }).observe(document.body, { childList: true, subtree: true });
      })()`);
      const startPosition = evaluate("Number(document.querySelector('[data-testid=\"playback-progressbar\"] input')?.value)");
      assert(Number.isFinite(startPosition), 'live progress control readable');
      evaluate('window.__msE2EProgress = null');
      const startedAt = Date.now();
      assertRequestedSong('before live playback');
      ab('click', playButton);
      ab('wait', '--fn', progressingRequestedSong);
      assertRequestedSong('after extension mutation window');
      let savedBeforeUndo;
      if (undo) {
        ab('wait', '--fn', "(() => { const button=document.querySelector('[data-testid=\"music-saver-undo\"]'); return !!button?.getClientRects().length && getComputedStyle(button).visibility !== 'hidden'; })()");
        savedBeforeUndo = evaluate(`document.querySelector(${JSON.stringify(likeButton)})?.getAttribute('aria-checked')==='true'`);
        screenshot('undo-toast');
        assertRequestedSong('before test Undo');
        ab('click', '[data-testid="music-saver-undo"]');
        wait(1500);
        assertRequestedSong('after test Undo');
        assert.equal(savedBeforeUndo, true, `${name}: live save before Undo`);
      } else {
        wait(reached ? 15000 : 4000);
      }
      const endPosition = evaluate("Number(document.querySelector('[data-testid=\"playback-progressbar\"] input')?.value)");
      assert(endPosition >= startPosition + (reached ? 6000 : 1000), `live song really progressed: ${startPosition} -> ${endPosition}`);
      const afterUndo = undo ? await guardedLiked(null) : undefined;
      const after = undo ? afterUndo : await guardedLiked(null);
      if (undo) assert.equal(afterUndo, false, 'live Undo removes the saved song');
      screenshot(name);
      pausePlayer();
      const observed = events();
      assertSamePlayer();
      const expected = reached ? (startLiked ? 'skip' : 'save') : null;
      if (!undo) assert.equal(after, startLiked || reached, `${name}: live liked state`);
      assert.deepEqual(observed.recent.filter(event=>event.ts>=startedAt).map(e=>e.kind), undo ? ['save', 'undo'] : expected ? [expected] : [], `${name}: extension activity`);
      assert.equal(observed.pending.length, 0, `${name}: no failed actions`);
      results.push({
        id: name,
        status: 'passed',
        startLiked,
        after,
        expected,
        progressMs: endPosition-startPosition,
        documentPreserved: true,
        target: requestedSong,
        ...(undo ? { savedBeforeUndo } : {}),
      });
      console.log(`PASS live ${name}`);
    }
  }
} catch (error) {
  let diagnostics;
  if (mode === 'live') {
    try {
      diagnostics = evaluate(`({
        playButton: !!document.querySelector('[data-testid="play-button"]'),
        likeControls: [...document.querySelectorAll('[data-testid="now-playing-widget"] button')].map(button => ({
          testId: button.getAttribute('data-testid'),
          label: button.getAttribute('aria-label'),
          checked: button.getAttribute('aria-checked'),
          pressed: button.getAttribute('aria-pressed')
        })),
        playButtons: [...document.querySelectorAll('[data-testid="play-button"]')].map(button => ({
          visible: !!button.getClientRects().length && getComputedStyle(button).visibility !== 'hidden',
          disabled: button.disabled,
          inActionBar: !!button.closest('[data-testid="action-bar-row"]')
        })),
        playing: document.querySelector('[data-testid="control-button-playpause"]')?.getAttribute('aria-label') === 'Pause',
        songTitleMatches: document.querySelector('[data-testid="now-playing-widget"] [data-testid="context-item-info-title"]')?.textContent.trim() === ${JSON.stringify(requestedSong?.title || '')},
        songArtistMatches: document.querySelector('[data-testid="now-playing-widget"] [data-testid="context-item-info-artist"]')?.textContent.trim() === ${JSON.stringify(requestedSong?.artist || '')},
        nowPlayingTrackId: (${nowPlayingTrackId}),
        undoObservation: window.__msE2EUndo || null,
        progress: Number(document.querySelector('[data-testid="playback-progressbar"] input')?.value),
        duration: Number(document.querySelector('[data-testid="playback-progressbar"] input')?.max),
        adVisible: !!document.querySelector('[data-testid="ad-slot"], [data-testid="advertisement"]')?.getClientRects().length
      })`);
    } catch { diagnostics = { unavailable: true }; }
  }
  results.push({ status: 'failed', error: error.message, phase, diagnostics });
  process.exitCode = 1;
  try { screenshot('failure'); } catch { /* A failed screenshot must not hide the original error. */ }
  if (mode === 'live') {
    try {
      const observed = events();
      results[results.length - 1].activity = observed.recent.map(event => ({ kind: event.kind, detail: event.detail }));
      results[results.length - 1].pending = observed.pending.length;
    } catch { results[results.length - 1].activityUnavailable = true; }
  }
  console.error(error.message);
} finally {
  try { if (restore) await restore(); } catch(error) { cleanupError = error.message; process.exitCode = 1; }
  try { if (recordingStarted) ab('record', 'stop'); } catch { cleanupError ||= 'video recording stop failed'; process.exitCode = 1; }
  try { ab('close'); } catch { cleanupError ||= 'browser close failed'; process.exitCode = 1; }
  server?.kill?.();
  const bundleSha256 = createHash('sha256').update(readFileSync(resolve(root, 'extension/content.bundle.js'))).digest('hex');
  writeFileSync(resolve(artifacts, 'results.json'), JSON.stringify({ mode, bundleSha256, recording: recordingStarted ? recording : null, results, initialLiked, cleanupError, passed: process.exitCode !== 1, timestamp: new Date().toISOString() }, null, 2));
  rmSync(work, { recursive: true, force: true });
}
