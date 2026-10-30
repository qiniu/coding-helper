import { configManager, type ModelConfig } from '../config.js';
import type { ITool } from '../tools/base-tool.js';

export interface ToolResult {
  tool: ITool;
  status: 'success' | 'skipped' | 'failed';
  // 跳过原因是翻译键，失败原因是翻译键或适配器错误信息。
  reason?: string;
}

// 判断 helper 是否保存过模型；菜单不能仅根据客户端是否已接入决定首次引导。
export function hasSavedToolModelConfig(tool: Pick<ITool, 'name'>, models: ModelConfig): boolean {
  switch (tool.name) {
    case 'claude-code':
      return !!(models.claudeCode?.useDefaultModels || models.claudeCode?.haikuModel ||
        models.claudeCode?.sonnetModel || models.claudeCode?.opusModel || models.claudeCode?.subagentModel);
    case 'codex': return !!models.codexModel;
    case 'codebuddy': return !!models.codeBuddyModels?.length;
    case 'workbuddy': return !!models.workbuddyModels?.length;
    case 'hermes': return !!models.hermesModel;
    default: return !!(models.toolModels?.[tool.name] ?? models.defaultModel);
  }
}

// 原值、写入快照和恢复日志仍由各适配器的事务维护，不另写一份按工具名的状态。
export async function applyTool(tool: ITool): Promise<ToolResult> {
  if (tool.launchOnly) return { tool, status: 'skipped', reason: 'setup_reason_launch_only' };
  try {
    const apiKey = configManager.getApiKey();
    if (!apiKey) return { tool, status: 'failed', reason: 'apikey_not_set' };
    await tool.loadConfig(apiKey, configManager.baseUrl, configManager.getModels());
    return { tool, status: 'success' };
  } catch (error) {
    return { tool, status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function removeTool(tool: ITool): Promise<ToolResult> {
  if (tool.launchOnly) return { tool, status: 'skipped', reason: 'setup_reason_launch_only' };
  try {
    // 只有适配器能确认哪些文件已还原；失败时不能由公共层清除其恢复记录。
    await tool.unloadConfig();
    return { tool, status: 'success' };
  } catch (error) {
    return { tool, status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

// 全部失败为 1、部分失败为 2；没有失败（含跳过）为 0。
export function exitCodeFor(results: ToolResult[]): number {
  const failed = results.filter(result => result.status === 'failed').length;
  return failed === 0 ? 0 : failed === results.length ? 1 : 2;
}
