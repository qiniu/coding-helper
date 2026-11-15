# Claude Desktop 第三方推理配置

Coding Helper 将 Claude Desktop 作为独立工具管理，配置不会修改 Claude Code CLI 的 `~/.claude/settings.json`。当前为开发中的基础适配器，尚未注册到 CLI。完成网关与端到端验证后，将接入模型选择、预演、状态和还原。

写入会让整个 Claude Desktop 进入第三方推理模式，可能改变官方登录、云会话等功能。完成后请**完全退出**应用并重新打开。恢复操作会还原写入前的模式和配置，恢复后同样需要重启。

首版使用七牛的 Anthropic Messages 网关直连，不启动本地代理。Desktop 直连模型 ID 必须属于 `claude-sonnet-*`、`claude-opus-*` 或 `claude-haiku-*` 角色族（可带 `anthropic/` 前缀），并且该模型须由七牛网关实际提供。其他模型需要模型映射代理，本适配器暂不支持；模型 ID 被接受并不保证模型服务或应用版本兼容。

配置位于 macOS 的 `~/Library/Application Support/Claude` 和 `Claude-3p`，Windows 的 `%LOCALAPPDATA%/Claude` 和 `Claude-3p`，Linux 的 `$XDG_CONFIG_HOME`（未设置时为 `~/.config`）下的同名目录。具体使用的四个文件可通过写入预演查看。网关 Key 存在本地配置与恢复记录中，文件采用受限权限。

适配器保留其他 profile 和已有字段，记录原文件以供还原。如果受管文件在配置后被其他程序修改，重新写入或恢复会拒绝操作；请先检查变化并恢复到助手写入的状态，或自行从备份恢复。Desktop 的配置格式可能随版本变化，应用升级后请重新验证。

参考：[CC Switch Claude Desktop 配置实现](https://github.com/farion1231/cc-switch/blob/main/src-tauri/src/claude_desktop_config.rs)。

## 后续设计：本地模型映射网关

[Magpie](https://usemagpie.ai/docs/claude-desktop) 通过本地 Anthropic Messages 网关连接桌面应用；[CC Switch](https://github.com/farion1231/cc-switch/blob/main/docs/user-manual/en/2-providers/2.6-claude-desktop.md) 也提供直连和模型映射两种模式。借鉴这一模式，后续需要：

1. 在本机回环地址运行独立网关，并使用随机本地令牌验证请求；不监听公网。桌面配置指向该网关，七牛 Key 只由网关持有。
2. 将 Desktop 可识别的 Claude 模型路由映射至所选七牛模型，按七牛 Messages 协议转发；完整保留流式数据、工具调用、错误和中止信号。模型列表与模型映射需要保持一致。
3. 设计服务安装、启动、退出、健康检查、自动恢复及升级，避免 CLI 退出后桌面配置指向失效端口。明确 Windows、macOS 和 Linux 的服务生命周期。
4. 将客户端配置与网关状态纳入一致的写入、预演、恢复和冲突检测；切回官方模式时移除本工具持有的网关配置，并保证不破坏用户后续的其他设置。
5. 增加代理协议与安全测试，以及真实桌面应用、七牛模型、重启和断线的端到端验证。确认兼容后再注册工具并提供正式入口。

当前代码提供未注册的桌面配置事务和网关请求处理基础：网关支持令牌鉴权、单一 Sonnet 路由映射、模型发现、Messages 和 token 计数接口，透传流式上游响应。服务启动与守护、桌面配置接线、模型角色映射、真实客户端验证尚未完成；代码尚未注册到工具列表，不构成可用的完整桌面支持。
