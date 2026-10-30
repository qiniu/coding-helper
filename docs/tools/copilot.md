# Copilot / Claude launcher

交互式 POSIX 启动器使用独立伪终端，保留控制终端、输入和窗口大小，同时避免 Ctrl-C 重复送达；非交互启动转发父进程信号。父进程收到 SIGTERM 时直接结束菜单，不再等待回车。终端桥接依赖随包安装的 node-pty；安装失败时请修复依赖，不会静默切换到可能丢失控制终端的方式。

Interactive POSIX launches use a dedicated PTY for terminal input, resize, and single interrupt delivery. Non-interactive launches forward parent signals. A parent SIGTERM exits the menu without waiting for Enter. The terminal bridge requires the packaged node-pty dependency; repair an installation error rather than falling back to a client without a controlling terminal.

先通过 coding-helper auth 设置 Key，再在 enter copilot 选择模型，使用 coding-helper run copilot -- <args> 启动。只向子进程注入 COPILOT_PROVIDER_* 与 COPILOT_MODEL，不写客户端配置。Claude 可使用 coding-helper run claude -- <args>；已有 settings.json 的 /model 设置仍由客户端处理，需要时传入客户端 --model 参数明确覆盖。

Set the key with coding-helper auth, select a model in enter copilot, then use coding-helper run copilot -- <args>. Only subprocess environment is changed. Claude also supports run claude; existing settings.json selections remain effective unless overridden with the client --model option. Requires client versions supporting these environment variables.

若 Copilot 的 providers.json（或 COPILOT_PROVIDERS_CONFIG）已有配置，启动器会明确停止，请使用独立空注册表后重试，避免旧注册表覆盖所选端点。继承的 API Key command 会被清除。Claude 启动时通过权限受限的临时 --settings 文件覆盖保存的路由和凭据，并清除 Bedrock/Vertex/Foundry 选择器；正常退出或启动失败后清理文件。该模式不接受用户再次传入 --settings，且不会改写用户的 settings.json。管理员托管策略仍优先。

Copilot launch refuses a populated providers.json (or COPILOT_PROVIDERS_CONFIG); use a separate empty registry to avoid silently ignoring the selected endpoint. Inherited API-key commands are removed. Claude receives session routing through a private temporary --settings file, with conflicting cloud selectors cleared. The file is removed after exit or startup failure; user settings.json remains unchanged. Do not pass another --settings option. Administrator-managed policies still take precedence.
