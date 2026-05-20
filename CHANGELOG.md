# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.1] - 2026-05-20

### 更新内容
* docs(readme): 增加 CodeBuddy/WorkBuddy 集成说明 by @krisxia0506 in https://github.com/qiniu/coding-helper/pull/14


**Full Changelog**: https://github.com/qiniu/coding-helper/compare/v0.2.0...v0.2.1

## [0.2.0] - 2026-05-20

### 更新内容
* docs: 更新 README 工具配置说明 by @krisxia0506 in https://github.com/qiniu/coding-helper/pull/9
* docs: 添加 Issue 模板 by @krisxia0506 in https://github.com/qiniu/coding-helper/pull/13
* feat(codebuddy): 增加 CodeBuddy/WorkBuddy 工具配置支持 by @krisxia0506 in https://github.com/qiniu/coding-helper/pull/12


**Full Changelog**: https://github.com/qiniu/coding-helper/compare/v0.1.4...v0.2.0

## [0.1.4] - 2026-05-20

### 更新内容
* chore: update release changelog automation by @krisxia0506 in https://github.com/qiniu/coding-helper/pull/7


**Full Changelog**: https://github.com/qiniu/coding-helper/compare/v0.1.3...v0.1.4

## [0.1.3] - 2026-05-20

### Fixed
- Codex 工具配置改为把 API Key 写入 Codex 的 `auth.json`

### Changed
- 简化 Codex provider 配置，移除不再需要的 token command 配置
- 更新 README 中 Codex 相关说明

## [0.1.2] - 2026-05-19

### Added
- 增加 Codex 工具配置支持
- 增加手动 npm 发版 workflow，支持版本更新、测试校验、GitHub Release 和 npm provenance 发布

### Changed
- 更新仓库链接为 `qiniu/coding-helper`
- 增加 `AGENTS.md` 项目指引入口

## [0.1.1] - 2026-03-11

### Added
- 初始化向导增加工具引导配置流程

### Fixed
- 修复配置面板表格右边框溢出问题
- 清除配置菜单项文案增加 Coding Helper 前缀
- API Key 重试输入前清屏并重新渲染界面

## [0.1.0] - 2026-03-10

### Added
- Interactive setup wizard for first-run configuration
- Multi-region support: China (api.qnaigc.com) and International (openai.sufy.com)
- API Key management: input, validation, save, and revoke
- Model configuration with API-fetched model list and manual input
- Claude Code integration: auto-writes environment variables to `~/.claude/settings.json`
- Health check via `doctor` command
- Internationalization: Chinese (zh_CN) and English (en_US)
- CLI commands: `init`, `auth`, `lang`, `doctor`, `enter`
