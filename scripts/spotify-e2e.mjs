import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenarios, validateScenarios, finalLiked, assertLiveTrack } from '../tests/e2e/scenarios.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];
assert(['fixture', 'live'].includes(mode), 'usage: node scripts/spotify-e2e.mjs fixture|live');
assert(process.platform === 'linux', 'Run extension browsers on Linux with Xvfb. Do not launch a foreground browser on the operator workstation.');
validateScenarios(scenarios);
const live = mode === 'live';
const work = mkdtempSync(resolve(tmpdir(), 'music-saver-e2e-'));
const artifacts = resolve(process.env.E2E_ARTIFACTS || resolve(root, 'e2e-artifacts', mode));
mkdirSync(artifacts, { recursive: true });
const profile = live ? process.env.SPOTIFY_E2E_PROFILE : resolve(work, 'profile');
assert(profile, 'SPOTIFY_E2E_PROFILE must name a dedicated persistent account profile');

const extension = resolve(work, 'extension');
cpSync(resolve(root, 'extension'), extension, { recursive: true });
const manifest = JSON.parse(readFileSync(resolve(extension, 'manifest.json')));
const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const key = publicKey.export({ type: 'spki', format: 'der' });
manifest.key = key.toString('base64');
if (!live) {
  manifest.host_permissions.push('http://127.0.0.1/*');
  manifest.content_scripts[0].matches.push('http://127.0.0.1/*');
}
writeFileSync(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
const id = createHash('sha256').update(key).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, c => String.fromCharCode(97 + parseInt(c, 16)));
const options = `chrome-extension://${id}/options.html`;
const session = `ms-${mode}-${process.pid}`;
const flags = ['--session', session, '--profile', resolve(profile), '--extension', extension, '--headed', '--json'];
const AGENT_BROWSER_PIN = 'agent-browser 0.38.2';

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

// Live screenshots must never show personal library UI. A style element can be
// blocked by the page CSP, so the mask falls back to CSSOM hiding and then proves
// itself before any pixel is written.
const PRIVACY_MASK = `(() => {
  const KEEP = '[data-testid="now-playing-widget"],[data-testid="music-saver-toast"]';
  const keep = (el) => el.matches(KEEP) || !!el.closest(KEEP);
  const style = document.createElement('style');
  style.id = 'ms-e2e-privacy';
  style.textContent = 'body *{visibility:hidden!important}' + KEEP.split(',').flatMap((s) => [s, s + ' *']).join(',') + '{visibility:visible!important}';
  document.head.append(style);
  const masked = () => {
    const widget = document.querySelector(KEEP);
    const other = [...document.body.querySelectorAll(':scope > *')].find((el) => el !== widget && !el.contains(widget));
    return !!other && getComputedStyle(other).visibility === 'hidden';
  };
  if (!masked()) {
    document.querySelectorAll('*').forEach((el) => {
      if (keep(el) || el.id === 'ms-e2e-privacy') return;
      el.setAttribute('data-ms-e2e-hidden', '');
      el.style.setProperty('visibility', 'hidden', 'important');
    });
  }
  return masked();
})()`;
const PRIVACY_UNMASK = `(() => {
  document.querySelector('#ms-e2e-privacy')?.remove();
  document.querySelectorAll('[data-ms-e2e-hidden]').forEach((el) => { el.style.removeProperty('visibility'); el.removeAttribute('data-ms-e2e-hidden'); });
})()`;

function screenshot(name) {
  const file = resolve(artifacts, `${name}.png`);
  if (live) {
    const masked = evaluate(PRIVACY_MASK);
    assert.equal(masked, true, 'live screenshot refused: the privacy mask did not hide the page');
  }
  try { ab('screenshot', file); }
  finally { if (live) evaluate(PRIVACY_UNMASK); }
  return file;
}
function storage(code) {
  try { open(options); ab('wait', '#enabled'); }
  catch { throw new Error('The unpacked extension options page did not load: the extension is not active in this browser session.'); }
  return evaluate(code);
}
function configure(settings) { storage(`chrome.storage.local.set({settings:${JSON.stringify(settings)},'activity-log':[],'retry-queue':[]})`); }
function events() { return storage("chrome.storage.local.get(['activity-log','retry-queue']).then(x=>({recent:x['activity-log']||[],pending:x['retry-queue']||[]}))"); }

