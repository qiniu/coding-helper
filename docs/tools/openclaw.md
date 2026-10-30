# OpenClaw

若 agent 的 models.json 已缓存七牛 provider，装载、重载和卸载会明确停止，不会报告已切换或已清除凭据。请先停止 OpenClaw，备份提示路径的 models.json，移除其中 providers.qiniu，再重试；不要删除其他 provider。本工具不猜测缓存凭据的原值。含 $include 的配置也需先人工展开后再装载。

Loading, reloading, and unloading refuse to proceed while an agent models.json contains a cached Qiniu provider. Stop OpenClaw, back up the reported file, remove only providers.qiniu, and retry. Other providers remain untouched; the helper does not guess cached credential originals. Resolve $include configuration manually before loading.

通过 coding-helper enter openclaw 选择模型并装载。共享事务保存原文件；重复装载不覆盖最初记录，卸载逐字节还原。外部修改会阻止重载和卸载，请先恢复备份再重试。无装载记录时不删除配置。

Use coding-helper enter openclaw to select and apply a model. Original files are backed up and restored byte-for-byte. External edits block replacement; recover from backup before retrying. No load record means no deletion.

本层不包含 profiles、context 设置或独立模型槽位。 / Profiles, context settings and separate model slots are excluded.

配置路径优先使用 OPENCLAW_CONFIG_PATH，其次 OPENCLAW_STATE_DIR，默认位于 OPENCLAW_HOME（或用户主目录）下的 .openclaw。命名 profile 请显式设置配置路径，避免编辑错误的实例。

Configuration path precedence: OPENCLAW_CONFIG_PATH, then OPENCLAW_STATE_DIR, then .openclaw under OPENCLAW_HOME or the user home. Named profiles require an explicit path to avoid editing the wrong instance.

更改配置路径前请先卸载原目标。若上述路径变量更改或取消后不再指向已记录的文件，装载和卸载都会明确报错，旧配置、新目标和恢复记录均保持不变。恢复原路径设置，成功卸载后再切换目录；解析到同一文件的父目录别名仍可使用。

Unload the recorded target before changing configuration paths. If changing or unsetting a path variable selects a different file, loading and unloading stop without modifying the old configuration, the new target, or restoration records. Restore the previous path settings, unload successfully, then switch paths. Parent directory aliases resolving to the same file remain supported.

无恢复记录且目标文件仍存在时，卸载会明确报错，配置保持不变。请手动清理旧凭据或恢复已知备份；不会将未修改报告为成功移除。

If a target file exists without a restoration record, unloading fails with recovery guidance and leaves it unchanged. Remove legacy credentials manually or recover a known backup; unchanged files are not reported as successfully cleared.

设置 OPENCLAW_CONFIG_READONLY=1 或 OPENCLAW_NIX_MODE=1 时，装载和卸载都会报错，并保持配置及恢复记录不变；请修改外部配置源。读取配置仍然可用。

With OPENCLAW_CONFIG_READONLY=1 or OPENCLAW_NIX_MODE=1, loading and unloading refuse to modify configuration or restoration records. Update the external configuration source. Reading configuration remains available.

支持 JSON 与 JSON5（注释、单引号、非引号键、尾逗号）。装载会规范化文件格式，活动文件不保留注释；原始文本保存在备份和恢复记录中，卸载逐字节还原注释、格式和原值。损坏文件或非对象根值在写入前报错。

JSON and JSON5 are supported, including comments, single quotes, unquoted keys and trailing commas. Loading normalizes formatting and removes comments from the active file; backups and restoration records retain the original text. Unloading restores original bytes, including comments, formatting and values. Invalid syntax or a non-object root is rejected before writing.

现有 model 支持字符串简写和对象形式；装载时将简写转换为 primary 对象，对象的 fallbacks 保留，卸载恢复原始形式。

Existing model selections may use a string shorthand or an object. Loading upgrades shorthand to a primary object and preserves existing object fallbacks; unloading restores the original representation.

若默认 modelPolicy.allow 非空且尚未允许所选模型，装载会追加该模型的精确引用，保留已有条目；不扩大到整个 provider。缺失或空允许列表保持不受限。已有匹配通配符不会重复追加。模型别名和参数保留，卸载还原原策略。仅管理默认配置；每个 agent 自己的策略覆盖默认策略，需用户单独调整。

For a nonempty default modelPolicy.allow that does not permit the selected model, loading appends its exact reference while preserving existing entries. Missing/empty policies remain unrestricted and matching wildcards avoid duplicates. Model aliases and settings are preserved; unloading restores the original policy. Per-agent policies override defaults and must be managed separately.
