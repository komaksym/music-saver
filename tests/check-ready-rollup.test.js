import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/check-ready-rollup.sh', import.meta.url));
const sha = 'a'.repeat(40);
const repo = 'komaksym/music-saver';
const workflows = {
  ci: '.github/workflows/ci.yml',
  'pr-title': '.github/workflows/pr-title.yml',
  'pr-hygiene': '.github/workflows/pr-hygiene.yml',
  'commit-lint': '.github/workflows/commit-lint.yml',
  smoke: '.github/workflows/e2e-smoke.yml',
};
let nextId = 100;

function workflowRun(context, options = {}) {
  const id = options.id ?? nextId++;
  return {
    id,
    run_attempt: options.attempt ?? 1,
    check_suite_id: options.suite ?? id,
    head_sha: options.head ?? sha,
    path: options.path ?? workflows[context],
    event: options.event ?? 'pull_request',
    status: options.status ?? 'completed',
    conclusion: options.conclusion ?? 'success',
    repository: { full_name: options.repository ?? repo },
    pull_requests: [{ number: options.pr ?? 1 }],
  };
}

function checkRun(context, options = {}) {
  return {
    id: options.id ?? nextId++,
    name: options.name ?? context,
    head_sha: options.head ?? sha,
    status: options.status ?? 'completed',
    conclusion: options.conclusion ?? 'success',
    check_suite: { id: options.suite },
  };
}

function green() {
  const runs = [];
  const checks = [];
  for (const context of Object.keys(workflows)) {
    const run = workflowRun(context);
    runs.push(run);
    checks.push(checkRun(context, { suite: run.check_suite_id }));
  }
  return { runs, checks };
}

function commitStatus(context, options = {}) {
  return { id: options.id ?? nextId++, context, state: options.state ?? 'success' };
}

function fixture({ runs, checks, statuses = [] }) {
  const dir = mkdtempSync(join(tmpdir(), 'ready-rollup-'));
  writeFileSync(join(dir, 'runs.json'), JSON.stringify({ total_count: runs.length, workflow_runs: runs }));
  writeFileSync(join(dir, 'checks.json'), JSON.stringify({ total_count: checks.length, check_runs: checks }));
  writeFileSync(join(dir, 'statuses.json'), JSON.stringify(statuses));
  writeFileSync(join(dir, 'combined.json'), JSON.stringify({ state: 'none', statuses: [] }));
  writeFileSync(join(dir, 'gh'), `#!/usr/bin/env bash
set -euo pipefail
endpoint=''
program=''
want_jq=0
slurp=0
for arg in "$@"; do
  if [ "$want_jq" -eq 1 ]; then program="$arg"; want_jq=0; continue; fi
  case "$arg" in
    --jq|-q) want_jq=1 ;;
    --slurp) slurp=1 ;;
    repos/*) endpoint="$arg" ;;
  esac
done
body=''
case "$endpoint" in
  */actions/runs*) body="$(cat "$FIXTURES/runs.json")" ;;
  */check-runs*) body="$(cat "$FIXTURES/checks.json")" ;;
  */statuses*) body="$(cat "$FIXTURES/statuses.json")" ;;
  */status*) body="$(cat "$FIXTURES/combined.json")" ;;
  *) printf 'unexpected endpoint %s\\n' "$endpoint" >&2; exit 1 ;;
esac
if [ "$slurp" -eq 1 ]; then body="[$body]"; fi
if [ -n "$program" ]; then printf '%s' "$body" | jq -r "$program"; else printf '%s' "$body"; fi
`);
  chmodSync(join(dir, 'gh'), 0o755);
  return dir;
}

function rollup(input, pr = '1') {
  const dir = fixture(input);
  return spawnSync('bash', [script, sha, repo, '0', pr], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FIXTURES: dir },
  });
}

function assertReady(input) {
  const result = rollup(input);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /ready: all listed workflow contexts green/);
}

test('accepts newest eligible pull-request runs on the head', () => assertReady(green()));

test('ignores newer push runs on the same head', () => {
  for (const conclusion of ['success', 'failure', 'cancelled']) {
    const { runs, checks } = green();
    const push = workflowRun('ci', { event: 'push', conclusion });
    assertReady({ runs: [...runs, push], checks: [...checks, checkRun('ci', { suite: push.check_suite_id, conclusion })] });
  }
});

test('rejects an old pull-request success when the newest pull-request run is pending or failed', () => {
  for (const outcome of [{ status: 'in_progress', conclusion: null, expected: /PENDING/ },
    { status: 'completed', conclusion: 'failure', expected: /FAILED/ }]) {
    const { runs, checks } = green();
    const rerun = workflowRun('ci', { status: outcome.status, conclusion: outcome.conclusion });
    const result = rollup({ runs: [...runs, rerun], checks: [...checks, checkRun('ci', { suite: rerun.check_suite_id, status: outcome.status, conclusion: outcome.conclusion })] });
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, outcome.expected);
  }
});

test('rejects an old pull-request attempt when the newest attempt is pending or failed', () => {
  for (const outcome of [{ status: 'in_progress', conclusion: null }, { status: 'completed', conclusion: 'cancelled' }]) {
    const { runs, checks } = green();
    const second = workflowRun('ci', { attempt: 2, status: outcome.status, conclusion: outcome.conclusion });
    const result = rollup({ runs: [...runs, second], checks: [...checks, checkRun('ci', { suite: second.check_suite_id, status: outcome.status, conclusion: outcome.conclusion })] });
    assert.equal(result.status, 1, result.stdout);
  }
});

test('requires the named check from the selected pull-request suite', () => {
  const { runs, checks } = green();
  const push = workflowRun('ci', { event: 'push' });
  const withoutPrCheck = checks.filter(check => check.name !== 'ci');
  const result = rollup({ runs: [...runs, push], checks: [...withoutPrCheck, checkRun('ci', { suite: push.check_suite_id })] });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /PENDING/);
});

test('ignores runs from another pull request, repository, or workflow path', () => {
  const foreign = [
    workflowRun('ci', { pr: 2, conclusion: 'failure' }),
    workflowRun('ci', { repository: 'attacker/repo', conclusion: 'failure' }),
    workflowRun('ci', { path: '.github/workflows/other.yml', conclusion: 'failure' }),
  ];
  const { runs, checks } = green();
  for (const run of foreign) {
    assertReady({ runs: [...runs, run], checks: [...checks, checkRun('ci', { suite: run.check_suite_id, conclusion: 'failure' })] });
  }
});

test('requires a positive pull request number', () => {
  for (const pr of ['', '0', 'refs/pull/1/head']) {
    const result = rollup(green(), pr);
    assert.equal(result.status, 2, result.stdout);
  }
});

test('falls back to the newest commit status when no pull-request run exists', () => {
  const statuses = Object.keys(workflows).map(context => commitStatus(context));
  assertReady({ runs: [], checks: [], statuses });
  const failed = [...statuses, commitStatus('ci', { state: 'failure' })];
  const result = rollup({ runs: [], checks: [], statuses: failed });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /FAILED/);
});

test('requires the smoke context', () => {
  const { runs, checks } = green();
  const result = rollup({ runs: runs.filter(run => run.path !== workflows.smoke), checks: checks.filter(check => check.name !== 'smoke') });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /PENDING/);
});
