# 发布流程

发布分两步：手动运行 `Release` 工作流创建版本 PR，维护者审阅并合并后自动发布。整个流程不直接写入 `main`，不需要额外的 GitHub App 或 PAT。

## 一次性配置

- 仓库 Settings → Actions → General → Workflow permissions 中开启 **Allow GitHub Actions to create and approve pull requests**。流程只创建 PR，不自动批准或合并。若组织策略禁用此设置，需要组织管理员允许。
- 保留 `main` 的 PR、CODEOWNERS 和审批规则。
- npm trusted publisher 继续使用 `qiniu/coding-helper` 的 **release.yml**，允许 `npm publish`。工作流文件名不变，不需要增加 npm token。

## 创建版本 PR

1. 在 Actions → Release → Run workflow 中选择 `main`，指定 `patch`、`minor` 或 `major`。
2. 根据需要选择预发布标记。它保留数字版本号，在 GitHub 标为 prerelease，并发布到 npm `next`，不会更新 `latest`。
3. CI 更新 `package.json`、`src/lib/version.ts`、`CHANGELOG.md`，完成测试、构建、CLI 和包内容检查，创建 `release/vX.Y.Z` 分支和带 `release` 标签的 PR。
4. 打开运行摘要中的 PR 链接，审阅版本号及变更记录。若 GitHub 提示 **Approve workflows to run**，先允许该 PR 的 CI 运行；该提示与代码审批是两回事。
5. 按仓库规则完成审批并手动合并。关闭但不合并不会发布。

同一时间只允许一个待合并版本 PR。重复运行相同版本和预发布选项会复用现有 PR，不覆盖修改；想更改版本类型时先关闭旧 PR。若同名分支内容与新准备的内容不同，流程会拒绝覆盖，需要维护者确认后处理旧分支。

## 合并后自动发布

`pull_request: closed` 事件只允许已合并、目标为 `main`、来自本仓库的 `release/vX.Y.Z` 分支且带有 `release` 标签的 PR 进入发布任务。普通 PR 不会发版。

发布任务检出该 PR 的 `merge_commit_sha`，而不是运行时最新的 `main`，并再次检查：

- PR 只修改三个版本文件，元数据与分支版本一致。
- 包版本、CLI 版本及 CHANGELOG 首项版本一致，且版本大于合并提交前的版本。
- 完整测试、构建、CLI 及 npm 包检查通过。
- tag 不指向其他提交，npm 同版本未被其他提交发布。

通过后创建 tag、通过 OIDC 发布 npm，再创建 GitHub Release。需要由维护者手动合并；不要改成使用 `GITHUB_TOKEN` 自动合并，因为它产生的 `closed` 事件不会触发后续工作流。

## 失败重试

- 准备失败：修复原因后重新运行准备任务。分支已创建但 PR 创建失败时，内容和基线匹配即可复用。
- 发布失败：打开**合并触发的那次 Release 运行**，选择 Re-run failed jobs。不要为重试再次 bump 版本。
- 同一提交的 tag 会复用；npm 同版本存在时，只有 tag 和 registry 的 `gitHead` 均匹配合并提交，才跳过 npm 上传，继续完成 GitHub Release。
- 已有 tag 指向其他提交、npm 来源无法验证、网络查询失败时停止，不覆盖 tag，也不把网络失败当作“版本不存在”。

代码与模拟测试无法验证 npm 端 OIDC 授权。实际发布结果以合并后的 Actions 日志、npm 版本及 GitHub Release 为准。
