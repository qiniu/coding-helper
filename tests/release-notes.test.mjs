import test from 'node:test';
import assert from 'node:assert/strict';
import { completeReleaseNotes } from '../.github/scripts/release-notes.cjs';

function fixture(subjects, body = "## What's Changed\n* existing in https://github.com/qiniu/coding-helper/pull/90\n\n**Full Changelog**: compare") {
  const calls = [];
  return { calls, body, previousTag: 'v0.4.0', targetSha: 'release-base',
    context: { repo: { owner: 'qiniu', repo: 'coding-helper' } },
    git: args => { calls.push(['git', args]); return subjects.join('\n'); },
    github: { rest: { pulls: { get: async args => {
      calls.push(['pr', args]); return { data: { merged_at: '2026-10-30', user: { login: 'author' } } };
    } } } },
  };
}

test('restores all 19 rewritten stack PRs without duplicating the five recognized PRs', async () => {
  const stack = [67, 68, ...Array.from({ length: 17 }, (_, i) => 70 + i)];
  const recognized = [48, 66, 44, 45, 90];
  const body = "## What's Changed\n" + recognized.map(n => `* existing in https://github.com/qiniu/coding-helper/pull/${n}`).join('\n') + '\n\n**Full Changelog**: compare';
  const f = fixture([...recognized, ...stack].map(n => `feat: change (#${n})`), body);
  const result = await completeReleaseNotes(f);
  const numbers = [...result.matchAll(/\/pull\/(\d+)/g)].map(match => Number(match[1]));
  assert.equal(numbers.length, 24);
  assert.deepEqual(new Set(numbers), new Set([...recognized, ...stack]));
  assert.equal(f.calls.filter(([type]) => type === 'pr').length, 19);
  assert.deepEqual(f.calls[0][1], ['log', '--reverse', '--format=%s', 'v0.4.0..release-base', '--']);
});

test('already represented PRs are unchanged and need no API queries', async () => {
  const f = fixture(['fix: publishing (#90)']);
  assert.equal(await completeReleaseNotes(f), f.body);
  assert.equal(f.calls.length, 1);
});

test('deduplicates commits for one PR and uses the current commit title', async () => {
  const f = fixture(['feat: corrected title (#67)', 'feat: repeated (#67)']);
  const result = await completeReleaseNotes(f);
  assert.match(result, /feat: corrected title by @author/);
  assert.equal((result.match(/\/pull\/67/g) || []).length, 1);
});

test('does not treat ordinary issue references or unmerged PRs as merged changes', async () => {
  const f = fixture(['fix #67', 'Refs #68', 'fix: thing (#70)']);
  f.github.rest.pulls.get = async () => ({ data: { merged_at: null } });
  assert.equal(await completeReleaseNotes(f), f.body);
});

test('same number in another repository and a longer PR number do not hide a change', async () => {
  const f = fixture(['feat: thing (#67)'], "## What's Changed\n* https://github.com/other/repo/pull/67\n* https://github.com/qiniu/coding-helper/pull/670");
  assert.match(await completeReleaseNotes(f), /coding-helper\/pull\/67\n/);
});

test('preserves contributor and compare sections after additional entries', async () => {
  const f = fixture(['feat: thing (#67)'], "## What's Changed\n* existing\n\n## New Contributors\n* @new\n\n**Full Changelog**: compare");
  const result = await completeReleaseNotes(f);
  assert.ok(result.indexOf('/pull/67') < result.indexOf('## New Contributors'));
  assert.ok(result.endsWith('**Full Changelog**: compare'));
});

test('creates a changes section if GitHub did not recognize any PR', async () => {
  const f = fixture(['feat: thing (#67)'], '**Full Changelog**: compare');
  assert.match(await completeReleaseNotes(f), /^## What's Changed\n\* feat:/);
});

test('initial release uses the target history without an undefined range', async () => {
  const f = fixture(['feat: thing (#67)']); f.previousTag = undefined;
  await completeReleaseNotes(f);
  assert.deepEqual(f.calls[0][1], ['log', '--reverse', '--format=%s', 'release-base', '--']);
});

test('API errors fail generation instead of silently publishing incomplete notes', async () => {
  const f = fixture(['feat: thing (#67)']);
  f.github.rest.pulls.get = async () => { throw new Error('rate limit'); };
  await assert.rejects(completeReleaseNotes(f), /rate limit/);
});
