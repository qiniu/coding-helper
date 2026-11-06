<div align="center">

# 🚀 qiniu-coding-helper

[![npm version](https://badge.fury.io/js/qiniu-coding-helper.svg)](https://www.npmjs.com/package/qiniu-coding-helper)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Node.js Version](https://img.shields.io/node/v/qiniu-coding-helper.svg)](https://nodejs.org)

**The CLI helper for configuring Claude Code, Codex, CodeBuddy, WorkBuddy, Hermes Agent, and OpenCode with Qiniu AI API endpoints**

[简体中文](README.md) · [Supported Tools](#-supported-tools) · [Features](#-features) · [Prerequisites](#-prerequisites) · [Quick Start](#-quick-start) · [Commands](#-commands) · [Configuration](#-configuration) · [FAQ](#-faq)

</div>

---

## 🧰 Supported Tools

| Tool | Type | Managed Configuration |
|------|------|-----------------------|
| MiniMax Code | CLI | [配置说明 / Configuration](docs/tools/minimax-code.md) |
| GitHub Copilot CLI | CLI | [启动器 / Launcher](docs/tools/copilot.md) |
| Claude Code | CLI | `~/.claude/settings.json`, `~/.claude.json` |
| Qwen Code | CLI | [配置说明 / Configuration](docs/tools/qwen-code.md) |
| Codex | CLI | `~/.codex/config.toml`, `~/.codex/auth.json` |
| Kimi Code CLI | CLI | [配置说明 / Configuration](docs/tools/kimi-code.md) |
| CodeBuddy | CLI | `~/.codebuddy/models.json` |
| Grok CLI | CLI | [配置说明 / Configuration](docs/tools/grok.md) |
| WorkBuddy | Desktop app | `~/.workbuddy/models.json` |
| OpenClaw | CLI | [配置说明 / Configuration](docs/tools/openclaw.md) |
| Hermes Agent | CLI | `~/.hermes/config.yaml` |
| Factory Droid | CLI | [配置说明 / Configuration](docs/tools/droid.md) |
| OpenCode | CLI | `~/.config/opencode/opencode.json` |

## ✨ Features

`coding-helper auth <key> --sync` updates clients still configured for Qiniu and returns nonzero on failures; the same key can be retried. Without `--sync`, non-interactive calls only save the key, while terminals offer a tool selection. Other providers are preserved.

`coding-helper setup --tools claude,codex --yes` configures selected tools using saved models; omit `--tools` to select installed tools. Supports `--json` and `--key-stdin`; a stdin key is saved only after a successful tool configuration. Tools requiring an unselected model are skipped.

- **🎯 Interactive Wizard** — Guided step-by-step setup for language, endpoint, API Key, and model on first run
- **🌐 Multi-Region Support** — Domestic (api.qnaigc.com) / International (api.modelink.ai) endpoints
- **🔐 API Key Management** — Input, validate, save, and revoke API keys
- **📦 Model Configuration** — Fetch available models from the API, with manual model ID input support
- **⚡ Claude Code Integration** — Automatically writes environment variables to `~/.claude/settings.json`
- **🧩 Codex Integration** — Writes Qiniu provider settings to `~/.codex/config.toml` and stores credentials in Codex auth
- **🤝 CodeBuddy Integration** — Multi-select Qiniu market models and write them into `~/.codebuddy/models.json`
- **🤝 WorkBuddy Integration** — Multi-select Qiniu market models and write them into `~/.workbuddy/models.json`
- **☤ Hermes Agent Integration** — Select a default Qiniu market model and write it into `~/.hermes/config.yaml`
- **🧱 OpenCode Integration** — Add a Qiniu provider and make it the default model; unloading restores the previous values
- **🛡️ OpenCode safe writes** — For OpenCode, back up the original file to `~/.coding-helper/backups/` and write atomically; a config that fails to parse is reported, never overwritten
- **🔍 Health Check** — Built-in `doctor` command to verify config, API Key, network, tools, Git, and Node.js
- After validating the key, `doctor` sends a minimal one-output-token model request to check account availability; network or model errors remain unknown rather than being reported as healthy.
- **Tool status** — `coding-helper status` shows installation and Qiniu configuration state. Add `--json` for machine-readable output without API keys. Configuration state does not verify account or network health; detection errors return exit code 1.
- **Restore settings** — `coding-helper restore [tool,tool]` restores recorded originals and accepts tool aliases. With no tool names, it selects tools with restoration records or Qiniu configuration. Non-interactive calls require `--yes`. Legacy configuration without a restoration record is preserved with recovery guidance; exit codes are 1 for complete failure and 2 for partial failure.
- **🌍 Internationalization** — Supports Chinese (zh_CN) and English (en_US)

## 📋 Prerequisites

Before you begin, ensure you have:

- **Node.js** 18 or later ([Download](https://nodejs.org/))
- **Claude Code CLI** installed ([Get it here](https://claude.ai/download)), **Codex CLI** installed (`npm install -g @openai/codex`), **CodeBuddy CLI** installed (`npm install -g @tencent-ai/codebuddy-code`), **WorkBuddy**, and/or **Hermes Agent** (`curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash`)
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

If Claude Code, Codex, CodeBuddy, WorkBuddy, or Hermes Agent is running, restart it to apply changes.

### 4️⃣ Start Coding! 🎉

```bash
# Claude Code
claude

# Codex
codex

# CodeBuddy
codebuddy

# WorkBuddy (desktop app - launch manually)

# Hermes Agent
hermes
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

# Reload configuration to Hermes Agent
npx qiniu-coding-helper auth reload hermes
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

# Hermes Agent configuration menu
npx qiniu-coding-helper enter hermes
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
| **Hermes Agent Config** | `~/.hermes/config.yaml` | Qiniu custom provider, default model, and API Key |
| **OpenCode Config** | `~/.config/opencode/opencode.json` | Qiniu provider (`qiniu`) and default model |

### 🌍 Region Endpoints

| Region | Base URL | Best For |
|--------|----------|----------|
| 🇨🇳 **Domestic** | `https://api.qnaigc.com` | Users in China |
| 🌍 **International** | `https://api.modelink.ai` | Users outside China |

### run 启动器 / Launcher

使用 coding-helper run <tool> -- <args> 仅为子进程注入连接环境变量，不写客户端配置文件。本层定义启动接口；支持的工具由后续适配层提供。

Use coding-helper run <tool> -- <args> to launch with connection environment variables without writing client configuration. Tool adapters opt into this interface.

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

Claude Code loading now backs up and validates both configuration files before writing. Unload restores recorded originals, preserves subsequent user edits, and reports an actionable error without changing existing files that have no load record. Loading also rejects unrecorded legacy Qiniu credentials so unloading cannot restore an old key as an original; remove those credentials manually or recover a known backup before retrying. Explicit model selection clears the saved /model override and ANTHROPIC_MODEL; unloading restores their original values. Invalid JSON, malformed env, and file symlinks block writes.

The endpoint and authentication token are restored as a pair. Editing only one after loading blocks unload and keeps recovery records. Restore both to their applied values or original backup before unloading, so a credential is never paired with a different service's address.

### 🔧 Codex Configuration

Codex uses a shared transaction for config.toml, auth.json and the model catalog. MCP, sandbox options and other providers are preserved. Originals are backed up and restored byte-for-byte on unload; external edits block replacement. Selected non-GPT models receive catalog metadata alongside the built-in GPT entries. Loading removes the obsolete top-level profile selector, selects Qiniu through root settings, and sets file credential storage and API login to match auth.json. Other profile definitions remain; unloading restores the original selection and authentication settings. This layer adds no multi-profile or model-slot features.

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
- **Unload restores the recorded original.** Unchanged configurations return byte-for-byte to their original content, including pre-existing Qiniu models. Without a load record, unload reports an error and leaves the file unchanged; remove legacy credentials manually. Changes to managed arrays block reload/unload rather than overwrite user edits; restore the original arrays from backup, unload to clear the restoration record, then load again. Unrelated top-level edits are preserved.
- **Stale model IDs are surfaced.** If a previously selected model has been delisted from the Qiniu market, partially missing IDs trigger a warning and only the still-available models are written; if *all* selected IDs have been delisted, the load fails fast and no file changes are made — reconfigure your model selection and retry.

Treat `~/.codebuddy/models.json` like a password because the API Key is stored in plaintext.

### 🔧 WorkBuddy Configuration

WorkBuddy stores its configuration in `~/.workbuddy/models.json`. It is completely independent from CodeBuddy.

The configuration flow is identical to CodeBuddy — you multi-select models from the Qiniu model market and they are written to the WorkBuddy-specific config file with the same JSON structure. All the same behavior rules apply (non-Qiniu entries preserved, recorded originals restored on unload, stale model IDs surfaced).

Treat `~/.workbuddy/models.json` like a password because the API Key is stored in plaintext.

### 🔧 Hermes Agent Configuration

Hermes Agent stores its configuration in `~/.hermes/config.yaml`. The configuration flow selects one default model from the Qiniu model market and writes Hermes' OpenAI-compatible custom provider settings:

```yaml
model:
  provider: custom
  default: anthropic/claude-sonnet-4-5
  base_url: https://api.qnaigc.com/v1
  api_key: <your-api-key>
```

Unloading restores the entire pre-load file byte-for-byte, including its provider, model, endpoint, and API key; only helper-created files are removed. External edits block reload and unload. Save those edits separately, restore the original backup, successfully unload to clear the transaction record, then load again. Without restoration state, existing files remain unchanged and legacy credentials require manual recovery.

Treat `~/.hermes/config.yaml` like a password because the API Key is stored in plaintext.

### 🔧 OpenCode Configuration

This adapter supports OpenCode 1.x and installs/updates `opencode-ai@1`, using the v1 `provider/options` schema. The menu identifies it as OpenCode 1.x. Loading and updating reject detected v2 clients; v2 `providers/settings` configurations are rejected without migration or overwriting the v2 installation.

OpenCode's global config lives at `~/.config/opencode/opencode.json` (under `XDG_CONFIG_HOME` when set; `opencode.jsonc` takes precedence when present). Loading adds an OpenAI-compatible provider named `qiniu` and sets the default model to `qiniu/<model>`, leaving other providers and settings untouched:

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

Unloading restores the previous `qiniu` provider and `model`, removing fields that did not exist before; only files created by this helper are removed when restoration leaves an empty object. Existing empty files are retained. Unloading only reverses fields that still match the last applied values, preserving subsequent edits. Without restoration state, an existing global config.json, opencode.json or opencode.jsonc causes an actionable error and remains unchanged; remove legacy credentials manually or recover a known backup. It is not reported as successfully removed. When both JSONC and JSON exist, JSONC takes precedence. Commented, malformed, or symlinked configurations are rejected without overwriting them. Provider filters must allow Qiniu, and its whitelist/blacklist must allow the selected model before loading. If JSONC appears after loading, unloading still restores the recorded target; unload before switching the managed target file. Retry if configuration changes while model metadata is being fetched. If managed fields change after loading, unload before loading again. Corrupt or legacy restoration records without an applied snapshot require recovery from backup. Concurrent helper instances fail with a retry message; remove a stale state.lock after a crash only after confirming no helper instance is running. Reloads retain the committed snapshot and a pending journal until the client write completes. After an interruption, recovery identifies the written version before restoring it. If later edits make this ambiguous, it keeps the journal and reports an error. Unloading leaves configuration directories intact, including directory symlink targets. Filters are evaluated in config.json → opencode.json → opencode.jsonc order. Existing options, headers, variants, and unmanaged limit fields of the selected model are preserved, and market reasoning capability is propagated. Original values are tracked separately for each configuration path in `~/.coding-helper/state.json` and the original file is backed up under `~/.coding-helper/backups/`; "Clear Coding Helper Configuration" keeps both.

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

### Hermes Agent doesn't use the Qiniu model

1. Make sure you ran `enter hermes` and selected a default model
2. Run `npx qiniu-coding-helper auth reload hermes` to rewrite `~/.hermes/config.yaml`
3. Confirm `model.provider` is `custom` in `~/.hermes/config.yaml`
4. Restart Hermes Agent if it was already running

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
chmod 600 ~/.hermes/config.yaml
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

Hermes uses shared YAML editing and guarded transactions. After restoring the original backup, successfully unload to clear the transaction record before loading again; do not retry reload directly.
