import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const policy = readFileSync(new URL('.github/workflows/trusted-pr-policy.yml', root), 'utf8');

function trigger(name) {
  const lines = policy.split('\n');
  const start = lines.findIndex(line => line.trimStart().startsWith(`${name}:`));
  assert.notEqual(start, -1, `trusted-pr-policy.yml has no ${name} trigger`);
  const indent = lines[start].search(/\S/);
  return lines.slice(start + 1).filter(line => !line.trim() || line.search(/\S/) > indent).join('\n');
}

test('the policy re-runs when a gate it requires completes', () => {
  const gates = ['pr-ready'].map(name =>
    readFileSync(new URL(`.github/workflows/${name}.yml`, root), 'utf8').match(/^name: (.+)$/m)[1].trim());
  const run = trigger('workflow_run');
  assert.match(run, /types: \[completed\]/, 'the re-run must fire when the gate completes');
  for (const gate of gates) {
    assert.ok(run.includes(gate), `${gate} completion must re-run the policy, or a failed verdict stays red`);
  }
});
