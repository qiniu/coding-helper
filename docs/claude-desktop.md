# Claude Desktop 接入设计

用户说明见 [docs/tools/claude-desktop.md](tools/claude-desktop.md)。本文记录设计取舍，便于审阅。

## 为什么必须有本地网关

Desktop 3P profile 的 `inferenceModels` 只接受 `claude-(sonnet|opus|haiku|fable)-*` 角色名，并把这个名字原样作为请求的 `model`。七牛公开模型目录（`/v1/models`）中没有符合该格式的模型 ID，因此「直连」模式对七牛用户不可用。参考 [CC Switch](https://github.com/farion1231/cc-switch/blob/main/src-tauri/src/claude_desktop_config.rs) 的模型映射模式与 [Magpie](https://usemagpie.ai/zh/#how) 的常驻本地网关：Desktop 连接本机回环地址，网关负责角色名到七牛模型的映射。七牛已提供 Anthropic Messages 接口，网关只需改写 `model` 并透明转发，无需协议转换。

早期草稿中的直连模式已移除，避免出现一个对七牛模型总是失败的代码路径。

## 组成

| 模块 | 职责 |
|------|------|
| `desktop-gateway/server.ts` | 网关本体与独立入口。只依赖 Node 内置模块，原样复制为 `~/.coding-helper/claude-desktop/gateway.mjs` 运行，npx 清理缓存后自启动仍有效 |
| `desktop-gateway/mapping.ts` | 模型配置 → 三个角色路由；Desktop profile 字段 |
| `desktop-gateway/background.ts` | 端口选择、健康检查（指纹区分 current / stale / occupied / free）、启动与停止 |
| `desktop-gateway/autostart.ts` | 三个平台的登录自启动项（只写用户目录，不调用 launchctl 或注册表） |
| `tools/claude-desktop-tool.ts` | 适配器：一次事务写入 7 个文件，之后启动网关；还原后停止网关 |
| `commands/desktop-gateway.ts` | `coding-helper desktop-gateway start|stop|status` |

## 关键决策

1. **配置与服务一体化事务。** Desktop 的 4 个文件、网关程序、网关配置和自启动项进入同一份恢复记录，预演、冲突检测、回滚和还原都复用 `applyConfigEdits` / `restoreConfigEdits`。首次写入后网关启动失败时整体撤销，避免 Desktop 指向失效端口。
2. **字段级协调。** Desktop 会频繁改写自己的配置。协调器（reconciler）只在助手负责的字段仍为写入值时接管，撤销这些字段并保留其他修改；字段被改成其他值时拒绝。本工具创建的 profile 在还原时整体删除，不残留本地令牌。
3. **凭据边界。** 七牛 Key 只在 `gateway.json`（0600，非 Windows 上校验属主与权限）中；Desktop profile 只有随机本地令牌；网关不转发客户端凭据，日志不含请求内容。
4. **进程安全。** 只通过带令牌的 `/_coding_helper/stop` 停止网关，绝不按端口或 PID 结束其他程序。控制请求不使用 fetch 连接池：停止后复用旧保活连接会被正在退出的旧进程应答；网关停止后对残留连接返回 503 并断开。
5. **稳定端口与令牌。** 重新写入沿用端口和令牌，Desktop profile 不变时只需重启网关；端口被其他程序占用时才换端口，并停止本工具在旧端口上的网关。
6. **路由名称。** 使用 `claude-sonnet-4-6`、`claude-opus-4-6`、`claude-haiku-4-5`，让 Desktop 生成第三方兼容层更普遍支持的旧式参数；请求中的日期后缀、`[1m]`、新版本号按角色归类。
7. **外部切换。** `hasSwitchedProvider` 在 Desktop 切回官方模式、选择其他 profile 或 profile 网关地址被改写时返回 true，配合现有 rebaseline 流程以当前配置为新基线。

## 验证范围

- 单元与集成测试：网关鉴权、路径与查询参数、SSE 流、错误透传、中止传播、角色归类；独立入口运行与日志；后台进程 current/stale/occupied/free 判定、不终止外部程序；自启动项内容；适配器预演、写入、端到端请求、重载、协调还原、冲突拒绝、外部切换识别、无效输入不落盘。
- 真实 Claude Desktop 交互、七牛各模型对 Desktop 请求参数的兼容性、Windows ACL 与各平台自启动尚未实机验证。
