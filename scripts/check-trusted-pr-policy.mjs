import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL, URL } from 'node:url';
import { evaluate } from './trusted-pr-policy.mjs';

export async function inspect({ api, repo, number, policy }) {
  const root = `/repos/${repo}`;
  async function pages(path, key) {
    const rows = [];
    for (let page = 1; ; page++) {
      const result = await api(`${root}${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      const values = key ? result[key] : result;
      if (!Array.isArray(values)) throw new Error('Unreadable paginated GitHub response');
      rows.push(...values);
      if (values.length < 100) return rows;
    }
  }
  const pull = await api(`${root}/pulls/${number}`);
  if (pull.base.repo.full_name !== repo || !/^[a-f0-9]{40}$/.test(pull.head.sha)) throw new Error('Unexpected PR repository or head');
  const files = {};
  for (const path of [...Object.keys(policy.files), 'package.json']) {
    try {
      const blob = await api(`${root}/contents/${path}?ref=${pull.head.sha}`);
      if (blob.encoding !== 'base64' || typeof blob.content !== 'string') throw new Error(`Unreadable file: ${path}`);
      files[path] = Buffer.from(blob.content, 'base64').toString('utf8');
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
  const commits = await pages(`/pulls/${number}/commits`);
  if (commits.length !== pull.commits) throw new Error('Incomplete commit list or changed PR');
  const checks = await pages(`/commits/${pull.head.sha}/check-runs?filter=all`, 'check_runs');
  const runs = await pages(`/actions/runs?head_sha=${pull.head.sha}`, 'workflow_runs');
  const fresh = await api(`${root}/pulls/${number}`);
  const identity = pr => JSON.stringify([pr.head.sha, pr.base.sha, pr.title, pr.body, pr.draft, pr.state, pr.updated_at]);
  if (identity(pull) !== identity(fresh)) throw new Error('PR changed during evaluation; rerun the policy');
  return { head: pull.head.sha, errors: evaluate({ pull, files, commits, checks, runs }, policy) };
}

function parseBody(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function errorMessage(response, text) {
  const body = parseBody(text);
  if (typeof body?.message === 'string' && body.message) return body.message;
  return text.trim() || response.statusText || 'no response body';
}

const RATE_LIMIT_BACKOFF_MS = 30000;

function rateLimitReset(response, message, now) {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return now + retryAfter * 1000;
  if (!/rate limit/i.test(message) && response.headers.get('x-ratelimit-remaining') !== '0') return 0;
  const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
  return Number.isFinite(reset) && reset > now ? reset : now + RATE_LIMIT_BACKOFF_MS;
}

export function createApi({ token, deadline, wait = delay, now = Date.now }) {
  return async function api(path, options = {}) {
    const method = options.method ?? 'GET';
    for (;;) {
      const at = now();
      let response;
      try {
        response = await globalThis.fetch(`https://api.github.com${path}`, {
          ...options,
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
        });
      } catch (error) {
        throw Object.assign(new Error(`${method} ${path} failed: ${error.message}`), { method, path });
      }
      if (response.ok) return response.json();
      const message = errorMessage(response, await response.text());
      const resetAt = rateLimitReset(response, message, at);
      if (resetAt && resetAt <= deadline) {
        await wait(resetAt - at);
        continue;
      }
      const detail = resetAt ? `${message} (the rate limit resets at ${new Date(resetAt).toISOString()})` : message;
      throw Object.assign(new Error(`${method} ${path} failed with ${response.status}: ${detail}`), {
        status: response.status, method, path, githubMessage: message, rateResetAt: resetAt || null,
        rateLimited: resetAt > 0,
      });
    }
  };
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const number = Number(process.env.PR_NUMBER);
  if (repo !== 'komaksym/music-saver' || !Number.isSafeInteger(number) || number < 1) throw new Error('Expected music-saver and a positive PR number');
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error('GH_TOKEN is required');
  const policy = JSON.parse(await readFile(new URL('./trusted-pr-policy.json', import.meta.url), 'utf8'));
  const publish = process.argv.includes('--publish');
  const deadline = Date.now() + (publish ? 720000 : 0);
  const api = createApi({ token, deadline });
  let head;
  const status = (state, description) => api(`/repos/${repo}/statuses/${head}`, {
    method: 'POST', body: JSON.stringify({ state, context: 'trusted-pr-policy', description,
      target_url: `https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}` }),
  });
  try {
    if (publish) {
      head = (await api(`/repos/${repo}/pulls/${number}`)).head.sha;
      await status('pending', 'Evaluate metadata and workflow provenance');
    }
    let result;
    do {
      result = await inspect({ api, repo, number, policy });
      if (head && result.head !== head) throw new Error('PR head changed; a new evaluation must run');
      head = result.head;
      console.log(JSON.stringify(result));
      if (!result.errors.length || !publish || Date.now() >= deadline) break;
      await delay(20000);
    } while (Date.now() < deadline);
    if (publish) await status(result.errors.length ? 'failure' : 'success', result.errors.length ? 'Policy rejected; inspect the workflow log' : 'Metadata and approved workflow provenance pass');
    if (result.errors.length) process.exitCode = 1;
  } catch (error) {
    if (publish && head) {
      const description = error.rateLimited
        ? `GitHub API rate limit; the reset is ${new Date(error.rateResetAt).toISOString()}`
        : 'Policy evaluation failed; rerun after resolving the error';
      try {
        await status('failure', description);
      } catch (postError) {
        console.error(`Could not post the failure status: ${postError.message}`);
      }
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
