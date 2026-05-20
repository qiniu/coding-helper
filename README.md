<div align="center">

# 🚀 qiniu-coding-helper

[![npm version](https://badge.fury.io/js/qiniu-coding-helper.svg)](https://www.npmjs.com/package/qiniu-coding-helper)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Node.js Version](https://img.shields.io/node/v/qiniu-coding-helper.svg)](https://nodejs.org)

**The CLI helper for configuring AI coding assistants with Qiniu AI API endpoints**

[简体中文](README.zh-CN.md) · [Features](#-features) · [Quick Start](#-quick-start) · [Commands](#-commands) · [Configuration](#-configuration) · [FAQ](#-faq)

</div>

---

## ✨ Features

- **🎯 Interactive Wizard** — Guided step-by-step setup for language, endpoint, API Key, and model on first run
- **🌐 Multi-Region Support** — Domestic (api.qnaigc.com) / International (openai.sufy.com) endpoints
- **🔐 API Key Management** — Input, validate, save, and revoke API keys
- **📦 Model Configuration** — Fetch available models from the API, with manual model ID input support
- **⚡ Claude Code Integration** — Automatically writes environment variables to `~/.claude/settings.json`
- **🧩 Codex Integration** — Writes Qiniu provider settings to `~/.codex/config.toml` and stores credentials in Codex auth
- **🦀 OpenClaw Integration** — Uses OpenClaw's config CLI to register a Qiniu OpenAI-compatible provider and default model
- **🔍 Health Check** — Built-in `doctor` command to verify config, API Key, network, tools, Git, and Node.js
- **🌍 Internationalization** — Supports Chinese (zh_CN) and English (en_US)

## 📋 Prerequisites

Before you begin, ensure you have:

- **Node.js** 18 or later ([Download](https://nodejs.org/))
- **Claude Code CLI** installed ([Get it here](https://claude.ai/download)), **Codex CLI** installed (`npm install -g @openai/codex`), and/or **OpenClaw CLI** installed
- **Qiniu API Key** ([Get one here](https://portal.qiniu.com/))

## 🚀 Quick Start

### 1️⃣ Run the Setup Wizard

No installation required — just run:

```bash
npx qiniu-coding-helper
```

### 2️⃣ Follow the Interactive Prompts

- Select your language (Chinese / English)
- Choose your endpoint (Domestic / International)
- Enter and validate your API Key
- Select the coding assistant you want to configure
- Pick a model

### 3️⃣ Restart Your Coding Assistant

If Claude Code, Codex, or OpenClaw is running, restart it to apply changes when needed.

### 4️⃣ Start Coding! 🎉

```bash
# Claude Code
claude

# Codex
codex

# OpenClaw
openclaw
```

That's it! You're now using Qiniu AI endpoints in your coding assistant.

---

## 📚 Commands

### 🎬 `coding-helper init`

Run the interactive setup wizard (force re-initialization).

```bash
npx qiniu-coding-helper init
```

---

### 🔐 `coding-helper auth`

Manage your API Key authentication.

```bash
# Set API Key interactively
npx qiniu-coding-helper auth

# Set API Key directly
npx qiniu-coding-helper auth <token>

# Remove API Key
npx qiniu-coding-helper auth revoke

# Reload configuration to Claude Code
npx qiniu-coding-helper auth reload claude

# Reload configuration to Codex
npx qiniu-coding-helper auth reload codex

# Reload configuration to OpenClaw
npx qiniu-coding-helper auth reload openclaw
```

---

### 🌍 `coding-helper lang`

Manage interface language.

```bash
# Show current language
npx qiniu-coding-helper lang show

# Set to Chinese
npx qiniu-coding-helper lang set zh_CN

# Set to English
npx qiniu-coding-helper lang set en_US
```

---

### 🏥 `coding-helper doctor`

Run system health check to diagnose configuration issues.

```bash
npx qiniu-coding-helper doctor
```

**Checks:** Config files · API Key validity · Network connectivity · configured tool installations · Git · Node.js

---

### ⚙️ `coding-helper enter`

Enter the interactive configuration menu.

```bash
# Main menu
npx qiniu-coding-helper enter

# Claude Code configuration menu
npx qiniu-coding-helper enter claude-code

# Codex configuration menu
npx qiniu-coding-helper enter codex

# OpenClaw configuration menu
npx qiniu-coding-helper enter openclaw
```

---

## 🔧 Configuration

### 📁 Storage Locations

| Location | Path | Purpose |
|----------|------|---------|
| **Coding Helper Config** | `~/.coding-helper/config.yaml` | Language, endpoint, API Key, model settings |
| **Claude Code Settings** | `~/.claude/settings.json` | API endpoint environment variables |
| **Claude Code Onboarding** | `~/.claude.json` | Onboarding completion flag |
| **Codex Config** | `~/.codex/config.toml` | Qiniu model provider and profile settings |
| **Codex Auth** | `~/.codex/auth.json` | Codex API key auth cache |
| **OpenClaw Config** | `~/.openclaw/openclaw.json` | Qiniu custom provider, API key env, and default model |

### 🌍 Region Endpoints

| Region | Base URL | Best For |
|--------|----------|----------|
| 🇨🇳 **Domestic** | `https://api.qnaigc.com` | Users in China |
| 🌍 **International** | `https://openai.sufy.com` | Users outside China |

### 🔧 Claude Code Environment Variables

When configuration is applied, these environment variables are set in `~/.claude/settings.json`:

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

> **Note:** The tool also sets `API_TIMEOUT_MS` (50 min, for long inference requests), disables non-essential traffic (telemetry not needed for third-party endpoints), and disables commit/PR attribution (inaccurate via proxy endpoints).

### 🔧 Codex Configuration

When Codex configuration is applied, Coding Helper writes the Qiniu model provider to `~/.codex/config.toml` and stores the API Key in Codex's own `~/.codex/auth.json` auth cache. It does not rely on a `QINIU_API_KEY` shell environment variable.

Treat `~/.codex/auth.json` like a password because it contains API credentials.

### 🔧 OpenClaw Configuration

When OpenClaw configuration is applied, Coding Helper calls `openclaw config set` to register a Qiniu OpenAI-compatible provider under `models.providers.qnaigc`, stores the API Key as `env.QINIU_API_KEY`, and sets the default model to `qnaigc/<selected-model>`.

The managed OpenClaw provider uses the Qiniu OpenAI-compatible endpoint:

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

OpenClaw gateway, channels, daemon, workspace, and pairing setup remain managed by OpenClaw itself.

---

## ❓ FAQ

### Claude Code doesn't use the configured endpoint

1. Run `npx qiniu-coding-helper doctor` to check configuration
2. Run `npx qiniu-coding-helper auth reload claude` to reapply settings
3. **Restart Claude Code completely**
4. Ensure `ANTHROPIC_BASE_URL` is not set in your shell environment (`unset ANTHROPIC_BASE_URL`)

### OpenClaw doesn't use the configured endpoint

1. Run `npx qiniu-coding-helper doctor` to check OpenClaw installation and configuration
2. Run `npx qiniu-coding-helper auth reload openclaw` to reapply settings
3. Confirm `~/.openclaw/openclaw.json` contains `models.providers.qnaigc`
4. Run `openclaw doctor` if the OpenClaw gateway reports a config validation error

### API errors or authentication failures

1. Verify your API Key: check `~/.coding-helper/config.yaml`
2. Confirm the correct endpoint is selected (Domestic vs International)
3. Ensure your API Key has remaining quota on the [Qiniu Portal](https://portal.qiniu.com/)

### Permission denied errors

```bash
chmod 600 ~/.claude/settings.json
chmod 600 ~/.coding-helper/config.yaml
chmod 600 ~/.codex/config.toml
chmod 600 ~/.codex/auth.json
chmod 600 ~/.openclaw/openclaw.json
```

---

## 🛠️ Development

```bash
pnpm install        # Install dependencies
pnpm build          # Build (tsc + copy locales to dist/)
pnpm test           # Build and run node:test tests
pnpm dev            # Watch mode
pnpm start          # Run CLI (node dist/cli.js)
pnpm clean          # Clean dist/
```

Verify after build:

```bash
node dist/cli.js --version
node dist/cli.js --help
node dist/cli.js doctor
```

---

## 📄 License

This project is licensed under the [AGPL-3.0](LICENSE) License.
