# Factory Droid

装载只注册自定义模型，不更改当前会话默认模型。启动 Droid 后执行 `/model`，选择 `Qiniu: <所选模型>` 才会使用该模型；已有会话和默认设置保持不变。

Loading registers a custom model without selecting it. After starting Droid, run `/model` and select `Qiniu: <selected model>` to use it. Existing session defaults remain unchanged.

通过 coding-helper enter droid 选择模型并装载。共享事务保存原文件；重复装载不覆盖最初记录，卸载逐字节还原。外部修改会阻止重载和卸载，请先恢复备份再重试。无装载记录时不删除配置。

Use coding-helper enter droid to select and apply a model. Original files are backed up and restored byte-for-byte. External edits block replacement; recover from backup before retrying. No load record means no deletion.

本层不包含 profiles、context 设置或独立模型槽位。 / Profiles, context settings and separate model slots are excluded.

无恢复记录且目标文件仍存在时，卸载会明确报错，配置保持不变。请手动清理旧凭据或恢复已知备份；不会将未修改报告为成功移除。

If a target file exists without a restoration record, unloading fails with recovery guidance and leaves it unchanged. Remove legacy credentials manually or recover a known backup; unchanged files are not reported as successfully cleared.
