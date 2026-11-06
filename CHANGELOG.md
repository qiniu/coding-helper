# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.6.0] - 2026-11-06

### 更新内容
* feat(core): 统一工具配置服务 by @laitekin in https://github.com/qiniu/coding-helper/pull/92
* feat(cli): 增加工具状态查询 by @laitekin in https://github.com/qiniu/coding-helper/pull/93
* feat(cli): 增加客户端配置还原命令 by @laitekin in https://github.com/qiniu/coding-helper/pull/94
* feat(doctor): 检查账户模型调用状态 by @laitekin in https://github.com/qiniu/coding-helper/pull/95
* feat(cli): 支持批量配置编程工具 by @laitekin in https://github.com/qiniu/coding-helper/pull/96
* feat(auth): 同步已接入工具的连接配置 by @laitekin in https://github.com/qiniu/coding-helper/pull/97
* feat(core): 增加快捷配置参数与模型映射 by @laitekin in https://github.com/qiniu/coding-helper/pull/98
* feat(cli): 增加单工具快捷配置 by @laitekin in https://github.com/qiniu/coding-helper/pull/99
* feat(cli): 增加配置预演与安全变更摘要 by @laitekin in https://github.com/qiniu/coding-helper/pull/100
* feat(cli): 支持多工具快捷配置与预演 by @laitekin in https://github.com/qiniu/coding-helper/pull/101
* fix(workbuddy): 兼容数组配置并修正账户探测 by @laitekin in https://github.com/qiniu/coding-helper/pull/133
* feat(config): 支持自定义 API 线路 by @laitekin in https://github.com/qiniu/coding-helper/pull/108
* feat(config): 增加按工具上下文上限 by @laitekin in https://github.com/qiniu/coding-helper/pull/109
* feat(cli): 支持上下文参数与配置流程 by @laitekin in https://github.com/qiniu/coding-helper/pull/110
* feat(config): 增加配置档连接与工具绑定 by @laitekin in https://github.com/qiniu/coding-helper/pull/111
* feat(cli): 增加配置档管理与快捷选择 by @laitekin in https://github.com/qiniu/coding-helper/pull/112
* feat(config): 支持独立服务商配置档与事务还原 by @laitekin in https://github.com/qiniu/coding-helper/pull/113
* feat(ui): 增加可搜索的终端菜单组件 by @laitekin in https://github.com/qiniu/coding-helper/pull/115
* feat(ui): 增加勾选与可取消的安全输入组件 by @laitekin in https://github.com/qiniu/coding-helper/pull/116
* feat(models): 增加模型搜索与匹配排序 by @laitekin in https://github.com/qiniu/coding-helper/pull/117
* feat(models): 增加模型槽位与继承规则 by @laitekin in https://github.com/qiniu/coding-helper/pull/118
* feat(ui): 增加模型搜索选择页面 by @laitekin in https://github.com/qiniu/coding-helper/pull/119
* feat(tools): 接入模型槽位与编辑流程 by @laitekin in https://github.com/qiniu/coding-helper/pull/120
* feat(ui): 增加写入确认与安全预演流程 by @laitekin in https://github.com/qiniu/coding-helper/pull/121
* feat(ui): 迁移主菜单与工具配置入口 by @laitekin in https://github.com/qiniu/coding-helper/pull/122
* feat(ui): 增加像素 Logo 与工具角色 by @laitekin in https://github.com/qiniu/coding-helper/pull/123
* fix(config): 兼容旧还原记录并修正 Droid 模型预算 by @laitekin in https://github.com/qiniu/coding-helper/pull/127
* feat(ui): 恢复确认页、进度条、结果表，优化工具列表、配置档与账号页 by @laitekin in https://github.com/qiniu/coding-helper/pull/131
* feat(dsh): 接入七牛模型配置与安全还原 by @laitekin in https://github.com/qiniu/coding-helper/pull/128
* fix(ci): 完整获取审阅比较所需的 Git 历史 by @laitekin in https://github.com/qiniu/coding-helper/pull/104
* fix(grok): 标题和摘要沿用所选模型 by @laitekin in https://github.com/qiniu/coding-helper/pull/132
* feat(config): 外部切换服务后直接写入七牛；未安装工具回车安装 by @laitekin in https://github.com/qiniu/coding-helper/pull/134
* feat(dsh): 支持 Desktop 配置及完整还原 by @laitekin in https://github.com/qiniu/coding-helper/pull/136
* fix(config): 按当前服务商重建官方登录恢复基线 by @laitekin in https://github.com/qiniu/coding-helper/pull/140
* fix(ui): use Space to select models and Enter to confirm by @krisxia0506 in https://github.com/qiniu/coding-helper/pull/142
* fix(ui): show all selected Buddy models in completion summaries by @krisxia0506 in https://github.com/qiniu/coding-helper/pull/143
* fix(config): protect restore errors and reconnect OpenCode after provider switches by @krisxia0506 in https://github.com/qiniu/coding-helper/pull/144


**Full Changelog**: https://github.com/qiniu/coding-helper/compare/v0.5.0...v0.6.0

## [0.5.0] - 2026-10-30