function pollUntil(read, accept, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    last = read();
    if (accept(last)) return last;
    if (Date.now() >= deadline) throw new Error(`${label}: condition not reached in ${timeoutMs}ms; last observed ${JSON.stringify(last)}`);
    wait(250);
  }
}

function check(assertions, name, expected, observed) {
  const ok = isDeepStrictEqual(expected, observed);
  assertions.push({ check: name, expected, observed, ok });
  assert.ok(ok, `${name}: expected ${JSON.stringify(expected)}, observed ${JSON.stringify(observed)}`);
}

async function startFixtureServer() {
  const code = [
    "const http=require('node:http');",
    "const fs=require('node:fs');",
    "const html=fs.readFileSync(process.argv[1]);",
    "const server=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html)});",
    "server.listen(0,'127.0.0.1',()=>process.stdout.write(String(server.address().port)+'\\n'));",
  ].join('');
  const child = spawn(process.execPath, ['-e', code, resolve(root, 'tests/e2e/player.html')], { stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '';
  child.stderr.on('data', (chunk) => { errors += chunk; });
  const port = await new Promise((done, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`fixture server did not report a port: ${errors.trim()}`)), 10000);
    child.stdout.on('data', (chunk) => {
      out += chunk;
      const line = out.split('\n')[0].trim();
      if (/^\d+$/.test(line)) { clearTimeout(timer); done(Number(line)); }
    });
    child.once('error', (error) => { clearTimeout(timer); reject(new Error(`fixture server failed: ${error.message}`)); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`fixture server exited early with code ${code}: ${errors.trim()}`)); });
  });
  return { child, port };
}

function act(step) {
  if (step.act === 'toggle-play') return ab('click', '#play');
  if (step.act === 'wait') return wait(step.ms);
  if (step.act === 'seek') return evaluate(`fixture.seek(${Number(step.ms)})`);
  if (step.act === 'ad') return evaluate(`fixture.ad(${step.on})`);
  if (step.act === 'track') return evaluate(`fixture.track(${JSON.stringify(step.id)})`);
  if (step.act === 'recover') return evaluate('fixture.recover()');
  if (step.act === 'undo') return ab('find', 'role', 'button', 'click', '--name', 'Undo');
  throw new Error(`unknown step ${step.act}`);
}

function fixtureCase(scenario, port) {
  const trackId = scenario.id.replace(/-/g, '');
  const fail = scenario.fail && scenario.fail !== 'none' ? `&fail=${scenario.fail}` : '';
  configure(scenario.settings);
  open(`http://127.0.0.1:${port}/?id=${trackId}&liked=${scenario.liked}${fail}`);
  ab('wait', '#play');
  for (const step of scenario.steps) act(step);
  const state = evaluate('fixture.state()');
  const shot = relative(root, screenshot(scenario.id));
  const observed = events();
  const assertions = [];
  check(assertions, 'activity-log', scenario.expected, observed.recent.map((event) => event.kind));
  if (scenario.tracks) check(assertions, 'track-ids', scenario.tracks, observed.recent.map((event) => event.trackId));
  check(assertions, 'liked-state', finalLiked(scenario.liked, scenario.expected), state.liked);
  const control = {};
  for (const key of Object.keys(scenario.expect)) control[key] = key === 'opens' ? state.opens : state.saves;
  check(assertions, 'like-control', scenario.expect, control);
  check(assertions, 'retry-queue', scenario.retry ?? 0, observed.pending.length);
  assertions.push({ check: 'screenshot', path: shot, ok: true });
  return { id: scenario.id, mode: scenario.mode, status: 'passed', assertions };
}

