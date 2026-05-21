<div align="center">

# 🚀 qiniu-coding-helper

[![npm version](https://badge.fury.io/js/qiniu-coding-helper.svg)](https://www.npmjs.com/package/qiniu-coding-helper)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Node.js Version](https://img.shields.io/node/v/qiniu-coding-helper.svg)](https://nodejs.org)

**The CLI helper for configuring Claude Code, Codex, CodeBuddy, and WorkBuddy with Qiniu AI API endpoints**

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
- **🤝 CodeBuddy Integration** — Multi-select Qiniu market models and write them into `~/.codebuddy/models.json`
- **🤝 WorkBuddy Integration** — Multi-select Qiniu market models and write them into `~/.workbuddy/models.json`
- **🔍 Health Check** — Built-in `doctor` command to verify config, API Key, network, tools, Git, and Node.js
- **🌍 Internationalization** — Supports Chinese (zh_CN) and English (en_US)

## 📋 Prerequisites

Before you begin, ensure you have:

- **Node.js** 18 or later ([Download](https://nodejs.org/))
- **Claude Code CLI** installed ([Get it here](https://claude.ai/download)), **Codex CLI** installed (`npm install -g @openai/codex`), **CodeBuddy CLI** installed (`npm install -g @tencent-ai/codebuddy-code`), and/or **WorkBuddy** installed
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

If Claude Code, Codex, CodeBuddy, or WorkBuddy is running, restart it to apply changes.

### 4️⃣ Start Coding! 🎉

```bash
# Claude Code
claude

# Codex
codex

# CodeBuddy
codebuddy

# WorkBuddy (desktop app - launch manually)
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

# Reload configuration to CodeBuddy
npx qiniu-coding-helper auth reload codebuddy

# Reload configuration to WorkBuddy
npx qiniu-coding-helper auth reload workbuddy
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

# CodeBuddy configuration menu
npx qiniu-coding-helper enter codebuddy

# WorkBuddy configuration menu
npx qiniu-coding-helper enter workbuddy
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
| **CodeBuddy Models** | `~/.codebuddy/models.json` | Qiniu model entries (URL, API Key, capabilities) |
| **WorkBuddy Models** | `~/.workbuddy/models.json` | Qiniu model entries (URL, API Key, capabilities) |

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

The managed Codex profile uses the Qiniu OpenAI-compatible bypass endpoint:

```toml
model_provider = "qnaigc"

[model_providers.qnaigc]
name = "Qiniu"
base_url = "https://api.qnaigc.com/bypass/openai/v1"
requires_openai_auth = true
wire_api = "responses"

[profiles.qn-gpt]
model_provider = "qnaigc"
model = "<selected-model>"
```

Treat `~/.codex/auth.json` like a password because it contains API credentials.

### 🔧 CodeBuddy Configuration

CodeBuddy is a CLI tool that stores its configuration in `~/.codebuddy/models.json`.

The configuration flow lets you multi-select models from the Qiniu model market (`/v1/market/models`); capability tags (tool call, images, reasoning) and context / output token limits are inferred from the market metadata. Each selected model is written as a `vendor: "Qiniu"` entry with the API Key embedded:

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

Behavior worth knowing:

- **Non-Qiniu entries are preserved.** Models with a different `vendor` and any other top-level fields you added manually (e.g. UI preferences) are kept untouched on every load/unload.
- **Unload only removes Qiniu models.** `auth reload` overwrites the Qiniu entries; the unload action removes them but leaves other vendors intact.
- **Stale model IDs are surfaced.** If a previously selected model has been delisted from the Qiniu market, partially missing IDs trigger a warning and only the still-available models are written; if *all* selected IDs have been delisted, the load fails fast and no file changes are made — reconfigure your model selection and retry.

Treat `~/.codebuddy/models.json` like a password because the API Key is stored in plaintext.

### 🔧 WorkBuddy Configuration

WorkBuddy stores its configuration in `~/.workbuddy/models.json`. It is completely independent from CodeBuddy.

The configuration flow is identical to CodeBuddy — you multi-select models from the Qiniu model market and they are written to the WorkBuddy-specific config file with the same JSON structure. All the same behavior rules apply (non-Qiniu entries preserved, unload only removes Qiniu models, stale model IDs surfaced).

Treat `~/.workbuddy/models.json` like a password because the API Key is stored in plaintext.

---

## ❓ FAQ

### Claude Code doesn't use the configured endpoint

1. Run `npx qiniu-coding-helper doctor` to check configuration
2. Run `npx qiniu-coding-helper auth reload claude` to reapply settings
3. **Restart Claude Code completely**
4. Ensure `ANTHROPIC_BASE_URL` is not set in your shell environment (`unset ANTHROPIC_BASE_URL`)

### Codex doesn't use the configured endpoint

1. Run `npx qiniu-coding-helper doctor` to check Codex installation and configuration
2. Run `npx qiniu-coding-helper auth reload codex` to reapply settings
3. Confirm `~/.codex/config.toml` contains `model_provider = "qnaigc"`
4. Restart Codex if it was already running

### CodeBuddy doesn't see the Qiniu models

1. Make sure you ran `enter codebuddy` and finished the multi-select picker
2. Run `npx qiniu-coding-helper auth reload codebuddy` to rewrite `~/.codebuddy/models.json`
3. Confirm the Qiniu entries exist in the file with `vendor: "Qiniu"` and a non-empty `apiKey`
4. Restart CodeBuddy if it was already running

### WorkBuddy doesn't see the Qiniu models

1. Make sure you ran `enter workbuddy` and finished the multi-select picker
2. Run `npx qiniu-coding-helper auth reload workbuddy` to rewrite `~/.workbuddy/models.json`
3. Confirm the Qiniu entries exist in the file with `vendor: "Qiniu"` and a non-empty `apiKey`
4. Restart WorkBuddy if it was already running

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
chmod 600 ~/.codebuddy/models.json
chmod 600 ~/.workbuddy/models.json
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
pnpm test
```

---

## 📄 License

This project is licensed under the [AGPL-3.0](LICENSE) License.
