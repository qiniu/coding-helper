const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const RELEASE_FILES = ['package.json', 'src/lib/version.ts', 'CHANGELOG.md'];
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

async function optional(request) {
  try {
    return (await request()).data;
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

function assertVersion(version) {
  if (!VERSION_PATTERN.test(version)) throw new Error('Invalid release version');
}

async function openReleasePr({ github, context, version, prerelease, readFile = fs.readFileSync }) {
  assertVersion(version);
  const repo = context.repo;
  const branch = `release/v${version}`;
  const title = `chore: release v${version}`;
  const marker = `<!-- coding-helper-release: ${JSON.stringify({ version, prerelease })} -->`;
  const pulls = await github.paginate(github.rest.pulls.list, { ...repo, state: 'open', base: 'main' });
  const pending = pulls.filter(pr => pr.head.repo?.full_name === `${repo.owner}/${repo.repo}` &&
    pr.head.ref.startsWith('release/v'));
  if (pending.length) {
    if (pending.length === 1 && pending[0].head.ref === branch && pending[0].body?.includes(marker)) {
      if (!pending[0].labels.some(label => label.name === 'release')) {
        await github.rest.issues.addLabels({ ...repo, issue_number: pending[0].number, labels: ['release'] });
      }
      return pending[0];
    }
    throw new Error(`Review or close the existing release PR first: ${pending[0].html_url}`);
  }
  const current = await github.rest.git.getRef({ ...repo, ref: 'heads/main' });
  if (current.data.object.sha !== context.sha) throw new Error('main moved; start a new release workflow run');
  const base = (await github.rest.git.getCommit({ ...repo, commit_sha: context.sha })).data;
  const treeItems = [];
  for (const path of RELEASE_FILES) {
    const blob = await github.rest.git.createBlob({ ...repo, content: readFile(path, 'utf8'), encoding: 'utf-8' });
    treeItems.push({ path, mode: '100644', type: 'blob', sha: blob.data.sha });
  }
  const tree = (await github.rest.git.createTree({ ...repo, base_tree: base.tree.sha, tree: treeItems })).data;
  const existing = await optional(() => github.rest.git.getRef({ ...repo, ref: `heads/${branch}` }));
  if (existing) {
    // 创建分支成功、创建 PR 失败时可重跑，但不能覆盖已有修改。
    const commit = (await github.rest.git.getCommit({ ...repo, commit_sha: existing.object.sha })).data;
    if (commit.tree.sha !== tree.sha || commit.parents.length !== 1 || commit.parents[0].sha !== context.sha) {
      throw new Error(`Release branch ${branch} already exists with different changes`);
    }
  } else {
    const commit = await github.rest.git.createCommit({ ...repo, message: title, tree: tree.sha, parents: [context.sha] });
    await github.rest.git.createRef({ ...repo, ref: `refs/heads/${branch}`, sha: commit.data.sha });
  }
  const label = await optional(() => github.rest.issues.getLabel({ ...repo, name: 'release' }));
  if (!label) await github.rest.issues.createLabel({ ...repo, name: 'release', color: '0E8A16', description: 'Version PR: merge to publish' });
  const body = [
    '## Description', '', `Prepare v${version}. Merge this PR to publish automatically.`, '',
    '## Changes', '', '- Update package and CLI versions and CHANGELOG.',
    `- npm dist-tag: \`${prerelease ? 'next' : 'latest'}\`; GitHub prerelease: ${prerelease}.`, '',
    '## Checklist', '', '- [x] `pnpm build` succeeds',
    '- [x] `node dist/cli.js --version` outputs correct version',
    '- [x] Tested basic CLI functionality',
    '- [x] Updated translations if adding user-facing strings (not applicable)', '',
    'Preparation ran tests and npm pack --dry-run. Publishing repeats these checks on the merged commit.',
    'If GitHub requests approval to run PR workflows, select "Approve workflows to run" before merging.', '', marker,
  ].join('\n');
  const pr = (await github.rest.pulls.create({ ...repo, title, head: branch, base: 'main', body })).data;
  await github.rest.issues.addLabels({ ...repo, issue_number: pr.number, labels: ['release'] });
  return pr;
}

async function validateReleasePr({ github, context, readFile = fs.readFileSync,
  git = args => execFileSync('git', args, { encoding: 'utf8' }).trim() }) {
  const pr = context.payload.pull_request;
  if (context.eventName !== 'pull_request' || context.payload.action !== 'closed' || !pr?.merged ||
      pr.base.ref !== 'main' || pr.head.repo?.full_name !== `${context.repo.owner}/${context.repo.repo}` ||
      !pr.labels.some(label => label.name === 'release')) throw new Error('Not a merged release PR');
  const version = pr.head.ref.replace(/^release\/v/, '');
  assertVersion(version);
  if (pr.head.ref !== `release/v${version}`) throw new Error('Invalid release branch');
  const marker = pr.body?.match(/<!-- coding-helper-release: (\{[^\n]+\}) -->/);
  const metadata = marker ? JSON.parse(marker[1]) : null;
  if (metadata?.version !== version || typeof metadata.prerelease !== 'boolean') throw new Error('Invalid release metadata');
  if (git(['rev-parse', 'HEAD']) !== pr.merge_commit_sha) throw new Error('Checkout does not match the merged commit');
  const files = await github.paginate(github.rest.pulls.listFiles, { ...context.repo, pull_number: pr.number });
  if (files.length !== RELEASE_FILES.length || files.some(file => !RELEASE_FILES.includes(file.filename) || file.status !== 'modified')) {
    throw new Error('Release PR must only modify package.json, src/lib/version.ts and CHANGELOG.md');
  }
  const pkg = JSON.parse(readFile('package.json', 'utf8'));
  const cliVersion = readFile('src/lib/version.ts', 'utf8').match(/export const VERSION = '([^']+)';/)?.[1];
  if (pkg.name !== 'qiniu-coding-helper' || pkg.version !== version || cliVersion !== version) throw new Error('Release versions do not match');
  const previous = JSON.parse(git(['show', `${pr.merge_commit_sha}^:package.json`])).version;
  assertVersion(previous);
  const a = version.split('.').map(Number), b = previous.split('.').map(Number);
  const difference = a.findIndex((part, i) => part !== b[i]);
  if (difference < 0 || a[difference] < b[difference]) throw new Error('Release version must increase');
  const changelog = readFile('CHANGELOG.md', 'utf8');
  if (changelog.match(/^## \[([^\]]+)\]/m)?.[1] !== version) throw new Error('CHANGELOG version does not match');
  return { version, prerelease: metadata.prerelease };
}

async function tagFor({ github, context, version }) {
  return optional(() => github.rest.git.getRef({ ...context.repo, ref: `tags/v${version}` }));
}

async function checkPublishedVersion({ github, context, version, fetchRegistry = fetch }) {
  assertVersion(version);
  const tag = await tagFor({ github, context, version });
  const sha = context.payload.pull_request.merge_commit_sha;
  if (tag && (tag.object.type !== 'commit' || tag.object.sha !== sha)) throw new Error('Release tag points to a different commit');
  const response = await fetchRegistry(`https://registry.npmjs.org/qiniu-coding-helper/${version}`, {
    signal: AbortSignal.timeout(30000),
  });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`npm registry lookup failed: HTTP ${response.status}`);
  const published = await response.json();
  // 只有本次合并已创建的 tag 和 npm gitHead 均匹配，才允许跳过已完成的发布。
  if (!tag || published.version !== version || published.gitHead !== sha) throw new Error('npm version already exists with different or unverifiable provenance');
  return true;
}

async function ensureTag({ github, context, version }) {
  assertVersion(version);
  const tag = await tagFor({ github, context, version });
  const sha = context.payload.pull_request.merge_commit_sha;
  if (tag) {
    if (tag.object.type !== 'commit' || tag.object.sha !== sha) throw new Error('Release tag points to a different commit');
    return;
  }
  await github.rest.git.createRef({ ...context.repo, ref: `refs/tags/v${version}`, sha });
}

async function ensureRelease({ github, context, version, prerelease, readFile = fs.readFileSync }) {
  assertVersion(version);
  const repo = context.repo;
  const tag = `v${version}`;
  const existing = await optional(() => github.rest.repos.getReleaseByTag({ ...repo, tag }));
  if (existing) {
    if (existing.draft || existing.prerelease !== prerelease) throw new Error('Existing GitHub Release metadata differs');
    return existing;
  }
  const changelog = readFile('CHANGELOG.md', 'utf8');
  const entry = changelog.slice(changelog.indexOf(`## [${version}]`)).split(/\n## \[/)[0];
  const body = `## npm 包\n\n- 包名：\`qiniu-coding-helper@${version}\`\n\n${entry}`;
  return (await github.rest.repos.createRelease({ ...repo, tag_name: tag,
    target_commitish: context.payload.pull_request.merge_commit_sha, name: tag, body,
    prerelease, make_latest: prerelease ? 'false' : 'true' })).data;
}

module.exports = { openReleasePr, validateReleasePr, checkPublishedVersion, ensureTag, ensureRelease };
