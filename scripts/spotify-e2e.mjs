import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenarios, assertLiveTrack } from '../tests/e2e/scenarios.mjs';

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
function ab(...args) {
  try {
    const raw = execFileSync('agent-browser', [...flags, ...args], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
    const result = JSON.parse(raw);
    assert.notEqual(result.success, false, 'agent-browser command failed');
    return result.data;
  } catch {
    throw new Error(`agent-browser ${args[0]} failed. Browser output is suppressed to protect authentication.`);
  }
}
function evaluate(code) { return ab('eval', code).result; }
function wait(ms) { ab('wait', String(ms)); }
function open(url) { ab('open', url); }
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
function storage(code) { open(options); ab('wait', '#enabled'); return evaluate(code); }
function configure(settings) { storage(`chrome.storage.local.set({settings:${JSON.stringify(settings)},'activity-log':[],'retry-queue':[]})`); }
function events() { return storage("chrome.storage.local.get(['activity-log','retry-queue']).then(x=>({recent:x['activity-log']||[],pending:x['retry-queue']||[]}))"); }
const results = [];
let server;
let restore;
let cleanupError;
try {
  open('about:blank');
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
      configure(scenario.settings);
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
      const kinds = observed.recent.map(event => event.kind);
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
    if (process.env.SPOTIFY_E2E_COOKIE_FILE) ab('cookies', 'set', '--curl', resolve(process.env.SPOTIFY_E2E_COOKIE_FILE));
    open('https://open.spotify.com/');
    ab('wait', '--fn', "!!document.querySelector('[data-testid=\"user-widget-link\"], [data-testid=\"user-widget-avatar\"]') && !document.querySelector('[data-testid=\"login-button\"]')");
    const originalSettings = storage("chrome.storage.local.get('settings').then(x=>x.settings||null)");
    const url = `https://open.spotify.com/track/${track}`;
    configure({ enabled: false, thresholdRatio: 0.9, minSoundedMs: 60000 });
    open(url);
    ab('wait', '[data-testid="play-button"]');
    ab('click', '[data-testid="play-button"]');
    ab('wait', '--fn', `!!document.querySelector('[data-testid="now-playing-widget"] a[href*="${track}"]') && document.querySelector('[data-testid="control-button-playpause"]')?.getAttribute('aria-label')==='Pause'`);
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
          box.click();menu.querySelector('button[type="submit"]').click();
          await new Promise(r=>setTimeout(r,500));
          return ${JSON.stringify(next)};
        }
        const cancel=[...menu.querySelectorAll('button')].find(x=>x.textContent.trim()==='Cancel');
        if(!cancel)throw Error('no Cancel');cancel.click();return before;
      })()`);
    }
    const initialLiked = await liked(null);
    restore = async () => {
      storage("chrome.storage.local.set({settings:{enabled:false,thresholdRatio:0.9,minSoundedMs:60000}})");
      open(url);
      ab('wait', likeButton);
      await liked(initialLiked);
      assert.equal(await liked(null), initialLiked, 'original liked state restored');
      storage(originalSettings === null ? "chrome.storage.local.remove('settings')" : `chrome.storage.local.set({settings:${JSON.stringify(originalSettings)}})`);
    };
    for (const startLiked of [false, true]) {
      for (const reached of [false, true]) {
        configure({ enabled: false, thresholdRatio: 0.01, minSoundedMs: 60000 });
        open(url); ab('wait', likeButton);
        await liked(startLiked);
        assert.equal(await liked(null), startLiked, 'live precondition');
        // A fresh content-script document prevents sounded credit leaking across cases.
        configure({ enabled: true, thresholdRatio: reached ? 0.01 : 1, minSoundedMs: reached ? 6000 : 3600000 });
        open(url); ab('wait', '[data-testid="play-button"]');
        const paused = evaluate("document.querySelector('[data-testid=\"control-button-playpause\"]')?.getAttribute('aria-label')!=='Pause'");
        if(paused) ab('click', '[data-testid="play-button"]');
        ab('wait', '--fn', `!!document.querySelector('[data-testid="now-playing-widget"] a[href*="${track}"]') && document.querySelector('[data-testid="control-button-playpause"]')?.getAttribute('aria-label')==='Pause'`);
        const startPosition = evaluate("Number(document.querySelector('[data-testid=\"playback-progressbar\"] input')?.value)");
        assert(Number.isFinite(startPosition), 'live progress control readable');
        wait(reached ? 15000 : 4000);
        const endPosition = evaluate("Number(document.querySelector('[data-testid=\"playback-progressbar\"] input')?.value)");
        assert(endPosition > startPosition + (reached ? 6000 : 1000), 'live song really progressed');
        const after = await liked(null);
        const name = `${startLiked ? 'liked' : 'unliked'}-${reached ? 'reached' : 'below'}`;
        screenshot(name);
        const observed = events();
        const expected = reached ? (startLiked ? 'skip' : 'save') : null;
        assert.equal(after, startLiked || reached, `${name}: live liked state`);
        assert.deepEqual(observed.recent.map(e=>e.kind), expected ? [expected] : [], `${name}: extension activity`);
        assert.equal(observed.pending.length, 0, `${name}: no failed actions`);
        results.push({ id: name, status: 'passed', startLiked, after, expected, progressMs: endPosition-startPosition });
        console.log(`PASS live ${name}`);
      }
    }
  }
} catch (error) {
  results.push({ status: 'failed', error: error.message });
  process.exitCode = 1;
  try { screenshot('failure'); } catch { /* A failed screenshot must not hide the original error. */ }
  console.error(error.message);
} finally {
  try { if (restore) await restore(); } catch(error) { cleanupError = error.message; process.exitCode = 1; }
  try { ab('close'); } catch { cleanupError ||= 'browser close failed'; process.exitCode = 1; }
  server?.kill?.();
  const bundleSha256 = createHash('sha256').update(readFileSync(resolve(root, 'extension/content.bundle.js'))).digest('hex');
  writeFileSync(resolve(artifacts, 'results.json'), JSON.stringify({ mode, bundleSha256, results, cleanupError, passed: process.exitCode !== 1, timestamp: new Date().toISOString() }, null, 2));
  rmSync(work, { recursive: true, force: true });
}