function settingsCase() {
  const assertions = [];
  configure({ thresholdRatio: 0.9, minSoundedMs: 60000, enabled: true });
  open(options);
  ab('wait', '#enabled');
  pollUntil(
    () => evaluate("[document.querySelector('#threshold').value,document.querySelector('#floor').value,document.querySelector('#enabled').checked]"),
    (values) => values[0] === '90' && values[1] === '60' && values[2] === true,
    'options page loaded its settings',
  );
  const readControls = () => evaluate("[document.querySelector('#threshold').value,document.querySelector('#floor').value,document.querySelector('#enabled').checked]");
  // fill fires input only; the options page listens for change, which the blur
  // a Tab produces commits through the same path a person uses.
  ab('fill', '#threshold', '50');
  ab('press', 'Tab');
  ab('fill', '#floor', '2');
  ab('press', 'Tab');
  ab('click', '#enabled');
  ab('press', 'Tab');
  const controls = pollUntil(
    readControls,
    (values) => values[0] === '50' && values[1] === '2' && values[2] === false,
    'settings inputs hold the typed values after blur',
  );
  const expectedSettings = { thresholdRatio: 0.5, minSoundedMs: 2000, enabled: false };
  const stored = pollUntil(
    () => evaluate("chrome.storage.local.get('settings').then(x=>x.settings)"),
    (value) => isDeepStrictEqual(value, expectedSettings),
    'settings form persisted through the real inputs',
  );
  assertions.push({ check: 'settings-controls', expected: ['50', '2', false], observed: controls, ok: true });
  check(assertions, 'settings-form', expectedSettings, stored);
  storage(`chrome.storage.local.set({'activity-log':[{ts:Date.now(),kind:'save',trackId:'settingscase',detail:''}],'retry-queue':[{id:'settingscase',uri:'spotify:track:settingscase',kind:'save',attempts:0,nextDueMs:0,seq:0}]})`);
  open(options);
  ab('wait', '#enabled');
  const log = String(pollUntil(
    () => String(evaluate("document.querySelector('#activity-log').textContent")),
    (text) => text.includes('settingscase'),
    'activity log rendered',
  ));
  const queue = String(pollUntil(
    () => String(evaluate("document.querySelector('#retry-queue').textContent")),
    (text) => text.includes('settingscase'),
    'retry queue rendered',
  ));
  check(assertions, 'activity-log-render', true, log.includes('save') && log.includes('settingscase'));
  check(assertions, 'retry-queue-render', true, queue.includes('Retry now') && queue.includes('settingscase'));
  const shot = relative(root, screenshot('settings'));
  assertions.push({ check: 'screenshot', path: shot, ok: true });
  return { id: 'settings', mode: 'settings', status: 'passed', assertions };
}

const SAME_SITE = { strict: 'Strict', lax: 'Lax', none: 'None', no_restriction: 'None', unspecified: 'Lax' };

function normalizeCookie(cookie) {
  if (!cookie || typeof cookie.name !== 'string' || typeof cookie.value !== 'string') throw new Error('cookie entry needs name and value');
  if (!cookie.domain && !cookie.url) throw new Error('cookie entry needs a domain or url');
  const seconds = [cookie.expires, cookie.expirationDate].find((value) => Number.isFinite(Number(value)));
  const expires = seconds === undefined ? -1 : Number(seconds) > 1e12 ? Math.round(Number(seconds) / 1000) : Number(seconds);
  const sameSite = SAME_SITE[String(cookie.sameSite ?? '').toLowerCase()] || 'Lax';
  return {
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || '/',
    secure: cookie.secure !== false || sameSite === 'None',
    httpOnly: !!cookie.httpOnly,
    sameSite,
    ...(cookie.domain ? { domain: cookie.domain } : { url: cookie.url }),
    expires,
  };
}

function cookieReason(output) {
  if (/invalid cookie fields/i.test(output)) return 'invalid-fields';
  if (/connect|no page|target closed|session|launch/i.test(output)) return 'no-browser-context';
  return 'unclassified';
}

