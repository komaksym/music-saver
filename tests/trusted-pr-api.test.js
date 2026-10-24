import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, inspect } from '../scripts/check-trusted-pr-policy.mjs';

const repo = 'komaksym/music-saver';
const sha = 'a'.repeat(40);
function fixture() {
  const pull = { number: 1, state: 'open', draft: false, title: 'fix: policy', commits: 1,
    body: ['Summary', 'Validation', 'Risks / Notes', 'Breaking changes', 'Visual summary'].map(h => `## ${h}\nContent.`).join('\n'),
    head: { sha }, base: { sha: 'b'.repeat(40), repo: { full_name: repo } }, updated_at: '2026-01-01' };
  const calls = [];
  const overrides = new Map();
  let reads = 0;
  const api = async path => {
    calls.push(path);
    for (const [part, value] of overrides) if (part === '/pulls/1' ? path.endsWith(part) : path.includes(part)) return typeof value === 'function' ? value() : value;
    if (path.endsWith('/pulls/1')) { reads++; return structuredClone(pull); }
    if (path.includes('/contents/')) return { encoding: 'base64', content: Buffer.from('{"scripts":{}}').toString('base64') };
    if (path.includes('/commits?')) return [{ sha, parents: [{}], commit: { message: 'fix: policy\n\nDetails.' } }];
    if (path.includes('/check-runs?')) return { check_runs: [] };
    if (path.includes('/actions/runs?')) return { workflow_runs: [] };
    throw new Error(`Unexpected API request: ${path}`);
  };
  return { pull, api, calls, overrides, readCount: () => reads,
    options: { api, repo, number: 1, policy: { files: {}, scripts: [{}], checks: [] } } };
}
test('reads metadata and blobs only and rereads the PR before returning success', async () => {
  const f = fixture();
  assert.deepEqual(await inspect(f.options), { head: sha, errors: [] });
  assert.equal(f.readCount(), 2);
  assert.ok(f.calls.some(path => path.includes(`/contents/package.json?ref=${sha}`)));
  assert.ok(f.calls.every(path => path.startsWith(`/repos/${repo}/`)));
});
test('paginates check runs instead of accepting the first 100', async () => {
  const f = fixture();
  f.overrides.set('/check-runs?', () => ({ check_runs: new URL(f.calls.at(-1), 'https://api.github.com').searchParams.get('page') === '1' ? Array.from({ length: 100 }, () => ({})) : [] }));
  await inspect(f.options);
  assert.ok(f.calls.some(path => path.includes('/check-runs?') && path.includes('page=2')));
});
test('fails closed on an unreadable API list', async () => {
  const f = fixture();
  f.overrides.set('/check-runs?', {});
  await assert.rejects(inspect(f.options), /Unreadable/);
});
test('rejects truncated PR commits and changed PR metadata', async () => {
  const f = fixture();
  f.pull.commits = 2;
  await assert.rejects(inspect(f.options), /Incomplete commit/);
  const g = fixture();
  let count = 0;
  g.overrides.set('/pulls/1', () => ({ ...g.pull, body: ++count === 1 ? g.pull.body : 'Edited after read.' }));
  await assert.rejects(inspect(g.options), /PR changed/);
});
test('rejects an unexpected repository or malformed head', async () => {
  const f = fixture();
  f.pull.base.repo.full_name = 'attacker/repo';
  await assert.rejects(inspect(f.options), /Unexpected PR/);
  const g = fixture();
  g.pull.head.sha = 'refs/heads/main';
  await assert.rejects(inspect(g.options), /Unexpected PR/);
});
test('propagates API permissions errors rather than treating them as missing policy', async () => {
  const f = fixture();
  f.overrides.set('/contents/', () => { const error = new Error('denied'); error.status = 403; throw error; });
  await assert.rejects(inspect(f.options), /denied/);
});

function reply(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: { get: name => headers[name.toLowerCase()] ?? null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  };
}

function stubFetch(t, replies) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method ?? 'GET' });
    if (!replies.length) throw new Error(`unexpected request ${options.method ?? 'GET'} ${url}`);
    return replies.shift();
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

test('reports the failing request and the message GitHub sent', async t => {
  stubFetch(t, [reply(403, { message: 'Resource not accessible by integration' })]);
  const api = createApi({ token: 'token' });
  await assert.rejects(api('/repos/o/r/statuses/abc', { method: 'POST', body: '{}' }), error => {
    assert.equal(error.status, 403);
    assert.equal(error.method, 'POST');
    assert.equal(error.path, '/repos/o/r/statuses/abc');
    assert.equal(error.message, 'POST /repos/o/r/statuses/abc failed with 403: Resource not accessible by integration');
    return true;
  });
});

function clock() {
  const start = 1_700_000_000_000;
  let current = start;
  const waited = [];
  return { start, waited, now: () => current, wait: async ms => { waited.push(ms); current += ms; } };
}

test('waits out an installation rate limit that resets inside the budget', async t => {
  const c = clock();
  const calls = stubFetch(t, [
    reply(403, { message: 'API rate limit exceeded for installation.' },
      { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String((c.start + 45000) / 1000) }),
    reply(200, { number: 23 }),
  ]);
  const api = createApi({ token: 'token', deadline: c.start + 720000, wait: c.wait, now: c.now });
  assert.deepEqual(await api('/repos/o/r/pulls/23'), { number: 23 });
  assert.equal(calls.length, 2);
  assert.deepEqual(c.waited, [45000]);
});

test('fails with the rate limit reason when the reset is past the budget', async t => {
  const c = clock();
  const calls = stubFetch(t, [
    reply(403, { message: 'API rate limit exceeded for installation.' },
      { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String((c.start + 3600000) / 1000) }),
  ]);
  const api = createApi({ token: 'token', deadline: c.start + 720000, wait: c.wait, now: c.now });
  await assert.rejects(api('/repos/o/r/pulls/23'), error => {
    assert.equal(error.rateLimited, true);
    assert.equal(error.rateResetAt, c.start + 3600000);
    assert.match(error.message, /^GET \/repos\/o\/r\/pulls\/23 failed with 403: API rate limit exceeded for installation\. \(the rate limit resets at 2023-11-14T23:13:20\.000Z\)$/);
    return true;
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(c.waited, []);
});

test('names the request when the connection fails before GitHub answers', async t => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('getaddrinfo ENOTFOUND api.github.com'); };
  t.after(() => { globalThis.fetch = original; });
  const c = clock();
  const api = createApi({ token: 'token', deadline: c.start + 60000, wait: c.wait, now: c.now });
  await assert.rejects(api('/repos/o/r/pulls/23'), /^Error: GET \/repos\/o\/r\/pulls\/23 failed: getaddrinfo ENOTFOUND api\.github\.com$/);
});
