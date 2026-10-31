# Factory Droid

装载会注册自定义模型，并自动选择主模型及 Spec 模式默认模型。Spec 槽位可单独覆盖，否则跟随主模型；启动后可用 `/model` 查看或调整选择。其他会话选项保留。

Loading registers and selects the Qiniu main model and the Spec-mode default. A separate Spec slot overrides the main model; otherwise it follows it. Use `/model` to inspect or change the selection. Other session options are preserved.

通过 coding-helper enter droid 选择模型并装载。共享事务保存原文件；重复装载不覆盖最初记录，卸载逐字节还原。外部修改会阻止重载和卸载，请先恢复备份再重试。无装载记录时不删除配置。

Use coding-helper enter droid to select and apply a model. Original files are backed up and restored byte-for-byte. External edits block replacement; recover from backup before retrying. No load record means no deletion.

支持主模型与独立 Spec 模型槽位。 / Supports the main model and a separate Spec-model slot.

无恢复记录且目标文件仍存在时，卸载会明确报错，配置保持不变。请手动清理旧凭据或恢复已知备份；不会将未修改报告为成功移除。

If a target file exists without a restoration record, unloading fails with recovery guidance and leaves it unchanged. Remove legacy credentials manually or recover a known backup; unchanged files are not reported as successfully cleared.
