const { execFileSync } = require('node:child_process');

// 重写提交会丢失 GitHub 的 PR 关联；仅从发布范围内的提交标题补回已合并 PR。
async function completeReleaseNotes({ github, context, body, previousTag, targetSha,
  git = args => execFileSync('git', args, { encoding: 'utf8' }) }) {
  const { owner, repo } = context.repo;
  const prefix = `https://github.com/${owner}/${repo}/pull/`;
  const represented = new Set([...body.matchAll(/https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\b/g)]
    .filter(match => match[1] === owner && match[2] === repo).map(match => Number(match[3])));
  const range = previousTag ? `${previousTag}..${targetSha}` : targetSha;
  const subjects = git(['log', '--reverse', '--format=%s', range, '--']).split('\n');
  const additions = [];
  for (const subject of subjects) {
    const match = subject.match(/^(.+) \(#([1-9]\d*)\)$/);
    if (!match) continue;
    const number = Number(match[2]);
    if (represented.has(number)) continue;
    represented.add(number);
    const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: number });
    if (!pr.merged_at) continue;
    additions.push(`* ${match[1]} by @${pr.user.login} in ${prefix}${number}`);
  }
  if (!additions.length) return body;

  // 保留自动生成的贡献者和完整对比链接，把补充条目放在更新内容一节。
  const heading = /^## What's Changed\s*$/m.exec(body);
  if (!heading) return `## What's Changed\n${additions.join('\n')}\n\n${body}`;
  const start = heading.index + heading[0].length;
  const tail = body.slice(start);
  const nextSection = /^(?:## |\*{1,2}Full Changelog\*{1,2}:)/m.exec(tail);
  const end = nextSection ? start + nextSection.index : body.length;
  return `${body.slice(0, end).trimEnd()}\n${additions.join('\n')}\n\n${body.slice(end).trimStart()}`;
}

module.exports = { completeReleaseNotes };
