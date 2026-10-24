import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const policy = JSON.parse(readFileSync(new URL('scripts/trusted-pr-policy.json', root), 'utf8'));
const rollup = readFileSync(new URL('scripts/check-ready-rollup.sh', root), 'utf8');

function rolledUpContexts() {
  const line = rollup.split('\n').find(entry => entry.startsWith('REQUIRED="'));
  assert.ok(line, 'check-ready-rollup.sh declares REQUIRED');
  return line.slice('REQUIRED="'.length, -1).split(' ').map(pair => {
    const [context, path] = pair.split(':');
    return { context, path };
  });
}

test('approved policy hashes match the committed files', () => {
  for (const [path, hashes] of Object.entries(policy.files)) {
    const digest = createHash('sha256').update(readFileSync(new URL(path, root))).digest('hex');
    assert.ok(hashes.includes(digest), `${path} content does not match the approved policy hash`);
  }
});

test('package.json scripts match one approved script set', () => {
  const { scripts } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  const key = set => JSON.stringify(Object.entries(set).sort());
  assert.ok(Array.isArray(policy.scripts) && policy.scripts.length > 0, 'policy.scripts is a nonempty list of approved sets');
  assert.ok(policy.scripts.map(key).includes(key(scripts)), 'package.json scripts match an approved set');
});

test('every policy check names a workflow file that defines its job', () => {
  for (const check of policy.checks) {
    if (!check.path) continue;
    const workflow = readFileSync(new URL(check.path, root), 'utf8');
    assert.match(workflow, new RegExp(`^  ${check.context.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:$`, 'm'),
      `${check.path} has no job named ${check.context}`);
  }
});

test('the ready rollup requires policy contexts with the same workflow paths', () => {
  const contexts = rolledUpContexts();
  assert.ok(contexts.length > 0);
  assert.ok(!contexts.some(entry => entry.context === 'ready'), 'ready cannot wait on itself');
  for (const entry of contexts) {
    const approved = policy.checks.find(check => check.context === entry.context);
    assert.ok(approved, `${entry.context} is not in the approved check set`);
    assert.equal(approved.path, entry.path, `${entry.context} workflow path drifted from the approved policy`);
  }
});
