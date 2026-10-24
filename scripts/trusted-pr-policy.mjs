import { createHash } from 'node:crypto';

const headings = ['Summary', 'Validation', 'Risks / Notes', 'Breaking changes', 'Visual summary'];
const conventional = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^\r\n]+\))?!?: .+/;

function visibleLines(body) {
  let fence;
  const lines = [];
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!fence && match) fence = match[1];
    else if (fence && match && match[1][0] === fence[0] && match[1].length >= fence.length && !match[2].trim()) fence = undefined;
    else if (!fence) lines.push(line);
  }
  return lines;
}

export function evaluate(data, policy) {
  const errors = [];
  const { pull } = data;
  if (pull.state !== 'open' || pull.draft) errors.push('PR must be open and not draft');
  if (!conventional.test(pull.title)) errors.push('PR title must follow Conventional Commits');
  const lines = visibleLines(pull.body || '');
  for (const heading of headings) {
    if (!lines.includes(`## ${heading}`)) errors.push(`Missing heading: ${heading}`);
  }
  if (!data.commits.length) errors.push('PR has no readable commits');
  for (const commit of data.commits) {
    if (commit.parents.length > 1) continue;
    const [subject, ...body] = commit.commit.message.split(/\r?\n/);
    if (!conventional.test(subject)) errors.push(`${commit.sha}: commit subject must follow Conventional Commits`);
    if (!body.join('\n').trim()) errors.push(`${commit.sha}: commit body is required`);
  }
  for (const [path, hashes] of Object.entries(policy.files)) {
    const text = data.files[path];
    if (typeof text !== 'string' || !hashes.includes(createHash('sha256').update(text).digest('hex'))) {
      errors.push(`${path}: content does not match approved policy`);
    }
  }
  let scripts;
  try { scripts = JSON.parse(data.files['package.json']).scripts; } catch { /* Report the invalid package below. */ }
  const scriptKey = set => JSON.stringify(Object.entries(set || {}).sort());
  if (!policy.scripts.map(scriptKey).includes(scriptKey(scripts))) {
    errors.push('package scripts do not match approved policy');
  }
  for (const required of policy.checks) {
    let run;
    if (required.path) {
      run = data.runs.filter(run => run.path === required.path && ['pull_request', 'pull_request_review'].includes(run.event)
        && run.repository?.full_name === pull.base.repo.full_name && run.head_sha === pull.head.sha
        && run.pull_requests?.some(pr => pr.number === pull.number))
        .sort((a, b) => b.id - a.id || (b.run_attempt || 1) - (a.run_attempt || 1))[0];
      if (!run || run.status !== 'completed' || run.conclusion !== 'success') {
        errors.push(`${required.context}: untrusted or unsuccessful workflow provenance`);
        continue;
      }
    }
    const check = data.checks.filter(check => check.name === required.context && check.app?.id === required.app
      && check.head_sha === pull.head.sha && (!run || check.check_suite?.id === run.check_suite_id))
      .sort((a, b) => b.id - a.id)[0];
    if (!check || check.status !== 'completed' || check.conclusion !== 'success') {
      errors.push(`${required.context}: missing successful exact-head check from App ${required.app}`);
    }
  }
  return errors;
}
