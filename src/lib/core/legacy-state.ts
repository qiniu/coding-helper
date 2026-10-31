import { stateStore, type ToolState } from './state-store.js';
import { canonicalConfigPath } from './config-transaction.js';
import { assertNotSymlink, readTextFile } from './safe-write.js';

// 只迁移已知版本的字段原值记录，未知状态不降级成空配置。
export function legacyState(tool: string, allowedKeys: readonly string[]): ToolState | undefined {
  const saved = stateStore.getState(tool);
  if (!saved) return undefined;
  const metadata = saved as ToolState & { appliedAt?: unknown; endpoint?: unknown };
  if (Object.keys(saved).some(key => !['priors', 'appliedAt', 'endpoint'].includes(key)) ||
      (metadata.appliedAt !== undefined && typeof metadata.appliedAt !== 'string') ||
      (metadata.endpoint !== undefined && typeof metadata.endpoint !== 'string') ||
      !saved.priors || !Object.keys(saved.priors).length || Object.keys(saved.priors).some(key => !allowedKeys.includes(key))) {
    throw new Error('Unknown legacy restoration state. Recover from backup before retrying.');
  }
  return saved;
}

// 旧版没有完整文件快照：按已记录字段合成还原基线，其他内容沿用当前文件。
export function migrateLegacyText(tool: string, target: string, keys: readonly string[], restore: (content: string, priors: Record<string, unknown>) => string): void {
  stateStore.withLock(() => {
    const saved = legacyState(tool, keys);
    if (!saved) return;
    const file = canonicalConfigPath(target);
    assertNotSymlink(file);
    const content = readTextFile(file);
    if (content === undefined) throw new Error('Legacy client configuration is missing. Recover from backup before retrying.');
    const original = restore(content, saved.priors!);
    stateStore.migrateLegacy(tool, saved, [{ file, state: { priors: { files: [{ file, original, applied: content }] } } }]);
  });
}
