# 外部 PR 的 Codex 审阅

审阅分为两个工作流：

1. `Codex PR Evidence` 由 `pull_request` 触发，在无 Secret、只读令牌的 runner 上安装依赖并执行 PR 测试，上传日志与交互报告。
2. `Codex PR Review` 由上述工作流的 `workflow_run: completed` 触发，使用默认分支上的工作流和脚本。审阅 job 仅有读取权限，可使用 `QNAIGC_API_KEY`；独立的反馈 job 获得评论和标签写权限。

审阅通过 `allow-users: '*'` 接受外部用户触发。PR 的代码、元数据、日志均为不可信数据；带 Secret 的 job 只检出默认分支，把 PR 提交作为 Git 对象获取，通过 diff / git show 读取，不安装或执行 PR 代码。Codex 使用 `read-only` sandbox 和 `drop-sudo`。反馈 job 不检出代码。

从 GitHub API 获取提交关联 PR；若结果为空，则按 fork 所有者和分支查询。随后校验来源仓库、分支和当前 head，兼容 fork 事件中为空的 `pull_requests`。旧提交、草稿、已关闭 PR 不发表评论。测试状态来自该次 workflow attempt 的 job steps；证据缺失不会报告为通过。

## 上线与验证

- 需先合并到默认分支，`workflow_run` 才会启用新流程；无需为外部贡献者授予仓库写权限，也无需开启向 fork PR 发送写令牌或 Secret。
- GitHub 对首次外部贡献者运行 Actions 的批准规则仍适用。
- 合并后让外部 PR 同步最新默认分支并推送更新，确认先运行 `Codex PR Evidence`，再运行 `Codex PR Review`，最后出现中文评论。旧失败运行不会被自动修改。
- 审阅工作流是默认分支的独立运行，不是 PR head 上的检查。若分支保护曾要求旧的 `Review PR` / `Comment and label PR` 检查，维护者需要相应调整；PR 构建与证据检查仍属于 PR 工作流。
- `QNAIGC_API_KEY` 必须存在且有效。API 错误与权限问题需分别诊断，失败不表示审阅通过。

本地校验：`pnpm test`、`actionlint .github/workflows/codex-pr-review*.yml`。