### 更新内容
* fix(ci): support Codex reviews for external contributors by @krisxia0506 in https://github.com/qiniu/coding-helper/pull/48
* chore: require maintainer review for all files by @krisxia0506 in https://github.com/qiniu/coding-helper/pull/66
* fix: 容错市场模型能力字段为空或缺失 by @laitekin in https://github.com/qiniu/coding-helper/pull/44
* build: 跨平台构建与 CI 测试（拆分 0b） by @laitekin in https://github.com/qiniu/coding-helper/pull/45
* fix(release): publish through a reviewed version PR by @krisxia0506 in https://github.com/qiniu/coding-helper/pull/90
* feat: 共享安全写入与状态恢复公共层 by @laitekin in https://github.com/qiniu/coding-helper/pull/67
* feat: 共享多文件配置事务层 by @laitekin in https://github.com/qiniu/coding-helper/pull/68
* feat: TOML 编辑公共层 by @laitekin in https://github.com/qiniu/coding-helper/pull/70
* feat: Codex 复用 TOML 与事务层 by @laitekin in https://github.com/qiniu/coding-helper/pull/71
* feat: YAML 编辑公共层 by @laitekin in https://github.com/qiniu/coding-helper/pull/72
* feat: Hermes 复用 YAML 与事务层 by @laitekin in https://github.com/qiniu/coding-helper/pull/73
* feat: models.json 编辑公共层 by @laitekin in https://github.com/qiniu/coding-helper/pull/74
* feat: CodeBuddy 与 WorkBuddy 复用 models.json by @laitekin in https://github.com/qiniu/coding-helper/pull/75
* feat: Claude Code 安全配置与恢复 by @laitekin in https://github.com/qiniu/coding-helper/pull/76
* feat: Qwen Code 工具接入 by @laitekin in https://github.com/qiniu/coding-helper/pull/77
* feat: Kimi Code CLI 工具接入 by @laitekin in https://github.com/qiniu/coding-helper/pull/78
* feat: Grok CLI 工具接入 by @laitekin in https://github.com/qiniu/coding-helper/pull/79
* feat: MiniMax Code 工具接入 by @laitekin in https://github.com/qiniu/coding-helper/pull/80
* feat: Factory Droid 工具接入 by @laitekin in https://github.com/qiniu/coding-helper/pull/81
* feat: OpenClaw 工具接入 by @laitekin in https://github.com/qiniu/coding-helper/pull/82
* feat: run 启动公共层 by @laitekin in https://github.com/qiniu/coding-helper/pull/83
* feat: Copilot 与 Claude 环境启动适配 by @laitekin in https://github.com/qiniu/coding-helper/pull/84
* feat: OpenCode 接入共享配置公共层 by @laitekin in https://github.com/qiniu/coding-helper/pull/85
* feat: 统一命令发现与 PATH 外安装检测 by @laitekin in https://github.com/qiniu/coding-helper/pull/86

**完整变更记录**：https://github.com/qiniu/coding-helper/compare/v0.4.0...v0.5.0

## [0.4.0] - 2026-09-11

### 更新内容
* feat: 为 Codex 配置增加 GPT model-catalogs by @krisxia0506 in https://github.com/qiniu/coding-helper/pull/37


**Full Changelog**: https://github.com/qiniu/coding-helper/compare/v0.3.7...v0.4.0

## [Unreleased]

### 更新内容
* feat: Codex 配置覆盖前备份原配置并展示备份路径

## [0.3.7] - 2026-07-13

### 更新内容
* refactor(endpoints): 精简为国内与海外两条线路 by @krisxia0506 in https://github.com/qiniu/coding-helper/pull/33


**Full Changelog**: https://github.com/qiniu/coding-helper/compare/v0.3.6...v0.3.7

## [0.3.6] - 2026-06-06

### 更新内容
* fix: 兼容低版本 Node 启动预检 by @krisxia0506 in https://github.com/qiniu/coding-helper/pull/31


**Full Changelog**: https://github.com/qiniu/coding-helper/compare/v0.3.5...v0.3.6

## [0.3.5] - 2026-06-01

### 更新内容
* ci: 添加 Codex PR 交互审阅流程 by @krisxia0506 in https://github.com/qiniu/coding-helper/pull/28
* feat: add Modelink endpoint by @krisxia0506 in https://github.com/qiniu/coding-helper/pull/30


**Full Changelog**: https://github.com/qiniu/coding-helper/compare/v0.3.4...v0.3.5

## [0.3.4] - 2026-05-25

### 更新内容
* fix: 修复工具菜单版本查询失败后的重渲染循环 by @krisxia0506 in https://github.com/qiniu/coding-helper/pull/23
* feat: 优化工具首次配置引导 by @krisxia0506 in https://github.com/qiniu/coding-helper/pull/26
* refactor: 优化 Claude Code 配置结构 by @krisxia0506 in https://github.com/qiniu/coding-helper/pull/27


**Full Changelog**: https://github.com/qiniu/coding-helper/compare/v0.3.3...v0.3.4

## [0.3.3] - 2026-05-25

### 更新内容
* feat: add Hermes Agent support by @krisxia0506 in https://github.com/qiniu/coding-helper/pull/22


**Full Changelog**: https://github.com/qiniu/coding-helper/compare/v0.3.2...v0.3.3

## [0.3.2] - 2026-05-23

### 更新内容
* feat(claude-code): 禁用属性块以提升网关 prompt cache 命中率 by @krisxia0506 in https://github.com/qiniu/coding-helper/pull/20


**Full Changelog**: https://github.com/qiniu/coding-helper/compare/v0.3.1...v0.3.2

## [0.3.1] - 2026-05-22

### 更新内容
* fix(cli): 启动期校验 Node 版本，提前提示升级 by @krisxia0506 in https://github.com/qiniu/coding-helper/pull/19


**Full Changelog**: https://github.com/qiniu/coding-helper/compare/v0.3.0...v0.3.1

## [0.3.0] - 2026-05-21

### 更新内容
* fix(codebuddy): 将 CodeBuddy/WorkBuddy 拆分为独立工具 by @krisxia0506 in https://github.com/qiniu/coding-helper/pull/15


**Full Changelog**: https://github.com/qiniu/coding-helper/compare/v0.2.1...v0.3.0

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
