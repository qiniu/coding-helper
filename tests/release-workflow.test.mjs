import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import release from '../.github/scripts/release.cjs';

const files = {
  'package.json': JSON.stringify({ name: 'qiniu-coding-helper', version: '0.5.0' }),
  'src/lib/version.ts': "export const VERSION = '0.5.0';",
  'CHANGELOG.md': '# Changelog\n\n## [0.5.0] - 2026-10-30\n\nNew features\n\n## [0.4.0] - 2026-01-01\nOld features',
};
function fixture() {
  const calls = [];
  const context = { repo: { owner: 'qiniu', repo: 'coding-helper' }, sha: 'base', eventName: 'pull_request',
    payload: { action: 'closed', pull_request: { number: 100, merged: true, merge_commit_sha: 'merged',
      base: { ref: 'main' }, head: { ref: 'release/v0.5.0', repo: { full_name: 'qiniu/coding-helper' } },
      labels: [{ name: 'release' }], body: '<!-- coding-helper-release: {"version":"0.5.0","prerelease":false} -->' } } };
  const state = { tag: null, pulls: [], branch: null, npm: null, existingRelease: null };
  const missing = () => { throw Object.assign(new Error('Not found'), { status: 404 }); };
  const response = value => ({ data: value });
  const record = (name, value) => async args => { calls.push([name, args]); return response(value); };
  const github = { rest: {
    pulls: { list: 'list', listFiles: 'files', create: record('pull', { number: 100, html_url: 'pr-url' }) },
    issues: { getLabel: async () => response({ name: 'release' }), createLabel: record('label', {}), addLabels: record('labels', {}) },
    git: {
      getRef: async ({ ref }) => ref === 'heads/main' ? response({ object: { sha: 'base' } }) :
        (ref.startsWith('tags/') ? state.tag : state.branch) ? response(ref.startsWith('tags/') ? state.tag : state.branch) : missing(),
      getCommit: async ({ commit_sha }) => response({ tree: { sha: commit_sha === 'base' ? 'base-tree' : 'tree' }, parents: [{ sha: 'base' }] }),
      createBlob: record('blob', { sha: 'blob' }), createTree: record('tree', { sha: 'tree' }),
      createCommit: record('commit', { sha: 'release-commit' }), createRef: record('ref', {}),
    },
    repos: { getReleaseByTag: async () => state.existingRelease ? response(state.existingRelease) : missing(),
      createRelease: record('release', { html_url: 'release-url' }) },
  }, paginate: async method => method === 'files' ? Object.keys(files).map(filename => ({ filename, status: 'modified' })) : state.pulls };
  return { github, context, calls, state, version: '0.5.0', prerelease: false,
    readFile: path => files[path], git: args => args[0] === 'rev-parse' ? 'merged' : '{"version":"0.4.0"}',
    fetchRegistry: async () => ({ status: state.npm ? 200 : 404, ok: Boolean(state.npm), json: async () => state.npm }) };
}

test('publishes only a merged, same-repository release PR with consistent versions', async () => {
  assert.deepEqual(await release.validateReleasePr(fixture()), { version: '0.5.0', prerelease: false });
});

for (const [name, mutate] of [
  ['closed without merge', f => { f.context.payload.pull_request.merged = false; }],
  ['ordinary PR', f => { f.context.payload.pull_request.head.ref = 'fix/bug'; }],
  ['fork', f => { f.context.payload.pull_request.head.repo.full_name = 'other/repo'; }],
  ['missing label', f => { f.context.payload.pull_request.labels = []; }],
  ['wrong base', f => { f.context.payload.pull_request.base.ref = 'develop'; }],
  ['wrong event', f => { f.context.eventName = 'workflow_dispatch'; }],
  ['wrong activity', f => { f.context.payload.action = 'opened'; }],
  ['missing metadata', f => { f.context.payload.pull_request.body = ''; }],
  ['wrong metadata', f => { f.context.payload.pull_request.body = '<!-- coding-helper-release: {"version":"0.6.0","prerelease":false} -->'; }],
  ['unmerged checkout', f => { f.git = () => 'head'; }],
  ['extra code changes', f => { f.github.paginate = async () => [{ filename: 'src/cli.ts', status: 'modified' }]; }],
  ['wrong CLI version', f => { f.readFile = path => path === 'src/lib/version.ts' ? "export const VERSION = '0.4.0';" : files[path]; }],
  ['wrong package version', f => { f.readFile = path => path === 'package.json' ? '{"version":"0.4.0"}' : files[path]; }],
  ['missing changelog', f => { f.readFile = path => path === 'CHANGELOG.md' ? '## [0.4.0]' : files[path]; }],
  ['stale version', f => { f.git = args => args[0] === 'rev-parse' ? 'merged' : '{"version":"0.6.0"}'; }],
]) test(`rejects ${name}`, async () => {
  const f = fixture(); mutate(f);
  await assert.rejects(release.validateReleasePr(f));
  assert.equal(f.calls.length, 0);
});

test('preparation creates only a version branch and labelled PR, never updates main', async () => {
  const f = fixture(); await release.openReleasePr(f);
  assert.deepEqual(f.calls.filter(([name]) => name === 'ref'), [['ref', {
    owner: 'qiniu', repo: 'coding-helper', ref: 'refs/heads/release/v0.5.0', sha: 'release-commit',
  }]]);
  assert.equal(f.calls.find(([name]) => name === 'pull')[1].base, 'main');
  assert.deepEqual(f.calls.find(([name]) => name === 'labels')[1].labels, ['release']);
});

