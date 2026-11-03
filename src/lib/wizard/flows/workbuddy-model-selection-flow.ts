import { configManager } from '../../config.js';
import { selectBuddyModels, type BuddyModelOptions } from './buddy-model-selection-flow.js';

// 首次向导和工具菜单共用可恢复的多模型选择，连接和草稿由调用方传入。
export async function runWorkBuddyModelSelectionFlow(options: BuddyModelOptions = {}): Promise<string[] | null> {
  return selectBuddyModels('workbuddy', { ...options, previous: options.previous ?? configManager.getModels().workbuddyModels });
}
