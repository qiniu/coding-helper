// 仅信任 GitHub API 的关联关系；不从 PR 产物读取目标编号或提交信息。
module.exports = async function resolveReviewPR({ github, context, core }) {
  const { owner, repo } = context.repo;
  const run = context.payload.workflow_run;
  if (run.event !== 'pull_request' || run.path !== '.github/workflows/codex-pr-review.yml' ||
      run.repository.full_name !== `${owner}/${repo}` || !/^[a-f0-9]{40}$/.test(run.head_sha)) {
    throw new Error('Unexpected evidence workflow identity');
  }
  // fork 的 workflow_run.pull_requests 可能为空，使用提交关联 API 获取候选 PR。
  const candidates = await github.paginate(github.rest.repos.listPullRequestsAssociatedWithCommit, {
    owner, repo, commit_sha: run.head_sha, per_page: 100,
  });
  const matches = [];
  for (const candidate of candidates) {
    const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: candidate.number });
    if (pr.state === 'open' && !pr.draft && pr.base.repo.full_name === `${owner}/${repo}` &&
        pr.head.repo?.id === run.head_repository.id && pr.head.sha === run.head_sha &&
        pr.head.ref === run.head_branch) matches.push(pr);
  }
  if (matches.length !== 1) {
    core.notice('Skipping evidence without exactly one current, open, non-draft PR.');
    return;
  }
  const pr = matches[0];
  if (!/^[a-f0-9]{40}$/.test(pr.base.sha)) throw new Error('Invalid base SHA');
  // 读取本次 attempt 的步骤结论，避免将 continue-on-error 的成功 job 当成测试通过。
  const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRunAttempt, {
    owner, repo, run_id: run.id, attempt_number: run.run_attempt, per_page: 100,
  });
  const steps = jobs.find(job => job.name === 'Collect review evidence')?.steps ?? [];
  const outcome = name => steps.find(step => step.name === name)?.conclusion ?? 'unavailable';
  require('node:fs').writeFileSync('pr-review.json', JSON.stringify({ title: pr.title, body: pr.body }));
  core.setOutput('number', String(pr.number));
  core.setOutput('base', pr.base.sha);
  core.setOutput('head', pr.head.sha);
  core.setOutput('unit_tests', outcome('Run unit tests'));
  core.setOutput('interactive_tests', outcome('Run interactive terminal check'));
};