test('preparation reuses an existing matching PR without overwriting it', async () => {
  const f = fixture(); f.state.pulls = [{ ...f.context.payload.pull_request, html_url: 'existing' }];
  assert.equal((await release.openReleasePr(f)).html_url, 'existing');
  assert.equal(f.calls.length, 0);
});

test('retry after creating a PR repairs a missing release label', async () => {
  const f = fixture(); f.state.pulls = [{ ...f.context.payload.pull_request, labels: [] }];
  await release.openReleasePr(f);
  assert.deepEqual(f.calls.map(([name]) => name), ['labels']);
});

test('prerelease metadata survives preparation and merged-PR validation', async () => {
  const f = fixture(); f.prerelease = true;
  await release.openReleasePr(f);
  f.context.payload.pull_request.body = f.calls.find(([name]) => name === 'pull')[1].body;
  assert.deepEqual(await release.validateReleasePr(f), { version: '0.5.0', prerelease: true });
});

test('an edited orphan release branch is never overwritten', async () => {
  const f = fixture(); f.state.branch = { object: { sha: 'edited' } };
  const getCommit = f.github.rest.git.getCommit;
  f.github.rest.git.getCommit = args => args.commit_sha === 'edited' ?
    { data: { tree: { sha: 'different' }, parents: [{ sha: 'base' }] } } : getCommit(args);
  await assert.rejects(release.openReleasePr(f), /different changes/);
  assert.equal(f.calls.some(([name]) => ['ref', 'commit', 'pull'].includes(name)), false);
});

test('preparation refuses a second pending version or a moved main', async () => {
  const f = fixture(); f.state.pulls = [{ ...f.context.payload.pull_request, head: { ...f.context.payload.pull_request.head, ref: 'release/v0.6.0' } }];
  await assert.rejects(release.openReleasePr(f), /existing release PR/);
  f.state.pulls = []; f.context.sha = 'old-base';
  await assert.rejects(release.openReleasePr(f), /main moved/);
  assert.equal(f.calls.length, 0);
});

test('retry after branch creation reuses it without overwriting it', async () => {
  const f = fixture(); f.state.branch = { object: { sha: 'release-commit' } };
  await release.openReleasePr(f);
  assert.equal(f.calls.some(([name]) => name === 'ref' || name === 'commit'), false);
  assert.equal(f.calls.some(([name]) => name === 'pull'), true);
});

test('tag uses the merge SHA and retry never moves an existing tag', async () => {
  const f = fixture(); await release.ensureTag(f);
  assert.equal(f.calls[0][1].sha, 'merged');
  f.calls.length = 0; f.state.tag = { object: { sha: 'merged', type: 'commit' } };
  await release.ensureTag(f); assert.equal(f.calls.length, 0);
  f.state.tag.object.sha = 'other';
  await assert.rejects(release.ensureTag(f), /different commit/);
});

test('npm retry skips only a version from the same merge commit and matching tag', async () => {
  const f = fixture(); assert.equal(await release.checkPublishedVersion(f), false);
  f.state.npm = { version: '0.5.0', gitHead: 'merged' };
  await assert.rejects(release.checkPublishedVersion(f), /already exists/);
  f.state.tag = { object: { sha: 'merged', type: 'commit' } };
  assert.equal(await release.checkPublishedVersion(f), true);
  f.state.npm.gitHead = 'other';
  await assert.rejects(release.checkPublishedVersion(f), /already exists/);
});

test('registry failures are not mistaken for an unpublished version', async () => {
  const f = fixture(); f.fetchRegistry = async () => ({ status: 503, ok: false });
  await assert.rejects(release.checkPublishedVersion(f), /HTTP 503/);
  f.fetchRegistry = async () => { throw new Error('network'); };
  await assert.rejects(release.checkPublishedVersion(f), /network/);
});

test('release notes come from the reviewed version only and retries reuse the release', async () => {
  const f = fixture(); f.prerelease = true; await release.ensureRelease(f);
  const request = f.calls[0][1];
  assert.equal(request.prerelease, true); assert.equal(request.make_latest, 'false');
  assert.match(request.body, /New features/); assert.doesNotMatch(request.body, /Old features/);
  f.state.existingRelease = { prerelease: true, draft: false, html_url: 'existing' }; f.calls.length = 0;
  assert.equal((await release.ensureRelease(f)).html_url, 'existing'); assert.equal(f.calls.length, 0);
});

test('workflow isolates prepare and publish permissions and publishes npm before GitHub Release', () => {
  const workflow = yaml.load(readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'));
  assert.deepEqual(workflow.on.pull_request, { types: ['closed'], branches: ['main'] });
  assert.equal(workflow.jobs.prepare.if, "github.event_name == 'workflow_dispatch'");
  assert.equal(workflow.jobs.prepare.permissions['id-token'], undefined);
  assert.equal(workflow.jobs.publish.permissions['id-token'], 'write');
  assert.match(workflow.jobs.publish.if, /merged == true/);
  assert.match(workflow.jobs.publish.if, /labels\.\*\.name, 'release'/);
  const steps = workflow.jobs.publish.steps;
  assert.equal(steps[0].with.ref, '${{ github.event.pull_request.merge_commit_sha }}');
  assert.ok(steps.findIndex(step => step.name === 'Publish to npm') < steps.findIndex(step => step.name === 'Create GitHub Release'));
  assert.match(steps.find(step => step.name === 'Publish to npm').run, /--tag next/);
});
