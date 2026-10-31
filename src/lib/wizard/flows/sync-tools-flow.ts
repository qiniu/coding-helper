import type { ITool } from '../../tools/base-tool.js';
import { configManager } from '../../config.js';
import { toolManager } from '../../tool-manager.js';
import { t } from '../../i18n.js';
import { exitCodeFor, getSyncTargets, syncConfiguredTools, type ToolResult } from '../../core/tool-service.js';
import { promptHelper } from '../ui/prompt-helper.js';
import { uiRenderer } from '../ui/ui-renderer.js';
import { renderToolResults } from '../ui/tool-results.js';

export async function syncAfterChange(force = false, targets: ITool[] = getSyncTargets(toolManager.getAll())): Promise<ToolResult[]> {
  // 首次初始化先选线路再输入 Key，此阶段不应弹同步选择或留下失败退出码。
  if (!configManager.getApiKey()) return [];
  if (!targets.length) return [];
  if (!force && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    uiRenderer.renderHint(t('sync_cli_hint'));
    return [];
  }
  const names = force ? targets.map(tool => tool.name) : await promptHelper.checkbox(t('sync_select_tools'),
    targets.map(tool => ({ name: tool.displayName, value: tool.name })));
  const results = await syncConfiguredTools(targets.filter(tool => names.includes(tool.name)));
  renderToolResults(results, configManager.getApiKey());
  process.exitCode = exitCodeFor(results);
  return results;
}