// The CLI prints its own JSON on a failed set. Keep the failure class only, so a
// cookie value can never reach a log, an error, or an artifact.
function tryCookieBatch(cookies) {
  const file = resolve(work, 'cookies.json');
  writeFileSync(file, JSON.stringify(cookies), { mode: 0o600 });
  try {
    const raw = execFileSync('agent-browser', [...flags, 'cookies', 'set', '--curl', file], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
    const result = JSON.parse(raw);
    return result.success === false ? { ok: false, reason: cookieReason(String(result.error || '')) } : { ok: true };
  } catch (error) {
    return { ok: false, reason: cookieReason(`${(error && error.stdout) || ''}${(error && error.stderr) || ''}`) };
  } finally {
    rmSync(file, { force: true });
  }
}

// Names, counts, scope, and expiry class only. Values never leave this function.
function seedCookies(file) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.cookies) ? raw.cookies : null;
  if (!list || !list.length) throw new Error('Spotify cookie file contains no cookies');
  const cookies = list.map(normalizeCookie);
  const nowSeconds = Date.now() / 1000;
  const details = cookies.map((cookie) => ({
    name: cookie.name,
    sameSite: cookie.sameSite,
    expiry: cookie.expires < 0 ? 'session' : cookie.expires <= nowSeconds ? 'past' : 'future',
    scope: cookie.domain ? 'domain' : 'url',
  }));
  const sp = details.find((cookie) => cookie.name === 'sp_dc');
  if (!sp) throw new Error(`dedicated Spotify session cookie sp_dc is missing (names: ${details.map((cookie) => cookie.name).join(',')})`);
  const batch = tryCookieBatch(cookies);
  if (batch.ok) return { total: cookies.length, accepted: cookies.length, rejected: [], spDc: sp, batch: 'accepted' };
  // One rejected record must not lose the whole session. Retry singly, keep the
  // accepted cookies, and let the authenticated-page wait decide the outcome.
  let accepted = 0;
  const rejected = [];
  for (const cookie of cookies) {
    const result = tryCookieBatch([cookie]);
    if (result.ok) accepted += 1;
    else rejected.push(`${cookie.name}:${result.reason}`);
  }
  if (rejected.some((entry) => entry.startsWith('sp_dc:'))) {
    throw new Error(`the sp_dc session cookie was not accepted (expiry ${sp.expiry}, sameSite ${sp.sameSite}, batch ${batch.reason}); rejected ${rejected.join(' ')}`);
  }
  if (!accepted) throw new Error(`no Spotify cookie was accepted (batch ${batch.reason}); rejected ${rejected.join(' ')}`);
  return { total: cookies.length, accepted, rejected, spDc: sp, batch: batch.reason };
}

// Booleans and fixed enums only. Never page text, titles, cookies, or profile data.
function liveDiagnostics(track, step) {
  try {
    return {
      step,
      ...evaluate(`(() => {
        const has = (selector) => !!document.querySelector(selector);
        const play = document.querySelector('[data-testid="control-button-playpause"]');
        const anchor = document.querySelector('[data-testid="now-playing-widget"] a[href*="track"], a[data-testid="context-link"][data-context-item-type="track"]');
        const href = anchor ? String(anchor.getAttribute('href') || '') : '';
        const text = String(document.body ? document.body.innerText : '').toLowerCase();
        return {
          authenticated: !has('[data-testid="login-button"]') && (has('[data-testid="user-widget-link"]') || has('[data-testid="user-widget-avatar"]')),
          playButton: has('[data-testid="play-button"]'),
          playPauseReadable: !!play,
          playing: !!play && play.getAttribute('aria-label') === 'Pause',
          trackInNowPlaying: href.includes(${JSON.stringify(track)}),
          progressReadable: Number.isFinite(Number(document.querySelector('[data-testid="playback-progressbar"] input')?.value)),
          premiumOrUnavailable: ['premium', "can't play", 'not available', 'upgrade'].some((phrase) => text.includes(phrase)),
          page: location.pathname.startsWith('/track/') ? 'track' : location.pathname === '/' ? 'home' : 'other',
        };
      })()`),
    };
  } catch {
    return { step, diagnostics: 'unreadable' };
  }
}

function liveBlocker(d) {
  if (!d || d.diagnostics === 'unreadable') return 'browser-state-unreadable';
  if (!d.authenticated) return 'authentication';
  if (d.premiumOrUnavailable) return 'playback-unsupported';
  if (!d.playButton) return 'selector-mismatch';
  if (!d.playPauseReadable) return 'selector-mismatch';
  if (!d.playing) return 'playback-not-started';
  if (!d.trackInNowPlaying) return 'selector-mismatch';
  return 'unknown';
}

async function runFixture(results) {
  const server = await startFixtureServer();
  try {
    open('about:blank');
    results.push(settingsCase());
    console.log('PASS fixture settings');
    for (const scenario of scenarios) {
      try {
        results.push(fixtureCase(scenario, server.port));
        console.log(`PASS fixture ${scenario.id}`);
      } catch (error) {
        results.push({ id: scenario.id, mode: scenario.mode, status: 'failed', error: error.message });
        process.exitCode = 1;
        console.error(`FAIL fixture ${scenario.id}: ${error.message}`);
      }
    }
  } finally {
    server.child.kill();
  }
}

