# Kimi Code CLI

通过 coding-helper enter kimi-code 选择模型并装载。共享事务保存原文件；重复装载不覆盖最初记录，卸载逐字节还原。外部修改会阻止重载和卸载，请先恢复备份再重试。无装载记录时不删除配置。

Use coding-helper enter kimi-code to select and apply a model. Original files are backed up and restored byte-for-byte. External edits block replacement; recover from backup before retrying. No load record means no deletion.

本层不包含 profiles、context 设置或独立模型槽位。 / Profiles, context settings and separate model slots are excluded.

## 安装与更新 / Installation and updates

安装提示与菜单更新使用 Kimi 官方安装脚本，该脚本自带运行时，不依赖 coding-helper 所用 Node 的版本。更新前显示完整命令并要求确认，默认取消。Windows 首次启动还需安装 Git for Windows。可选 npm 安装需要 Node.js 22.19.0+，因此不作为本工具的默认安装路径。

Installation hints and menu updates use the official Kimi installer with its bundled runtime, independent of the Node version running coding-helper. Updates display the command and require confirmation, defaulting to cancel. Windows also requires Git for Windows before first launch. The optional npm installation requires Node.js 22.19.0+, so it is not the default here.

Source: https://www.kimi.com/en/help/kimi-code/cli-getting-started (2026-10-28).

无恢复记录且目标文件仍存在时，卸载会明确报错，配置保持不变。请手动清理旧凭据或恢复已知备份；不会将未修改报告为成功移除。

If a target file exists without a restoration record, unloading fails with recovery guidance and leaves it unchanged. Remove legacy credentials manually or recover a known backup; unchanged files are not reported as successfully cleared.
