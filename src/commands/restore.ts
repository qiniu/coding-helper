import { i18n, t } from '../lib/i18n.js';
import { toolManager } from '../lib/tool-manager.js';
import { exitCodeFor, getRestoreTargets, removeTool } from '../lib/core/tool-service.js';
import { promptHelper } from '../lib/wizard/ui/prompt-helper.js';
import { uiRenderer } from '../lib/wizard/ui/ui-renderer.js';
import type { ITool } from '../lib/tools/base-tool.js';

// 别名去重；先验证完整列表，避免还原了一半才发现未知工具。
function resolveTools(list: string): ITool[] {
  const names = list.split(',').map(name => name.trim()).filter(Boolean);
  if (!names.length) throw new Error(t('restore_empty_tools'));
  const tools = names.map(name => {
    const tool = toolManager.get(name);
    if (!tool) throw new Error(t('auth_unknown_tool', { tool: name }));
    return tool;
  });
  return [...new Set(tools)];
}

// 恢复不依赖当前 API Key 或安装状态，只调用适配器已有的恢复事务。
export async function restoreCommand(list: string | undefined, options: { yes?: boolean }): Promise<void> {
  i18n.init();
  try {
    const targets = list === undefined ? getRestoreTargets(toolManager.getAll()) : resolveTools(list);
    if (!targets.length) {
      uiRenderer.renderHint(t('restore_nothing'));
      process.exitCode = 0;
      return;
    }
    if (!options.yes) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error(t('restore_require_yes'));
      const confirmed = await promptHelper.confirm(t('restore_confirm', { tools: targets.map(tool => tool.displayName).join(', ') }), false);
      if (!confirmed) { process.exitCode = 0; return; }
    }
    uiRenderer.renderTitle(t('restore_title'));
    const results = [];
    for (const tool of targets) {
      const result = await removeTool(tool);
      results.push(result);
      if (result.status === 'success') uiRenderer.renderSuccess(t('tool_config_unloaded', { tool: tool.displayName }));
      else if (result.status === 'skipped') uiRenderer.renderHint(t(result.reason ?? 'setup_reason_launch_only'));
      else {
        uiRenderer.renderError(t('tool_config_unload_failed', { tool: tool.displayName }));
        if (result.reason) uiRenderer.renderError(t(result.reason));
      }
    }
    process.exitCode = exitCodeFor(results);
  } catch (error) {
    uiRenderer.renderError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
