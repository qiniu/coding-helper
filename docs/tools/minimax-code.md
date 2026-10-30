# MiniMax Code

使用 coding-helper enter minimax-code 配置。官方 mcode provider add 在临时数据目录中运行，成功并校验后才通过共享事务写回；Key 通过环境变量传入，错误输出不回显凭据。卸载还原原文件。需要安装支持 MINIMAX_DATA_DIR/MAVIS_DATA_DIR 的 mcode，命令可能进行远端连通性检测。

Run coding-helper enter minimax-code. The official provider command runs in a temporary data directory; validated output is committed through the shared transaction. The key is passed by environment, and raw command errors are withheld. Unload restores original bytes. Requires mcode support for its data-directory overrides; the provider command may perform network checks.

无恢复记录且目标文件仍存在时，卸载会明确报错，配置保持不变。请手动清理旧凭据或恢复已知备份；不会将未修改报告为成功移除。

If a target file exists without a restoration record, unloading fails with recovery guidance and leaves it unchanged. Remove legacy credentials manually or recover a known backup; unchanged files are not reported as successfully cleared.
