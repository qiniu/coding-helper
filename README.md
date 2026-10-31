<div align="center">

# 🚀 qiniu-coding-helper

[![npm version](https://badge.fury.io/js/qiniu-coding-helper.svg)](https://www.npmjs.com/package/qiniu-coding-helper)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Node.js Version](https://img.shields.io/node/v/qiniu-coding-helper.svg)](https://nodejs.org)

**一站式配置 Claude Code、Codex、CodeBuddy、WorkBuddy、Hermes Agent 和 OpenCode 使用七牛 AI API 端点的 CLI 工具**

[English](README.en-US.md) · [支持的工具](#-支持的工具) · [功能特性](#-功能特性) · [前置要求](#-前置要求) · [快速开始](#-快速开始) · [命令一览](#-命令一览) · [配置说明](#-配置说明) · [常见问题](#-常见问题)

</div>

---

## 🧰 支持的工具

| 工具 | 类型 | 写入的配置 |
|------|------|------------|
| MiniMax Code | CLI | [配置说明 / Configuration](docs/tools/minimax-code.md) |
| GitHub Copilot CLI | CLI | [启动器 / Launcher](docs/tools/copilot.md) |
| Claude Code | CLI | `~/.claude/settings.json`、`~/.claude.json` |
| Qwen Code | CLI | [配置说明 / Configuration](docs/tools/qwen-code.md) |
| Codex | CLI | `~/.codex/config.toml`、`~/.codex/auth.json` |
| Kimi Code CLI | CLI | [配置说明 / Configuration](docs/tools/kimi-code.md) |
| CodeBuddy | CLI | `~/.codebuddy/models.json` |
| Grok CLI | CLI | [配置说明 / Configuration](docs/tools/grok.md) |
| WorkBuddy | 桌面应用 | `~/.workbuddy/models.json` |
| OpenClaw | CLI | [配置说明 / Configuration](docs/tools/openclaw.md) |
| Hermes Agent | CLI | `~/.hermes/config.yaml` |
| Factory Droid | CLI | [配置说明 / Configuration](docs/tools/droid.md) |
| OpenCode | CLI | `~/.config/opencode/opencode.json` |

## ✨ 功能特性

多工具快捷配置：`coding-helper claude,codex,opencode [Key] [模型]`；`all` 选择已安装的 CLI 工具。支持 `--dry-run` 和 `--no-save`。后者只写客户端配置及恢复日志，不保存 helper 的 Key/线路/模型，启动器工具会跳过。仅成功工具的模型被保存；没有成功工具退出 1，部分写入失败退出 2。预演仍会做网络校验，但不输出配置正文。

`coding-helper setup --tools codex --dry-run --json` 在内存中运行配置事务，报告文件路径、动作和行数，不创建客户端目录、备份、锁或恢复日志。输出不含配置正文，避免旧凭据进入日志。MiniMax 的外部写入命令不支持安全预演，会明确返回失败。

单工具快捷配置：`coding-helper opencode [API Key] [模型 ID]`，Key 也可从 `QINIU_API_KEY` 或已保存配置读取；支持 `--intl`、`--json`。任意前缀的 Key 可用 `--key` 明确指定，`--model` 可消除模型位置参数歧义。所有校验完成且客户端装载成功后才保存 helper 设置。Codex 会用最小 Responses 请求验证协议兼容性。

换 Key 时，`coding-helper auth <key> --sync` 同步仍接入七牛的客户端；失败返回非零，重复同一 Key 可重试。未加 `--sync` 的非交互调用只保存 Key，交互终端允许勾选要更新的工具。切到其他服务商的配置不会被强制改回。

`coding-helper setup --tools claude,codex --yes` 批量装载已保存的模型配置；省略 `--tools` 时选择已安装工具。支持 `--json` 和 `--key-stdin`；stdin Key 仅在有工具成功装载后保存。缺少必选模型的工具会跳过。

- **🎯 交互式向导** — 首次运行引导配置语言、线路、API Key 和模型，步步引导
- **🌐 多线路支持** — 国内线路 (api.qnaigc.com) / 海外线路 (api.modelink.ai)
- **🔐 API Key 管理** — 输入、验证、保存、删除，一条龙管理
- **📦 模型配置** — 从 API 获取可用模型列表，也支持手动输入模型 ID
- **⚡ Claude Code 集成** — 自动将环境变量写入 `~/.claude/settings.json`
- **🧩 Codex 集成** — 自动将七牛 provider 写入 `~/.codex/config.toml`，并通过 Codex auth 保存凭证
- **🤝 CodeBuddy 集成** — 多选七牛模型市场中的模型，写入 `~/.codebuddy/models.json`
- **🤝 WorkBuddy 集成** — 多选七牛模型市场中的模型，写入 `~/.workbuddy/models.json`
- **☤ Hermes Agent 集成** — 选择七牛模型市场中的默认模型，写入 `~/.hermes/config.yaml`
- **🧱 OpenCode 集成** — 写入七牛 provider 并设为默认模型，卸载时按原值还原
- **🛡️ OpenCode 安全写入** — OpenCode 写入前备份原文件到 `~/.coding-helper/backups/`，原子写入；配置文件解析失败时报错，不会覆盖
- **🔍 健康检查** — 内置 `doctor` 命令，检测配置文件、API Key、网络、工具安装状态
- `doctor` 在 Key 有效后发送一个输出 token 的最小模型请求检查账户可用性；网络或模型错误显示为未知，不误报账户正常。
- **工具状态** — `coding-helper status` 查询安装和七牛接入状态，`--json` 输出机器可读结果，不返回 Key。接入状态描述持久配置，不代替账户或网络健康检查；检测出错时退出码为 1。
- **还原配置** — `coding-helper restore [工具名,工具名]` 按记录还原原配置，支持工具别名；不指定工具时处理有恢复记录或仍接入七牛的工具。非交互调用加 `--yes`。没有恢复记录的旧配置会保留并提示手动恢复；全部失败退出 1，部分失败退出 2。
- **🌍 国际化** — 支持中文 (zh_CN) 和英文 (en_US)

## 📋 前置要求

开始之前，请确保已安装：

- **Node.js** 18 或更高版本 ([下载](https://nodejs.org/))
- **Claude Code CLI** ([安装地址](https://claude.ai/download))、**Codex CLI** (`npm install -g @openai/codex`)、**CodeBuddy CLI** (`npm install -g @tencent-ai/codebuddy-code`)、**WorkBuddy** 和/或 **Hermes Agent** (`curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash`)
- **七牛 API Key** ([获取地址](https://portal.qiniu.com/))

## 🚀 快速开始

### 1️⃣ 运行配置向导

无需安装，直接运行：

```bash
npx qiniu-coding-helper
```

### 2️⃣ 按提示完成配置

- 选择语言（中文 / 英文）
- 选择线路（国内 / 海外）
- 输入并验证 API Key
- 选择要配置的编程助手
- 选择模型

### 3️⃣ 重启编程助手

如果 Claude Code、Codex、CodeBuddy、WorkBuddy 或 Hermes Agent 正在运行，请重启以应用配置。

### 4️⃣ 开始编程! 🎉

```bash
# Claude Code
claude

# Codex
codex

# CodeBuddy
codebuddy

# WorkBuddy（桌面应用 - 请手动启动）

# Hermes Agent
hermes
```

配置完成！现在你的编程助手已通过七牛 AI 端点运行。

---

## 📚 命令一览

### 🎬 `coding-helper init`

运行交互式配置向导（强制重新初始化）。

```bash
npx qiniu-coding-helper init
```

---

### 🔐 `coding-helper auth`

管理 API Key 认证。

```bash
# 交互式输入 API Key
npx qiniu-coding-helper auth

# 直接设置 API Key
npx qiniu-coding-helper auth <token>

# 删除 API Key
npx qiniu-coding-helper auth revoke

# 重新加载配置到 Claude Code
npx qiniu-coding-helper auth reload claude

# 重新加载配置到 Codex
npx qiniu-coding-helper auth reload codex

# 重新加载配置到 CodeBuddy
npx qiniu-coding-helper auth reload codebuddy

# 重新加载配置到 WorkBuddy
npx qiniu-coding-helper auth reload workbuddy

# 重新加载配置到 Hermes Agent
npx qiniu-coding-helper auth reload hermes
```

---

### 🌍 `coding-helper lang`

管理界面语言。

```bash
# 显示当前语言
npx qiniu-coding-helper lang show

# 设置为中文
npx qiniu-coding-helper lang set zh_CN

# 设置为英文
npx qiniu-coding-helper lang set en_US
```

---

### 🏥 `coding-helper doctor`

运行健康检查，诊断配置问题。

```bash
npx qiniu-coding-helper doctor
```

**检查项:** 配置文件 · API Key 有效性 · 网络连通性 · 已配置工具安装状态 · Git · Node.js

---

### ⚙️ `coding-helper enter`

进入交互式配置菜单。

```bash
# 进入主菜单
npx qiniu-coding-helper enter

# 进入 Claude Code 配置菜单
npx qiniu-coding-helper enter claude-code

# 进入 Codex 配置菜单
npx qiniu-coding-helper enter codex

# 进入 CodeBuddy 配置菜单
npx qiniu-coding-helper enter codebuddy

# 进入 WorkBuddy 配置菜单
npx qiniu-coding-helper enter workbuddy

# 进入 Hermes Agent 配置菜单
npx qiniu-coding-helper enter hermes
```

---

## 🔧 配置说明

### 📁 配置文件位置

| 位置 | 路径 | 用途 |
|------|------|------|
| **Coding Helper 配置** | `~/.coding-helper/config.yaml` | 语言、线路、API Key、模型设置 |
| **Claude Code 设置** | `~/.claude/settings.json` | API 端点环境变量 |
| **Claude Code Onboarding** | `~/.claude.json` | 初始化完成标记 |
| **Codex 配置** | `~/.codex/config.toml` | 七牛模型 provider 和 profile 设置 |
| **Codex Auth** | `~/.codex/auth.json` | Codex API Key 认证缓存 |
| **CodeBuddy 模型** | `~/.codebuddy/models.json` | 七牛模型条目（URL、API Key、能力标签） |
| **WorkBuddy 模型** | `~/.workbuddy/models.json` | 七牛模型条目（URL、API Key、能力标签） |
| **Hermes Agent 配置** | `~/.hermes/config.yaml` | 七牛 custom provider、默认模型和 API Key |
| **OpenCode 配置** | `~/.config/opencode/opencode.json` | 七牛 provider（`qiniu`）和默认模型 |

### 🌍 线路端点

| 线路 | 地址 | 适用场景 |
|------|------|----------|
| 🇨🇳 **国内线路** | `https://api.qnaigc.com` | 中国大陆用户 |
| 🌍 **海外线路** | `https://api.modelink.ai` | 海外用户 |

### run 启动器 / Launcher

使用 coding-helper run <tool> -- <args> 仅为子进程注入连接环境变量，不写客户端配置文件。本层定义启动接口；支持的工具由后续适配层提供。

Use coding-helper run <tool> -- <args> to launch with connection environment variables without writing client configuration. Tool adapters opt into this interface.

### 🔧 Claude Code 环境变量

配置应用后，以下环境变量会写入 `~/.claude/settings.json`：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.qnaigc.com",
    "ANTHROPIC_AUTH_TOKEN": "<your-api-key>",
    "API_TIMEOUT_MS": "3000000",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"
  }
}
```

> **说明:** 工具还会设置 `API_TIMEOUT_MS`（50 分钟，适配长时间推理请求）、禁用非必要流量（第三方端点不需要 Anthropic 遥测）、禁用 commit/PR 归属标注（通过代理端点运行时标注不准确）。

Claude Code 装载会先校验两个配置文件，并备份原值；卸载还原有记录的配置，保留之后的手动修改，存在配置但没有装载记录时明确报错并保持文件不变，请手动清理旧凭据或恢复已知备份。无还原记录但检测到七牛旧凭据时，装载也会报错，避免把旧 Key 记作原值并在卸载时恢复；先手动清理或恢复备份后重试。显式切换模型会清除 /model 保存的选择和 ANTHROPIC_MODEL，卸载时还原原值。损坏 JSON、无效的 env 或文件符号链接会阻止写入。

端点与认证令牌作为一组恢复；如果装载后只修改其中一项，卸载会停止并保留恢复记录。请先把两项一起恢复到装载后的值或原始备份，再卸载，避免把一个服务的凭据发送到另一个地址。

### 🔧 Codex 配置

Codex 使用共享事务写入 config.toml、auth.json 和模型目录，保留 MCP、沙箱设置及其他 provider。首次装载前备份原文件，卸载按记录逐字节还原；有外部修改时停止，避免覆盖。除内置 GPT 目录外，也为选中的非 GPT 模型生成能力元数据。装载移除新版 Codex 已不支持的顶层 profile 选择器，使用顶层七牛路由，并设置 file 凭据存储及 api 登录方式，与 auth.json 一致；其他 profile 定义保留，卸载还原原选择与认证配置。本层不新增多配置档或模型槽位。

### 🔧 CodeBuddy 配置

CodeBuddy 是一个 CLI 工具，配置保存在 `~/.codebuddy/models.json`。

模型配置流程会从七牛模型市场（`/v1/market/models`）拉取候选列表供你多选，能力标签（工具调用、图像、深度思考）以及上下文 / 输出 token 上限都从市场返回的元数据自动推断。每个被选中的模型都会以 `vendor: "Qiniu"` 写入，并把 API Key 嵌入条目：

```json
{
  "models": [
    {
      "id": "anthropic/claude-sonnet-4-5",
      "name": "Claude Sonnet 4.5",
      "vendor": "Qiniu",
      "url": "https://api.qnaigc.com/v1/chat/completions",
      "apiKey": "<your-api-key>",
      "maxInputTokens": 200000,
      "maxOutputTokens": 8192,
      "temperature": 0.7,
      "supportsToolCall": true,
      "supportsImages": true
    }
  ],
  "availableModels": ["anthropic/claude-sonnet-4-5"]
}
```

需要了解的行为：

- **保留非七牛条目。** 其他供应商模型和自定义顶层字段保留原值与顺序。
- **卸载还原原配置。** 没有额外编辑时逐字节还原，包括原有七牛模型；没有装载记录时明确报错并保持文件不变，请手动清理旧凭据。托管数组被修改后会拒绝重载/卸载，请先从备份恢复原数组，再卸载以清理还原记录，最后重新装载。其他顶层字段的后续编辑会保留。
- **失效模型 ID 会被显式提示。** 若先前选过的模型被市场下架，部分缺失会触发警告，仅写入仍然存在的模型；若全部下架则直接报错并保持文件不变 — 请重新选择模型后再试。

请将 `~/.codebuddy/models.json` 视为密码文件，因为其中以明文形式保存了 API Key。

### 🔧 WorkBuddy 配置

WorkBuddy 配置保存在 `~/.workbuddy/models.json`，与 CodeBuddy 完全独立。

请将 `~/.workbuddy/models.json` 视为密码文件，因为其中以明文形式保存了 API Key。

### 🔧 Hermes Agent 配置

Hermes Agent 配置保存在 `~/.hermes/config.yaml`。配置流程会从七牛模型市场选择一个默认模型，并写入 Hermes 的 OpenAI-compatible custom provider 配置：

```yaml
model:
  provider: custom
  default: anthropic/claude-sonnet-4-5
  base_url: https://api.qnaigc.com/v1
  api_key: <your-api-key>
```

卸载配置按记录逐字节还原装载前的整个文件，包括原有 provider、model、端点和 API Key；仅本工具新建的文件会删除。外部编辑会阻止重载和卸载，请先另存这些编辑，再恢复原始备份，成功卸载以清理事务记录，最后重新装载。没有恢复记录时不修改现有文件，并提示手动清理旧凭据。

请将 `~/.hermes/config.yaml` 视为密码文件，因为其中以明文形式保存了 API Key。

### 🔧 OpenCode 配置

此适配器明确支持 OpenCode 1.x，使用 `opencode-ai@1` 安装和更新，写入 v1 的 `provider/options` 格式。菜单标为 OpenCode 1.x；检测到 v2 时拒绝装载或更新，避免覆盖 v2 安装。v2 的 `providers/settings` 配置也会被拒绝，不自动迁移。

OpenCode 的全局配置在 `~/.config/opencode/opencode.json`（设置了 `XDG_CONFIG_HOME` 时在其下；`opencode.jsonc` 存在时优先使用它）。装载时添加名为 `qiniu` 的 OpenAI 兼容 provider，并把默认模型设为 `qiniu/<模型>`，其他 provider 和设置原样保留：

```json
{
  "provider": {
    "qiniu": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "https://api.qnaigc.com/v1", "apiKey": "<your-api-key>" },
      "models": { "deepseek-v3": { "name": "deepseek-v3" } }
    }
  },
  "model": "qiniu/deepseek-v3"
}
```

卸载配置会还原装载前的 `qiniu` provider 和 `model`；装载前不存在的字段会被移除。只有本工具新建且还原后为空的文件才删除；原有空对象文件保留。卸载只撤销仍与最后装载值相同的字段，保留用户后续修改；没有还原记录且任一全局配置（config.json、opencode.json 或 opencode.jsonc）存在时，明确报错并保留文件，请手动清理旧凭据或恢复已知备份，不会显示已移除。JSONC 与 JSON 同时存在时优先使用 JSONC；含注释、损坏或符号链接配置会明确报错，不会覆盖。provider 过滤禁止七牛，或 qiniu 的 whitelist/blacklist 排除所选模型时，需先调整过滤配置。装载后新增 JSONC 时，卸载仍还原原先记录的目标文件；切换装载目标前必须先卸载原目标。请求模型信息期间配置变化时需重试；装载后的托管字段被手动修改时，先卸载再重新装载。损坏或缺少写入快照的旧还原记录会报错，需要先从备份恢复。多个实例同时操作时会提示稍后重试；异常退出留下的 state.lock 只能在确认没有实例运行后手动移除。重载先保留已提交快照及待提交日志；进程中断后会根据文件内容确认写入是否完成，再继续还原。如果文件又被外部修改而无法判定，则保留恢复记录并报错。卸载不删除配置目录，避免破坏用户目录或目录符号链接。校验过滤时会按 config.json → opencode.json → opencode.jsonc 顺序计算实际配置；选中模型已有的 options、headers、variants 及非托管 limit 字段保留，并写入市场返回的 reasoning 能力。首次写入前的原值按配置文件路径分别记录在 `~/.coding-helper/state.json`，原文件备份在 `~/.coding-helper/backups/`，「清除 Coding Helper 配置」不会删除这两处。

---

## ❓ 常见问题

### Claude Code 没有使用配置的端点

1. 运行 `npx qiniu-coding-helper doctor` 检查配置
2. 运行 `npx qiniu-coding-helper auth reload claude` 重新应用设置
3. **完全重启 Claude Code**
4. 确认 shell 环境中没有设置 `ANTHROPIC_BASE_URL`（运行 `unset ANTHROPIC_BASE_URL`）

### Codex 没有使用配置的端点

1. 运行 `npx qiniu-coding-helper doctor` 检查 Codex 安装和配置
2. 运行 `npx qiniu-coding-helper auth reload codex` 重新应用设置
3. 确认 `~/.codex/config.toml` 包含 `model_provider = "qnaigc"`
4. 如果 Codex 已经在运行，请重启 Codex

### CodeBuddy 看不到七牛模型

1. 确认通过 `enter codebuddy` 完成了多选模型
2. 运行 `npx qiniu-coding-helper auth reload codebuddy` 重写 `~/.codebuddy/models.json`
3. 检查文件中存在 `vendor: "Qiniu"` 的条目且 `apiKey` 非空
4. 如果 CodeBuddy 已经在运行，请重启

### WorkBuddy 看不到七牛模型

1. 确认通过 `enter workbuddy` 完成了多选模型
2. 运行 `npx qiniu-coding-helper auth reload workbuddy` 重写 `~/.workbuddy/models.json`
3. 检查文件中存在 `vendor: "Qiniu"` 的条目且 `apiKey` 非空
4. 如果 WorkBuddy 已经在运行，请重启

### Hermes Agent 没有使用七牛模型

1. 确认通过 `enter hermes` 完成了默认模型选择
2. 运行 `npx qiniu-coding-helper auth reload hermes` 重写 `~/.hermes/config.yaml`
3. 检查 `~/.hermes/config.yaml` 中 `model.provider` 是否为 `custom`
4. 如果 Hermes Agent 已经在运行，请重启

### API 报错或认证失败

1. 检查 API Key：查看 `~/.coding-helper/config.yaml`
2. 确认选择了正确的线路（国内 / 海外）
3. 确认 API Key 在[七牛控制台](https://portal.qiniu.com/)仍有余额

### 权限被拒绝

```bash
chmod 600 ~/.claude/settings.json
chmod 600 ~/.coding-helper/config.yaml
chmod 600 ~/.codex/config.toml
chmod 600 ~/.codex/auth.json
chmod 600 ~/.hermes/config.yaml
chmod 600 ~/.codebuddy/models.json
chmod 600 ~/.workbuddy/models.json
```

---

## 🛠️ 开发

```bash
pnpm install        # 安装依赖
pnpm build          # 编译 (tsc + 复制 locales 到 dist/)
pnpm test           # 编译并运行 node:test 测试
pnpm dev            # 监听模式
pnpm start          # 运行 CLI (node dist/cli.js)
pnpm clean          # 清理 dist/
```

构建后验证：

```bash
node dist/cli.js --version
node dist/cli.js --help
node dist/cli.js doctor
pnpm test
```

---

## 📄 License

本项目基于 [AGPL-3.0](LICENSE) 协议开源。

Hermes 使用共享 YAML 编辑和事务层；恢复原始备份后须先成功卸载清理记录，再重新装载，不能直接重载。

### 自定义线路

线路菜单可保存 HTTP(S) 网关根地址（可带路径），不接受 URL 内嵌凭据、查询参数或片段。自定义线路校验失败时不会自动切换国内或海外线路；已登记地址参与 status、同步与恢复识别，恢复仍以事务记录为准。

上下文上限按工具保存，只能收窄模型上限。未设置时兼容旧全局值；工具显式选择 auto 后跟随模型上限，不影响其他工具。

Quick configuration supports `opencode --context 64k` and `auto`. Validation failures and `--dry-run` do not write client settings or save the helper preference. `--no-save` writes the client context cap but does not save the helper preference. The main menu also provides an interactive context action. Claude Code, Hermes and Copilot manage context in the client.

Profiles store named connections and per-tool bindings. Reload, sync and launch resolve the bound connection. Explicit command connection objects take precedence over bindings. Switching the active profile clears per-tool bindings; removing a profile leaves client files untouched.

### Profiles

`profile add work --key-stdin`, `profile list --json`, `profile use work [opencode,grok]`, and `profile remove work` manage named connections. Add validates before saving. `profile use work` switches helper only; `--sync` explicitly updates configured clients. `opencode @work` validates and writes that same connection and binds successful targets. Combining `@work` with a key override or `--intl` is rejected. A quick command without `@profile` uses the current global connection, overrides old bindings only for successful targets, and detaches the active profile without editing its credentials. `--no-save` and `--dry-run` never save bindings. Profile listings expose only whether a key is set.

Codex 0.134+ profiles use `~/.codex/qn-<name>.config.toml` and `codex --profile qn-<name>`. Providers live in config.toml with per-profile credentials, protected by mode 0600. Existing files and conflicting providers are preserved by refusing the operation. Added profile files join the existing multi-file journal; restore checks all files before writing and restores original bytes. Removed helper profiles are not automatically deleted from client configuration; run restore before reinstalling to remove stale providers. [Official format](https://learn.chatgpt.com/docs/config-file/config-advanced#profiles).

The shared terminal menu supports arrows, Enter, Esc, searchable rows, vendor tabs and async details. Letter shortcuts are not used for menu actions. Narrow terminals hide the value column.

Shared prompts distinguish Esc cancellation from empty input. Checkbox selection and masked secret entry are available for the new menu flows; secrets are never echoed in full.

Model search matches vendor aliases, punctuation-free model IDs, context sizes such as 200k, and vision capability. Exact/prefix matches rank before recommendations and recent selections; unmatched input offers nearby model IDs.
When model metadata is offline, context caps only narrow already verified client limits and retain known modality metadata. A 64k cap cannot expand a client limit already known to be 32k.
