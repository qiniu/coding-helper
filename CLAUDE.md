# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Coding Helper — CLI 工具，用于统一配置 AI 编程助手（Claude Code、OpenCode、Codex）的 API 端点和模型。支持七牛 API 端点，提供交互式配置向导，支持中英文。

用户通过 `npx qiniu-coding-helper` 直接运行，无需全局安装。

## Build & Run

```bash
pnpm install        # 安装依赖
pnpm build          # 编译 (tsc + 复制 locales 到 dist/)
pnpm dev            # 监听模式编译 (tsc --watch)
pnpm start          # 运行 CLI (node dist/cli.js)
pnpm clean          # 清理 dist/
```

构建后手动验证:
```bash
node dist/cli.js --version
node dist/cli.js --help
node dist/cli.js doctor
node dist/cli.js lang show
```

注意: `pnpm build` 包含 `cp -r src/locales dist/locales`，因为 tsc 不会复制 JSON 翻译文件。无测试框架、无 lint 配置。Node.js >= 18。

## Code Conventions

- 代码中注释使用中文
- 接口返回的响应体使用英文
- ESM 模块 (`"type": "module"`)，导入路径必须带 `.js` 后缀
- TypeScript strict 模式，target ES2022，module Node16

## Architecture

**入口链路**: `cli.ts` → `command.ts` (Commander 路由) → commands/ 或 wizard/

**核心单例**:
- `configManager` — 管理 `~/.coding-helper/config.yaml`，存储语言、线路、API Key、模型配置
- `i18n` — 国际化，从 `src/locales/*.json` 加载翻译，支持 `{{param}}` 模板替换，回退到 en_US
- `modelService` — 从 `/v1/models` 获取模型列表，带内存缓存
- `toolManager` — 工具注册中心，当前只注册 ClaudeCodeTool

**工具扩展**: 实现 `ITool` 接口 (`src/lib/tools/base-tool.ts`)，在 `ToolManager` 中注册即可。Phase 1 仅支持 Claude Code。

**向导系统** (`src/lib/wizard/`):
- `flows/` — 独立配置流程（语言、线路、API Key、模型选择）
- `menus/` — 主菜单和工具配置菜单（循环交互）
- `ui/` — `promptHelper` 封装 inquirer，`uiRenderer` 统一终端渲染

**配置写入目标**:
- `~/.coding-helper/config.yaml` — coding-helper 自身配置（语言、线路、API Key、模型）
- `~/.claude/settings.json` — Claude Code 环境变量 (ANTHROPIC_BASE_URL、ANTHROPIC_AUTH_TOKEN 等)
- `~/.claude.json` — Claude Code onboarding 标记

## API Endpoints

- 国内线路: `https://openai.qiniu.com`
- 国内备用线路: `https://api.qnaigc.com`
- 海外线路: `https://openai.sufy.com`
- Modelink 线路: `https://api.modelink.ai`
- 支持接口: `/v1/chat/completions`、`/v1/messages`、`/v1/models`
- API Key 校验: `/v2/stat/usage`（轻量级，验证 token 有效性）
- 认证: Bearer token

## CLI 命令

```bash
coding-helper                      # 默认：首次进向导，之后进主菜单
coding-helper init                 # 强制重新初始化
coding-helper auth [token]         # 设置 API Key（交互式或直接传入）
coding-helper auth revoke          # 删除 API Key
coding-helper auth reload <tool>   # 重新加载配置到工具
coding-helper lang show|set <lang> # 语言管理 (zh_CN / en_US)
coding-helper doctor               # 健康检查
coding-helper enter [tool]         # 进入主菜单或工具配置菜单
```

## 命名约定

- 单例实例: camelCase (`configManager`, `modelService`, `toolManager`)
- 类: PascalCase (`ConfigManager`, `ClaudeCodeTool`)
- 接口: I 前缀 (`ITool`, `IToolManager`)
- 常量: UPPER_SNAKE_CASE (`VERSION`, `DEFAULT_ENDPOINT`)
