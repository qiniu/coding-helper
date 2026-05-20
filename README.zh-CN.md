<div align="center">

# 🚀 qiniu-coding-helper

[![npm version](https://badge.fury.io/js/qiniu-coding-helper.svg)](https://www.npmjs.com/package/qiniu-coding-helper)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Node.js Version](https://img.shields.io/node/v/qiniu-coding-helper.svg)](https://nodejs.org)

**一站式配置 AI 编程助手使用七牛 AI API 端点的 CLI 工具**

[English](README.md) · [功能特性](#-功能特性) · [快速开始](#-快速开始) · [命令一览](#-命令一览) · [配置说明](#-配置说明) · [常见问题](#-常见问题)

</div>

---

## ✨ 功能特性

- **🎯 交互式向导** — 首次运行引导配置语言、线路、API Key 和模型，步步引导
- **🌐 多线路支持** — 国内线路 (api.qnaigc.com) / 海外线路 (openai.sufy.com)
- **🔐 API Key 管理** — 输入、验证、保存、删除，一条龙管理
- **📦 模型配置** — 从 API 获取可用模型列表，也支持手动输入模型 ID
- **⚡ Claude Code 集成** — 自动将环境变量写入 `~/.claude/settings.json`
- **🧩 Codex 集成** — 将七牛 provider 写入 `~/.codex/config.toml`，并把凭证保存到 Codex auth
- **🦀 OpenClaw 集成** — 通过 OpenClaw 配置 CLI 注册七牛 OpenAI 兼容 provider 和默认模型
- **🔍 健康检查** — 内置 `doctor` 命令，检测配置文件、API Key、网络、工具安装状态
- **🌍 国际化** — 支持中文 (zh_CN) 和英文 (en_US)

## 📋 前置要求

开始之前，请确保已安装：

- **Node.js** 18 或更高版本 ([下载](https://nodejs.org/))
- **Claude Code CLI** ([安装地址](https://claude.ai/download))、**Codex CLI** (`npm install -g @openai/codex`) 和/或 **OpenClaw CLI**
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

如果 Claude Code、Codex 或 OpenClaw 正在运行，请按需重启以应用配置。

### 4️⃣ 开始编程! 🎉

```bash
# Claude Code
claude

# Codex
codex

# OpenClaw
openclaw
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

# 重新加载配置到 OpenClaw
npx qiniu-coding-helper auth reload openclaw
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

# 进入 OpenClaw 配置菜单
npx qiniu-coding-helper enter openclaw
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
| **OpenClaw 配置** | `~/.openclaw/openclaw.json` | 七牛 custom provider、API Key env 和默认模型 |

### 🌍 线路端点

| 线路 | 地址 | 适用场景 |
|------|------|----------|
| 🇨🇳 **国内线路** | `https://api.qnaigc.com` | 中国大陆用户 |
| 🌍 **海外线路** | `https://openai.sufy.com` | 海外用户 |

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

### 🔧 Codex 配置

配置应用到 Codex 时，Coding Helper 会将七牛模型 provider 写入 `~/.codex/config.toml`，并把 API Key 保存到 Codex 自己的 `~/.codex/auth.json` 认证缓存，不依赖 `QINIU_API_KEY` shell 环境变量。

请像保管密码一样保管 `~/.codex/auth.json`，因为它包含 API 凭证。

### 🔧 OpenClaw 配置

配置应用到 OpenClaw 时，Coding Helper 会调用 `openclaw config set`，在 `models.providers.qnaigc` 下注册七牛 OpenAI 兼容 provider，把 API Key 保存为 `env.QINIU_API_KEY`，并将默认模型设置为 `qnaigc/<selected-model>`。

托管的 OpenClaw provider 使用七牛 OpenAI 兼容端点：

```json
{
  "env": {
    "QINIU_API_KEY": "<your-api-key>"
  },
  "models": {
    "mode": "merge",
    "providers": {
      "qnaigc": {
        "baseUrl": "https://api.qnaigc.com/v1",
        "apiKey": "${QINIU_API_KEY}",
        "api": "openai-completions",
        "models": [
          {
            "id": "<selected-model>",
            "name": "<selected-model>"
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "qnaigc/<selected-model>"
      }
    }
  }
}
```

OpenClaw 的 gateway、channels、daemon、workspace 和 pairing 设置仍由 OpenClaw 自身管理。

---

## ❓ 常见问题

### Claude Code 没有使用配置的端点

1. 运行 `npx qiniu-coding-helper doctor` 检查配置
2. 运行 `npx qiniu-coding-helper auth reload claude` 重新应用设置
3. **完全重启 Claude Code**
4. 确认 shell 环境中没有设置 `ANTHROPIC_BASE_URL`（运行 `unset ANTHROPIC_BASE_URL`）

### OpenClaw 没有使用配置的端点

1. 运行 `npx qiniu-coding-helper doctor` 检查 OpenClaw 安装和配置
2. 运行 `npx qiniu-coding-helper auth reload openclaw` 重新应用设置
3. 确认 `~/.openclaw/openclaw.json` 包含 `models.providers.qnaigc`
4. 如果 OpenClaw gateway 报配置校验错误，运行 `openclaw doctor` 查看原因

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
chmod 600 ~/.openclaw/openclaw.json
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
```

---

## 📄 License

本项目基于 [AGPL-3.0](LICENSE) 协议开源。
