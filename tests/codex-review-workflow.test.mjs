import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import resolveReviewPR from '../.github/scripts/resolve-review-pr.cjs';

const sha = 'a'.repeat(40);
const base = 'b'.repeat(40);
const root = new URL('../', import.meta.url);
function fixture() {
  const pr = { number: 44, state: 'open', draft: false, title: 'external PR', body: 'untrusted',
    base: { sha: base, repo: { full_name: 'qiniu/coding-helper' } },
    head: { sha, ref: 'feature', repo: { id: 22 } } };
  const run = { id: 1, run_attempt: 2, event: 'pull_request', head_sha: sha, head_branch: 'feature',
    head_repository: { id: 22 }, repository: { full_name: 'qiniu/coding-helper' },
    path: '.github/workflows/codex-pr-review.yml', pull_requests: [] };
  const outputs = {};
  const calls = [];
  const github = {
    rest: { repos: { listPullRequestsAssociatedWithCommit: 'associated' },
      pulls: { get: async () => ({ data: pr }) },
      actions: { listJobsForWorkflowRunAttempt: 'jobs' } },
    paginate: async (method, args) => {
      calls.push({ method, args });
      return method === 'associated' ? [{ number: 44 }] : [{ name: 'Collect review evidence',
        steps: [{ name: 'Run unit tests', conclusion: 'failure' },
          { name: 'Run interactive terminal check', conclusion: 'success' }] }];
    },
  };
  return { pr, run, outputs, calls, args: { github,
    context: { repo: { owner: 'qiniu', repo: 'coding-helper' }, payload: { workflow_run: run } },
    core: { setOutput: (k, v) => { outputs[k] = v; }, notice() {} } } };
}
async function isolated(fn) {
  const previous = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), 'review-workflow-'));
  try { process.chdir(dir); await fn(); } finally { process.chdir(previous); rmSync(dir, { recursive: true }); }
}

test('fork PR resolves without payload pull_requests and preserves failed tests', async () => isolated(async () => {
  const f = fixture();
  await resolveReviewPR(f.args);
  assert.deepEqual(f.outputs, { number: '44', base, head: sha, unit_tests: 'failure', interactive_tests: 'success' });
  assert.equal(f.calls[1].args.attempt_number, 2);
  assert.equal(JSON.parse(readFileSync('pr-review.json')).title, 'external PR');
}));
for (const [name, change] of [
  ['stale head', f => { f.pr.head.sha = 'c'.repeat(40); }],
  ['wrong fork', f => { f.pr.head.repo.id = 99; }],
  ['closed PR', f => { f.pr.state = 'closed'; }],
  ['draft PR', f => { f.pr.draft = true; }],
]) {
  test(`skips ${name}`, async () => {
    const f = fixture(); change(f); await resolveReviewPR(f.args); assert.deepEqual(f.outputs, {});
  });
}
test('rejects evidence from an unexpected workflow', async () => {
  const f = fixture(); f.run.path = '.github/workflows/evil.yml';
  await assert.rejects(resolveReviewPR(f.args), /Unexpected evidence/);
});
test('missing test evidence is unavailable', async () => isolated(async () => {
  const f = fixture();
  const paginate = f.args.github.paginate;
  f.args.github.paginate = (method, args) => method === 'jobs' ? [] : paginate(method, args);
  await resolveReviewPR(f.args);
  assert.equal(f.outputs.unit_tests, 'unavailable');
}));
test('workflow separates untrusted execution from secrets and feedback writes', () => {
  const load = path => yaml.load(readFileSync(new URL(path, root), 'utf8'));
  const evidence = load('.github/workflows/codex-pr-review.yml');
  const review = load('.github/workflows/codex-pr-review-feedback.yml');
  assert.ok(evidence.on.pull_request);
  assert.deepEqual(evidence.permissions, { contents: 'read' });
  assert.equal(JSON.stringify(evidence).includes('secrets.'), false);
  assert.deepEqual(review.on.workflow_run.workflows, [evidence.name]);
  assert.equal(review.jobs.review.permissions['pull-requests'], 'read');
  assert.equal(review.jobs.feedback.permissions['pull-requests'], 'write');
  const steps = review.jobs.review.steps;
  assert.equal(steps.find(s => s.uses?.startsWith('actions/checkout')).with.ref, '${{ github.sha }}');
  const codex = steps.find(s => s.id === 'codex');
  assert.equal(codex.with['allow-users'], '*');
  assert.equal(codex.with['safety-strategy'], 'drop-sudo');
  assert.equal(codex.with.sandbox, 'read-only');
  assert.ok(!review.jobs.feedback.steps.some(s => s.uses?.startsWith('actions/checkout')));
});
test('feedback skips updated PR and posts with write client for current PR', async () => {
  const workflow = yaml.load(readFileSync(new URL('.github/workflows/codex-pr-review-feedback.yml', root), 'utf8'));
  const script = workflow.jobs.feedback.steps[0].with.script;
  const execute = new (Object.getPrototypeOf(async function() {}).constructor)('github', 'context', 'core', 'process', script);
  const comments = [];
  const github = { rest: { pulls: { get: async () => ({ data: { state: 'open', draft: false, head: { sha } } }) },
    issues: { listLabelsOnIssue: 'labels', createComment: async args => comments.push(args) } }, paginate: async () => [] };
  const context = { repo: { owner: 'qiniu', repo: 'coding-helper' } };
  const env = { PR_NUMBER: '44', PR_HEAD: base, CODEX_REVIEW_RESULT: 'success', CODEX_FINAL_MESSAGE: '结论：通过\n测试通过' };
  await execute(github, context, { notice() {} }, { env });
  assert.equal(comments.length, 0);
  env.PR_HEAD = sha;
  await execute(github, context, { notice() {} }, { env });
  assert.equal(comments[0].issue_number, 44);
  assert.match(comments[0].body, /结论：通过/);
});