async function runLive(results) {
  const track = assertLiveTrack(process.env.SPOTIFY_E2E_TRACK_ID);
  const step = { phase: 'boot', scenario: null, selector: null };
  step.phase = 'authentication';
  step.selector = 'spotify-origin';
  // CDP cookie writes need a real page: about:blank and a fresh session both
  // reject them as invalid cookie fields. Navigate first, then seed, then reload.
  open('https://open.spotify.com/');
  if (process.env.SPOTIFY_E2E_COOKIE_FILE) {
    const outcome = seedCookies(process.env.SPOTIFY_E2E_COOKIE_FILE);
    results.push({ id: 'cookie-seed', mode: 'live', status: 'passed', assertions: [{ check: 'cookie-import', expected: 'sp_dc accepted', observed: outcome, ok: true }] });
    console.log(`PASS live cookie-seed ${outcome.accepted}/${outcome.total} accepted, sp_dc ${outcome.spDc.expiry}, batch ${outcome.batch}`);
  }
  open('https://open.spotify.com/');
  step.selector = 'user-widget';
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

  step.phase = 'precondition';
  step.selector = 'now-playing-like-control';
  const initialLiked = await liked(null);
  let restore = async () => {
    configure({ enabled: false, thresholdRatio: 0.9, minSoundedMs: 60000 });
    open(url);
    ab('wait', likeButton);
    await liked(initialLiked);
    assert.equal(await liked(null), initialLiked, 'original liked state restored');
    storage(originalSettings === null ? "chrome.storage.local.remove('settings')" : `chrome.storage.local.set({settings:${JSON.stringify(originalSettings)}})`);
  };
  try {
    const settingsAssertions = [];
    check(settingsAssertions, 'settings-round-trip', { enabled: false, thresholdRatio: 0.9, minSoundedMs: 60000 }, storage("chrome.storage.local.get('settings').then(x=>x.settings)"));
    results.push({ id: 'settings', mode: 'settings', status: 'passed', assertions: settingsAssertions });
    console.log('PASS live settings');

    step.phase = 'playback';
    step.selector = 'playback-progressbar';
    open(url);
    ab('wait', '[data-testid="play-button"]');
    const durationMs = pollUntil(
      () => evaluate("Number(document.querySelector('[data-testid=\"playback-progressbar\"] input')?.max)"),
      (value) => Number.isFinite(value) && value > 0,
      'live song duration readable from the progress control',
    );
    // The ratio gates must separate inside the measured listen window, so the
    // suite proves each gate instead of assuming the seed song makes it true.
    assert(durationMs * 0.01 <= 6000, `song duration ${durationMs}ms cannot prove the reached ratio gate with 15s of playback; choose a seed song of 24s to 600s`);
    assert(durationMs * 0.95 > 22000, `song duration ${durationMs}ms cannot prove the unreached ratio gate with 15s of playback; choose a seed song of 24s to 600s`);
    results.push({ id: 'song-duration', mode: 'live', status: 'passed', durationMs, assertions: [{ check: 'duration-ms', expected: '>0 and 16s..600s', observed: durationMs, ok: true }] });
    console.log(`PASS live song duration ${durationMs}ms`);

    for (const startLiked of [false, true]) {
      for (const ratioReached of [false, true]) {
        for (const floorReached of [false, true]) {
          const name = `${startLiked ? 'liked' : 'unliked'}-ratio-${ratioReached}-floor-${floorReached}`;
          step.phase = 'precondition';
          step.scenario = name;
          step.selector = 'now-playing-like-control';
          configure({ enabled: false, thresholdRatio: 0.01, minSoundedMs: 60000 });
          open(url);
          ab('wait', likeButton);
          await liked(startLiked);
          assert.equal(await liked(null), startLiked, `${name}: live precondition`);
          // A fresh content-script document prevents sounded credit leaking across cases.
          step.phase = 'playback';
          step.selector = 'now-playing-progress';
          configure({ enabled: true, thresholdRatio: ratioReached ? 0.01 : 0.95, minSoundedMs: floorReached ? 6000 : 3600000 });
          open(url);
          ab('wait', '[data-testid="play-button"]');
          const paused = evaluate("document.querySelector('[data-testid=\"control-button-playpause\"]')?.getAttribute('aria-label')!=='Pause'");
          if (paused) ab('click', '[data-testid="play-button"]');
          ab('wait', '--fn', `!!document.querySelector('[data-testid="now-playing-widget"] a[href*="${track}"]') && document.querySelector('[data-testid="control-button-playpause"]')?.getAttribute('aria-label')==='Pause'`);
          const startPosition = evaluate("Number(document.querySelector('[data-testid=\"playback-progressbar\"] input')?.value)");
          assert(Number.isFinite(startPosition), `${name}: live progress control readable`);
          wait(15000);
          step.phase = 'assertion';
          step.selector = 'liked-state';
          const endPosition = evaluate("Number(document.querySelector('[data-testid=\"playback-progressbar\"] input')?.value)");
          const progressMs = endPosition - startPosition;
          const thresholdMs = Math.max(durationMs * (ratioReached ? 0.01 : 0.95), floorReached ? 6000 : 3600000);
          const eligible = ratioReached && floorReached;
          const expected = eligible ? (startLiked ? 'skip' : 'save') : null;
          const after = await liked(null);
          const shot = relative(root, screenshot(name));
          const observed = events();
          const assertions = [];
          check(assertions, 'measured-progress', true, progressMs > 0);
          check(assertions, 'ratio-gate', ratioReached, progressMs >= durationMs * 0.01);
          check(assertions, 'floor-gate', floorReached, progressMs >= 6000);
          check(assertions, 'gate-threshold', eligible, progressMs >= thresholdMs);
          check(assertions, 'liked-state', startLiked || eligible, after);
          check(assertions, 'activity-log', expected ? [expected] : [], observed.recent.map((event) => event.kind));
          check(assertions, 'retry-queue', 0, observed.pending.length);
          assertions.push({ check: 'screenshot', path: shot, ok: true });
          results.push({ id: name, mode: 'live', status: 'passed', startLiked, ratioReached, floorReached, durationMs, thresholdMs, progressMs, assertions });
          console.log(`PASS live ${name} progress=${progressMs}ms threshold=${Math.round(thresholdMs)}ms`);
        }
      }
    }
  } catch (error) {
    const diagnostics = liveDiagnostics(track, { ...step });
    const blocker = liveBlocker(diagnostics);
    results.push({ status: 'failed', error: error.message, blocker, phase: step.phase, scenario: step.scenario, diagnostics });
    process.exitCode = 1;
    console.error(`live blocker: ${blocker} at ${step.phase}${step.scenario ? ` (${step.scenario})` : ''} selector ${step.selector}`);
    throw error;
  } finally {
    try { await restore(); }
    catch (error) { cleanupError ||= `account restore failed: ${error.message}`; process.exitCode = 1; }
  }
}

