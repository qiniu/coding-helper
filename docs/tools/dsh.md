# DeepSeek Harness (dsh)

支持并实测 `@deepseek-ai/dsh@0.2.1-rc.5`，测试运行时为 Node.js 24。安装/更新菜单使用这一已验证版本：

```bash
npm install -g @deepseek-ai/dsh@0.2.1-rc.5
coding-helper dsh --intl --model z-ai/glm-5.2
coding-helper run dsh                    # 默认启动 Web
coding-helper run dsh -- headless '回复 OK'
```

Key 可使用已保存的 coding-helper 配置或 `QINIU_API_KEY`，也可通过交互向导输入。适配器不安装客户端；尚未安装 dsh 时仍能生成首次配置。

## 配置与恢复

默认目录为 `~/.dsh`，支持 `DSH_HOME`，包含官方的 `~`、`~/` 和 `~\` 前缀展开。配置目标是官方 Web、Headless 和已初始化的 Desktop profile：

- `profiles/web/package.json`、`profiles/web/cordis.patch.yml`
- `profiles/headless/package.json`、`profiles/headless/cordis.patch.yml`
- `.env` 中的 `CODING_HELPER_DSH_API_KEY`
- 已存在 `profiles/desktop/package.json` 时，同时更新 `profiles/desktop/cordis.patch.yml`

新目录会生成官方对应的 bundle manifest。已存在的标准 profile manifest 保持原文，依赖和插件配置不被删除。两个 profile 分别合并自己的 provider 列表，新增 `coding-helper-qiniu` 路由，并更新新会话的默认模型；不会把 Web 的服务商复制进 Headless。使用 OpenAI Chat Completions 协议，写入模型目录返回的上下文、最大输出和图片输入能力。切换模型保留该路由内已有模型。同一线路离线重载时沿用已有模型限额和图片能力，用户上下文上限只会继续收窄这些值，不会扩大已验证的容量。

持久配置生效后可以直接运行 `dsh web` 或 `dsh headless '任务'`；已有会话需重新选择模型。`coding-helper run dsh` 还会向子进程提供当前 Key，并在配置与当前线路/模型不一致时提示先装载配置。

Desktop 先启动一次，生成标准的 `desktop` profile，再执行相同的 `coding-helper dsh --intl --model z-ai/glm-5.2`。Desktop 的 manifest、额外插件、依赖和锁文件由应用管理，helper 只校验标准 base/web bundle 并合并模型 patch。三个 profile 分别保留各自的其他服务商，共用一个凭据文件和一份还原记录；旧的五文件记录会增量加入 Desktop patch，并保留最初的还原基线。仅安装 Desktop 时也可写入配置，完成后完全退出并重新打开 Desktop、新建会话；`coding-helper run dsh` 仍用于 CLI。

自定义 `DSH_HOME` 时，CLI 与 Desktop 启动环境需指向相同目录。Desktop 2.0.11 的应用内目录切换发生在 `.env` 加载之后，不能仅靠切换目录使凭据重新加载；更高优先级的启动环境和项目 `.env` 也可能覆盖凭据。

`.env` 使用凭据引用而不在 patch 里写明文 Key。文件按 0600 写入；其他 dotenv 变量、YAML 注释与 `!!js` 表达式保留，helper 不执行表达式。

写入前先预演并确认；取消不会保存模型或客户端文件。卸载使用 `coding-helper restore dsh --yes`：没有外部编辑时恢复原文件字节，新建文件被删除。客户端后续新增的其他服务商、UI、主题、权限等 patch 配置会保留；助手会核对七牛路由及默认模型等托管字段，确认未变后继续写入，并把外部内容带入还原基线。直接还原也会保留这些内容并还原原来的托管字段；旧五文件记录不会还原尚未接管的 Desktop patch。托管字段被修改、重复目标、符号链接、损坏配置、更换 `DSH_HOME` 或中断记录与当前文件不一致时，停止覆盖并保留还原记录。

## 支持边界

- 支持官方标准 Web/Headless bundle，以及包含标准 base/web bundle 的 Desktop profile；Desktop 额外插件保持不变。未知 bundle 不被猜测或替换。
- 更高优先级的 `$DSH_HOME/cordis.patch.yml` 如果覆盖模型适配器或默认模型，会明确提示移动到 profile 或选择独立的 `DSH_HOME`，保持原文件不变。
- 旧 `settings.yaml` / `settings.yml` 且没有当前 profile patch 时提示升级，不将未知旧格式当空配置覆盖。
- 当前不自动修改 SDK/ACP 或自定义 profile。

## English

Validated with dsh `0.2.1-rc.5` on Node.js 24. The adapter configures Web, Headless and an already initialized standard Desktop profile separately, preserving existing providers and plugins. It adds an OpenAI Chat Completions route named `coding-helper-qiniu`, references the credential from `$DSH_HOME/.env`, and selects the model for new sessions. Start Desktop once before loading, then fully quit and reopen it. Desktop manifests, dependencies and lockfiles are unchanged. Existing five-file journals extend to the Desktop patch without replacing their original restore baselines. Desktop-only installations can configure without the npm CLI; `coding-helper run dsh` launches the CLI.

Use the same `DSH_HOME` in both launch environments. Desktop 2.0.11 loads dotenv before resolving its in-app directory locator; changing that locator alone does not reload credentials. Existing sessions need a model reselection.

Previews and cancellations do not write. Without external edits, restoration recovers original file bytes. Client-added providers, UI, theme and permission patches survive reload and restore; the original managed fields are restored while these additions remain. Reconciliation requires the Qiniu route and managed default-model fields to match the recorded write. Changed managed fields, interrupted journals, symlinks, changed data directories, custom bundles, legacy settings and higher-priority home model overrides retain explicit diagnostics. SDK/ACP and custom profiles are not modified.

## 验证依据 / Sources

- [官方 CLI 配置组合规则](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md)
- [官方多服务商配置](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm-pi-ai/README.md)
- [官方默认模型服务](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/agent-default-model/README.md)
- [官方 Desktop profile 与启动说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.zh.md)

本地额外用官方 CLI 组合生成配置，并以 Headless 实际调用测试网关验证模型 ID、Bearer 凭据和响应；目录导出不替代启动验证。

可选的官方 CLI 集成测试（安装 dsh 后执行）：

```bash
DSH_TEST_BINARY="$(command -v dsh)" node --test tests/dsh*.test.mjs
```

测试使用临时 HOME，并在测试网关验证 Headless 请求和 Web 的会话认证页面访问。另已使用真实七牛海外线路、`z-ai/glm-5.2` 验证 Headless 返回 `OK`，凭据不进入公开日志。

Desktop 已在本机安装的 DSH Desktop 2.0.11（内嵌 Harness 0.1.5-rc.2）完成原生界面验证：CLI 写入后，模型菜单显示 `z-ai/glm-5.2`；测试网关验证模型与 Bearer 凭据，真实七牛海外请求返回 `DESKTOP_REAL_OK`。执行 CLI 还原后，六个受管理目标恢复原始字节或原本不存在的状态，新会话选回原模型并返回 `DESKTOP_RESTORE_OK`。Desktop 自行添加的 manifest 元数据由应用保留，helper 不覆盖。验证结束后原用户配置与目录定位设置已恢复并逐字节核对。
