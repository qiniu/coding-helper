# Claude Desktop

Claude Desktop 的第三方推理（3P）模式只接受 `claude-sonnet-*`、`claude-opus-*`、`claude-haiku-*` 这类角色模型名，而七牛模型（如 `qwen/qwen3.5-plus`、`deepseek/deepseek-v4-pro`）不在此列。coding-helper 因此在本机运行一个**模型映射网关**：Desktop 连接 `http://127.0.0.1:<端口>`，网关把角色名换成你选择的七牛模型，再按 Anthropic Messages 协议转发到七牛。思路与 [CC Switch](https://github.com/farion1231/cc-switch/blob/main/docs/user-manual/en/2-providers/2.6-claude-desktop.md) 的「模型映射」模式、[Magpie](https://usemagpie.ai/zh/#how) 的本地网关一致。

```bash
coding-helper claude-desktop --model qwen/qwen3.5-plus   # 快捷配置
coding-helper enter claude-desktop                        # 菜单：主模型 + Opus/Haiku 角色
coding-helper desktop-gateway status                      # 查看网关状态
coding-helper restore claude-desktop                      # 还原到写入前
```

写入后请**完全退出** Claude Desktop（macOS 用 ⌘Q，Windows 从托盘退出）再打开。3P 模式作用于整个应用，官方登录、云端会话等功能在此模式下不可用；还原后同样需要重启。

## 模型角色

| Desktop 菜单 | 网关路由 | 来源 |
|------|------|------|
| 主模型 | `claude-sonnet-4-6` | 工具的主模型 |
| Opus 角色 | `claude-opus-4-6` | 槽位「Opus 角色」，未设置时跟随主模型 |
| Haiku 角色 | `claude-haiku-4-5` | 槽位「Haiku 角色」，未设置时跟随主模型（后台小任务） |

菜单只列出主模型和单独设置过的角色，标签显示真实的七牛模型名；未列出的角色仍由网关路由。Desktop 内置 Claude Code 发出的带日期后缀（`claude-haiku-4-5-20251001`）、`[1m]` 标记或更新版本号（`claude-opus-5`）的请求，会按角色名归到对应路由；`claude-fable-*` 归到 Opus。非 Claude 名称一律拒绝。

路由使用 4.x 代名称：Desktop 按模型名决定请求参数，旧名称对应「扩展思考 + budget」形式，第三方 Messages 兼容层普遍支持。

## 写入的文件

一次事务写入以下 7 个文件，任何一步失败都整体回滚；首次写入后网关起不来时同样撤销全部写入：

| 文件 | 作用 |
|------|------|
| `<Desktop 目录>/Claude/claude_desktop_config.json` | `deploymentMode: "3p"` |
| `<Desktop 目录>/Claude-3p/claude_desktop_config.json` | `deploymentMode: "3p"` |
| `<Desktop 目录>/Claude-3p/configLibrary/e8cd7c67-….json` | 本工具独立的 profile：网关地址、本地令牌、模型列表 |
| `<Desktop 目录>/Claude-3p/configLibrary/_meta.json` | 登记 profile 并设为当前（保留其他 profile） |
| `~/.coding-helper/claude-desktop/gateway.mjs` | 网关程序（只依赖 Node 内置模块，不依赖 npx 缓存） |
| `~/.coding-helper/claude-desktop/gateway.json` | 网关配置：端口、七牛地址与 Key、本地令牌、模型映射（权限 0600） |
| 登录自启动项 | macOS `~/Library/LaunchAgents/com.qiniu.coding-helper.claude-desktop-gateway.plist`；Windows 启动文件夹中的 `coding-helper-claude-desktop-gateway.vbs`；Linux `~/.config/autostart/coding-helper-claude-desktop-gateway.desktop` |

Desktop 目录：macOS `~/Library/Application Support`，Windows `%LOCALAPPDATA%`，Linux `$XDG_CONFIG_HOME`（默认 `~/.config`）。`--dry-run` 只列出文件、动作和行数，不输出内容，也不启动网关。

七牛 Key 只保存在 `gateway.json` 中（与恢复记录一样受限权限），Desktop profile 里只有随机生成的本地令牌。

## 网关

- 只监听 `127.0.0.1`，每个请求都要带本地令牌；默认端口 15880，被占用时顺延，可用环境变量 `CODING_HELPER_DESKTOP_GATEWAY_PORT` 指定起始端口。重新写入时沿用已有端口和令牌。
- 只转发 `/v1/messages` 与 `/v1/messages/count_tokens`（保留查询参数），以及 Desktop 的模型发现 `/v1/models`。SSE 流原样转发，Desktop 中止生成时立即取消上游请求。
- 不转发客户端 Cookie、本地令牌等头部，只附加七牛 Key 以及 `anthropic-version`、`anthropic-beta`。
- 日志写入 `~/.coding-helper/claude-desktop/gateway.log`，只记录启动、停止和上游连接错误类别，不含请求内容或凭据。

生命周期：写入配置时立即在后台启动；登录后由自启动项启动；macOS 上异常退出会由 launchd 重启。修改模型并重新写入时，新网关替换旧进程。`coding-helper desktop-gateway start|stop|status [--json]` 可手动管理，`coding-helper doctor` 会检查网关是否以当前配置运行。

自启动项使用写入时的 Node 路径（`process.execPath`）。用 nvm 等工具卸载该 Node 版本后，请重新写入配置。

## 还原与外部修改

`restore` 先还原文件，再停止网关并删除自启动项。Desktop 运行时会改写自己的配置（偏好、MCP 服务器、profile 设置、profile 列表）：只要 coding-helper 负责的字段（`deploymentMode`、`appliedId` 与本工具的 profile 条目、profile 中的推理字段）仍是写入值，还原就只撤销这些字段，保留 Desktop 的其他修改；如果这些字段被改成其他值，还原拒绝执行并保留恢复记录。

在 Desktop 中切回官方登录或选择了其他 profile（例如 CC Switch）时，视为已切换到其他服务；再次写入会以当时的配置为新的还原基线（旧记录归档到 `~/.coding-helper/backups/`）。

## 已知限制

- 未在真实 Claude Desktop 上完成端到端验证；Desktop 的配置格式和模型名校验可能随版本变化。
- 第三方模型对 Anthropic 扩展参数（思考、工具、beta 功能）的兼容性取决于七牛网关及模型本身。
- Linux 没有官方 Claude Desktop；Flatpak 等打包方式的配置目录可能不同。
