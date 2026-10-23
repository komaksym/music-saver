import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { evaluate } from '../scripts/trusted-pr-policy.mjs';

const sha = 'a'.repeat(40);
const policy = {
  files: { '.github/workflows/ci.yml': [digest('approved workflow')], 'scripts/validator.sh': [digest('approved validator')] },
  scripts: { test: 'node --test tests/*.test.js' },
  checks: [{ context: 'ci', app: 15368, path: '.github/workflows/ci.yml' },
    { context: 'cubic · AI code reviewer', app: 1082092 }],
};
function digest(text) { return createHash('sha256').update(text).digest('hex'); }
function snapshot() {
  return {
    pull: { number: 1, state: 'open', draft: false, title: 'fix: preserve policy',
      body: '## Summary\nOne.\n## Validation\nTests.\n## Risks / Notes\nNone.\n## Breaking changes\nNone.\n## Visual summary\nImage.',
      head: { sha }, base: { repo: { full_name: 'komaksym/music-saver' } } },
    commits: [{ sha, parents: [{}], commit: { message: 'fix: preserve policy\n\nExplain the change.' } }],
    files: { '.github/workflows/ci.yml': 'approved workflow', 'scripts/validator.sh': 'approved validator',
      'package.json': JSON.stringify({ scripts: policy.scripts }) },
    checks: [
      { id: 2, name: 'ci', app: { id: 15368 }, head_sha: sha, status: 'completed', conclusion: 'success', check_suite: { id: 10 } },
      { id: 3, name: 'cubic · AI code reviewer', app: { id: 1082092 }, head_sha: sha, status: 'completed', conclusion: 'success' },
    ],
    runs: [{ id: 1, check_suite_id: 10, head_sha: sha, path: '.github/workflows/ci.yml', event: 'pull_request',
      repository: { full_name: 'komaksym/music-saver' }, pull_requests: [{ number: 1 }], status: 'completed', conclusion: 'success' }],
  };
}
function reject(change, expected) {
  const data = snapshot();
  change(data);
  assert.match(evaluate(data, policy).join('\n'), expected);
}
test('accepts strict metadata and approved exact-head workflow results', () => {
  assert.deepEqual(evaluate(snapshot(), policy), []);
});
test('rejects the old three-heading body', () => reject(d => {
  d.pull.body = '## Summary\nOne.\n## Validation\nTests.\n## Risks / Notes\nNone.';
}, /Breaking changes/));
test('rejects headings inside fenced examples', () => reject(d => {
  d.pull.body = '```markdown\n' + d.pull.body + '\n```';
}, /Summary/));
test('preserves PR8 presence-only headings, including empty sections and duplicate headings', () => {
  const data = snapshot();
  data.pull.body = data.pull.body.replace('Tests.', '') + '\n## Summary\nAgain.';
  assert.deepEqual(evaluate(data, policy), []);
});
test('rejects draft and nonconventional title', () => {
  reject(d => { d.pull.draft = true; }, /draft/);
  reject(d => { d.pull.title = 'Update policy'; }, /title/);
});
test('rejects nonmerge commits without conventional subjects or bodies', () => {
  reject(d => { d.commits[0].commit.message = 'fix: no body'; }, /body/);
  reject(d => { d.commits[0].commit.message = 'Update\n\nDetails.'; }, /subject/);
  reject(d => { d.commits[0].commit.message = 'fix: whitespace\n\n \t'; }, /body/);
});
test('does not lint merge commit messages', () => {
  const data = snapshot();
  data.commits[0] = { parents: [{}, {}], commit: { message: 'Merge branch' } };
  assert.deepEqual(evaluate(data, policy), []);
});
test('rejects weak workflows, validators, and package commands', () => {
  reject(d => { d.files['.github/workflows/ci.yml'] = 'echo success'; }, /approved policy/);
  reject(d => { delete d.files['scripts/validator.sh']; }, /approved policy/);
  reject(d => { d.files['package.json'] = '{"scripts":{"test":"true"}}'; }, /package scripts/);
});
test('rejects spoofed names from wrong apps or workflow paths', () => {
  reject(d => { d.checks[0].app.id = 9; }, /ci/);
  reject(d => { d.runs[0].path = '.github/workflows/spoof.yml'; }, /provenance/);
  reject(d => { d.runs[0].repository.full_name = 'attacker/repo'; }, /provenance/);
  reject(d => { d.runs[0].pull_requests = []; }, /provenance/);
  reject(d => { d.runs[0].event = 'workflow_dispatch'; }, /provenance/);
});
test('rejects stale, missing, pending, skipped, and neutral checks', () => {
  reject(d => { d.checks[0].head_sha = 'b'.repeat(40); }, /ci/);
  reject(d => { d.checks = []; }, /ci/);
  for (const conclusion of ['failure', 'cancelled', 'timed_out', 'skipped', 'neutral', 'stale', null]) {
    reject(d => { d.checks[0].conclusion = conclusion; }, /ci/);
  }
  reject(d => { d.checks[0].status = 'in_progress'; }, /ci/);
});
test('newest rerun must pass and cannot hide behind an older success', () => reject(d => {
  d.checks.push({ ...d.checks[0], id: 8, status: 'in_progress', conclusion: null });
}, /ci/));
test('rejects an unfinished or unsuccessful workflow behind a passing check', () => {
  reject(d => { d.runs[0].status = 'in_progress'; }, /provenance/);
  reject(d => { d.runs[0].conclusion = 'failure'; }, /provenance/);
});
test('newer push checks do not hide the valid pull-request workflow', () => {
  for (const conclusion of ['success', 'failure']) {
    const data = snapshot();
    data.runs.push({ ...data.runs[0], id: 9, check_suite_id: 90, event: 'push', conclusion });
    data.checks.push({ ...data.checks[0], id: 99, check_suite: { id: 90 }, conclusion });
    assert.deepEqual(evaluate(data, policy), []);
  }
});
test('newest PR run or attempt must pass even when an old PR run passed', () => {
  for (const conclusion of [null, 'failure']) {
    reject(d => {
      d.runs.push({ ...d.runs[0], id: 9, check_suite_id: 90, status: conclusion ? 'completed' : 'in_progress', conclusion });
    }, /ci.*provenance/);
    reject(d => {
      d.runs.push({ ...d.runs[0], run_attempt: 2, status: conclusion ? 'completed' : 'in_progress', conclusion });
    }, /ci.*provenance/);
  }
});
test('checks from another PR, head, or path cannot supply the required result', () => {
  reject(d => { d.runs[0].pull_requests = [{ number: 2 }]; }, /provenance/);
  reject(d => { d.runs[0].head_sha = 'b'.repeat(40); }, /provenance/);
  reject(d => { d.runs[0].path = '.github/workflows/other.yml'; }, /provenance/);
});
