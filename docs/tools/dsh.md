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

默认目录为 `~/.dsh`，支持 `DSH_HOME`，包含官方的 `~`、`~/` 和 `~\` 前缀展开。配置目标是官方 Web 和 Headless profile：

- `profiles/web/package.json`、`profiles/web/cordis.patch.yml`
- `profiles/headless/package.json`、`profiles/headless/cordis.patch.yml`
- `.env` 中的 `CODING_HELPER_DSH_API_KEY`

新目录会生成官方对应的 bundle manifest。已存在的标准 profile manifest 保持原文，依赖和插件配置不被删除。两个 profile 分别合并自己的 provider 列表，新增 `coding-helper-qiniu` 路由，并更新新会话的默认模型；不会把 Web 的服务商复制进 Headless。使用 OpenAI Chat Completions 协议，写入模型目录返回的上下文、最大输出和图片输入能力。切换模型保留该路由内已有模型。同一线路离线重载时沿用已有模型限额和图片能力，用户上下文上限只会继续收窄这些值，不会扩大已验证的容量。

持久配置生效后可以直接运行 `dsh web` 或 `dsh headless '任务'`；已有会话需重新选择模型。`coding-helper run dsh` 还会向子进程提供当前 Key，并在配置与当前线路/模型不一致时提示先装载配置。

`.env` 使用凭据引用而不在 patch 里写明文 Key。文件按 0600 写入；其他 dotenv 变量、YAML 注释与 `!!js` 表达式保留，helper 不执行表达式。

写入前先预演并确认；取消不会保存模型或客户端文件。卸载使用 `coding-helper restore dsh --yes`，按事务恢复原文件字节；新建文件被删除。外部编辑、重复目标、符号链接、损坏配置或更换 `DSH_HOME` 会停止覆盖并保留还原记录。

## 支持边界

- 支持官方标准 Web/Headless bundle；自定义 bundle 不被猜测或替换。
- 更高优先级的 `$DSH_HOME/cordis.patch.yml` 如果覆盖模型适配器或默认模型，会明确提示移动到 profile 或选择独立的 `DSH_HOME`，保持原文件不变。
- 旧 `settings.yaml` / `settings.yml` 且没有当前 profile patch 时提示升级，不将未知旧格式当空配置覆盖。
- 当前不自动修改 SDK/ACP 或自定义 profile。

## English

Validated with dsh `0.2.1-rc.5` on Node.js 24. The adapter configures the standard Web and Headless profiles separately, preserving existing providers and plugins. It adds an OpenAI Chat Completions route named `coding-helper-qiniu`, references the credential from `$DSH_HOME/.env`, and selects the model for new sessions. Use `dsh web`, `dsh headless`, or `coding-helper run dsh` after loading. Existing sessions need a model reselection.

Previews and cancellations do not write. Restoration recovers original file bytes. External edits, symlinks, changed data directories, custom bundles, legacy settings and higher-priority home model overrides are protected with explicit diagnostics. SDK/ACP and custom profiles are not modified.

## 验证依据 / Sources

- [官方 CLI 配置组合规则](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md)
- [官方多服务商配置](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm-pi-ai/README.md)
- [官方默认模型服务](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/agent-default-model/README.md)

本地额外用官方 CLI 组合生成配置，并以 Headless 实际调用测试网关验证模型 ID、Bearer 凭据和响应；目录导出不替代启动验证。

可选的官方 CLI 集成测试（安装 dsh 后执行）：

```bash
DSH_TEST_BINARY="$(command -v dsh)" node --test tests/dsh*.test.mjs
```

测试使用临时 HOME，并在测试网关验证 Headless 请求和 Web 的会话认证页面访问。另已使用真实七牛海外线路、`z-ai/glm-5.2` 验证 Headless 返回 `OK`，凭据不进入公开日志。
