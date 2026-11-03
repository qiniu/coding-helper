import { configManager, type Connection } from '../../config.js';
import { t } from '../../i18n.js';
import type { StepInfo } from '../ui/ui-renderer.js';
import { promptHelper } from '../ui/prompt-helper.js';

export interface BuddyModelOptions { connection?: Connection; previous?: string[]; step?: StepInfo; }

// 多模型也从同一搜索页添加；当前配置与编辑草稿分开展示，确认前不保存。
export async function selectBuddyModels(tool: 'codebuddy' | 'workbuddy', options: BuddyModelOptions): Promise<string[] | null> {
  const connection = options.connection ?? configManager.getConnection(tool);
  const { toolManager } = await import('../../tool-manager.js');
  const target = toolManager.get(tool);
  const current = configManager.getModels()[tool === 'codebuddy' ? 'codeBuddyModels' : 'workbuddyModels'] ?? [];
  return await promptHelper.pickModels({
    tools: target ? [target] : [], connection, step: options.step,
    title: t(`${tool}_select_models`), selected: options.previous ?? current,
    currentModels: current.map(model => ({ tool: target?.displayName ?? tool, model })),
  }) ?? null;
}