const results = [];
let cleanupError;
try {
  if (execFileSync('agent-browser', ['--version'], { encoding: 'utf8' }).trim() !== AGENT_BROWSER_PIN) {
    throw new Error(`agent-browser must be ${AGENT_BROWSER_PIN} for reproducible extension runs`);
  }
  await (live ? runLive(results) : runFixture(results));
} catch (error) {
  if (!results.some((entry) => entry.status === 'failed')) results.push({ status: 'failed', error: error.message });
  process.exitCode = 1;
  try { screenshot('failure'); } catch {}
  console.error(error.message);
} finally {
  try { ab('close'); } catch { cleanupError ||= 'browser close failed'; process.exitCode = 1; }
  const bundleSha256 = createHash('sha256').update(readFileSync(resolve(root, 'extension/content.bundle.js'))).digest('hex');
  const passed = process.exitCode !== 1 && !cleanupError && results.length > 0 && results.every((entry) => entry.status === 'passed');
  writeFileSync(resolve(artifacts, 'results.json'), JSON.stringify({
    mode,
    bundleSha256,
    agentBrowser: AGENT_BROWSER_PIN,
    scenarioCount: results.length,
    passed,
    failed: results.filter((entry) => entry.status !== 'passed').map((entry) => entry.id || 'run'),
    results,
    cleanupError: cleanupError || null,
    timestamp: new Date().toISOString(),
  }, null, 2));
  if (!passed) process.exitCode = 1;
  rmSync(work, { recursive: true, force: true });
}
