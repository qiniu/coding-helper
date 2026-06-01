<div align="center">

# 🚀 qiniu-coding-helper

[![npm version](https://badge.fury.io/js/qiniu-coding-helper.svg)](https://www.npmjs.com/package/qiniu-coding-helper)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Node.js Version](https://img.shields.io/node/v/qiniu-coding-helper.svg)](https://nodejs.org)

**一站式配置 Claude Code、Codex、CodeBuddy、WorkBuddy 和 Hermes Agent 使用七牛 AI API 端点的 CLI 工具**

[English](README.en-US.md) · [支持的工具](#-支持的工具) · [功能特性](#-功能特性) · [前置要求](#-前置要求) · [快速开始](#-快速开始) · [命令一览](#-命令一览) · [配置说明](#-配置说明) · [常见问题](#-常见问题)

</div>

---

## 🧰 支持的工具

| 工具 | 类型 | 写入的配置 |
|------|------|------------|
| Claude Code | CLI | `~/.claude/settings.json`、`~/.claude.json` |
| Codex | CLI | `~/.codex/config.toml`、`~/.codex/auth.json` |
| CodeBuddy | CLI | `~/.codebuddy/models.json` |
| WorkBuddy | 桌面应用 | `~/.workbuddy/models.json` |
| Hermes Agent | CLI | `~/.hermes/config.yaml` |

## ✨ 功能特性

- **🎯 交互式向导** — 首次运行引导配置语言、线路、API Key 和模型，步步引导
- **🌐 多线路支持** — 国内线路 (openai.qiniu.com) / 国内备用线路 (api.qnaigc.com) / 海外线路 (openai.sufy.com) / Modelink 线路 (api.modelink.ai)
- **🔐 API Key 管理** — 输入、验证、保存、删除，一条龙管理
- **📦 模型配置** — 从 API 获取可用模型列表，也支持手动输入模型 ID
- **⚡ Claude Code 集成** — 自动将环境变量写入 `~/.claude/settings.json`
- **🧩 Codex 集成** — 自动将七牛 provider 写入 `~/.codex/config.toml`，并通过 Codex auth 保存凭证
- **🤝 CodeBuddy 集成** — 多选七牛模型市场中的模型，写入 `~/.codebuddy/models.json`
- **🤝 WorkBuddy 集成** — 多选七牛模型市场中的模型，写入 `~/.workbuddy/models.json`
- **☤ Hermes Agent 集成** — 选择七牛模型市场中的默认模型，写入 `~/.hermes/config.yaml`
- **🔍 健康检查** — 内置 `doctor` 命令，检测配置文件、API Key、网络、工具安装状态
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

### 🌍 线路端点

| 线路 | 地址 | 适用场景 |
|------|------|----------|
| 🇨🇳 **国内线路** | `https://openai.qiniu.com` | 中国大陆用户 |
| 🇨🇳 **国内备用线路** | `https://api.qnaigc.com` | 中国大陆用户 |
| 🌍 **海外线路** | `https://openai.sufy.com` | 海外用户 |
| 🔁 **Modelink 线路** | `https://api.modelink.ai` | 国内外通用 |

### 🔧 Claude Code 环境变量

配置应用后，以下环境变量会写入 `~/.claude/settings.json`：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://openai.qiniu.com",
    "ANTHROPIC_AUTH_TOKEN": "<your-api-key>",
    "API_TIMEOUT_MS": "3000000",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"
  }
}
```

> **说明:** 工具还会设置 `API_TIMEOUT_MS`（50 分钟，适配长时间推理请求）、禁用非必要流量（第三方端点不需要 Anthropic 遥测）、禁用 commit/PR 归属标注（通过代理端点运行时标注不准确）。

### 🔧 Codex 配置

配置应用后，Coding Helper 会将七牛模型 provider 写入 `~/.codex/config.toml`，并将 API Key 写入 Codex 自己的 `~/.codex/auth.json` 认证缓存。它不依赖 `QINIU_API_KEY` shell 环境变量。

托管的 Codex profile 使用七牛 OpenAI 兼容 bypass 端点：

```toml
model_provider = "qnaigc"

[model_providers.qnaigc]
name = "Qiniu"
base_url = "https://openai.qiniu.com/bypass/openai/v1"
requires_openai_auth = true
wire_api = "responses"

[profiles.qn-gpt]
model_provider = "qnaigc"
model = "<selected-model>"
```

请将 `~/.codex/auth.json` 视为密码文件，因为其中包含 API 凭证。

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
      "url": "https://openai.qiniu.com/v1/chat/completions",
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

- **保留非七牛条目。** `vendor` 不是 `Qiniu` 的模型，以及你手动添加在 `models.json` 顶层的其他字段（如 UI 偏好），在每次装载/卸载时都会被原样保留。
- **卸载只移除七牛模型。** `auth reload` 会覆盖七牛条目；卸载会清掉它们，但其他厂商条目不会动。
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
  base_url: https://openai.qiniu.com/v1
  api_key: <your-api-key>
```

卸载配置会移除 Coding Helper 托管的 `model.provider`、`model.default`、`model.base_url` 和 `model.api_key` 字段，并保留 Hermes 的其他配置。

请将 `~/.hermes/config.yaml` 视为密码文件，因为其中以明文形式保存了 API Key。

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
