# Grok CLI

通过 coding-helper enter grok 选择模型并装载。共享事务保存原文件；重复装载不覆盖最初记录，卸载逐字节还原。外部修改会阻止重载和卸载，请先恢复备份再重试。无装载记录时不删除配置。

Use coding-helper enter grok to select and apply a model. Original files are backed up and restored byte-for-byte. External edits block replacement; recover from backup before retrying. No load record means no deletion.

主对话、自动会话标题和摘要默认使用同一个所选七牛模型。装载时将 `models.default` 和 `models.session_summary` 都指向 `model.qiniu`；重新装载另一个模型时一起切换。单独设置「会话摘要」槽位时，`session_summary` 指向独立的 `model.qiniu-summary`。卸载会恢复装载前的完整文件，包括原有标题模型设置。

Chat, automatic session titles and summaries share the selected Qiniu model by default. Loading points both `models.default` and `models.session_summary` to `model.qiniu`; reloading a different model switches them together. When the summary slot is set separately, `session_summary` points to a dedicated `model.qiniu-summary`. Unloading restores the original file, including any previous title-model setting.

无恢复记录且目标文件仍存在时，卸载会明确报错，配置保持不变。请手动清理旧凭据或恢复已知备份；不会将未修改报告为成功移除。

If a target file exists without a restoration record, unloading fails with recovery guidance and leaves it unchanged. Remove legacy credentials manually or recover a known backup; unchanged files are not reported as successfully cleared.
