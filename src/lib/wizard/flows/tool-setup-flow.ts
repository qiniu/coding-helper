import { t } from '../../i18n.js';
import { applyTool } from '../../core/tool-service.js';
import { toolManager } from '../../tool-manager.js';
import { promptHelper } from '../ui/prompt-helper.js';
import { uiRenderer } from '../ui/ui-renderer.js';
import type { ITool } from '../../tools/base-tool.js';

export async function setupTool(tool: ITool): Promise<void> {
  // 用户取消模型配置时跳过后续装载与就绪提示，避免误报"配置成功"
  const completed = await tool.runModelConfigFlow();
  if (!completed) return;
  if (tool.launchOnly) {
    uiRenderer.renderHeader();
    uiRenderer.renderSuccess(t('tool_setup_ready', { tool: tool.displayName }));
    uiRenderer.renderHint(t('setup_reason_launch_only'));
    await promptHelper.pressEnter();
    return;
  }

  if (tool.name === 'codex') {
    uiRenderer.renderHeader();
    const confirmed = await promptHelper.confirm(t('tool_config_load_confirm', { tool: tool.displayName }));
    if (!confirmed) return;
  }
  try {
    const result = await applyTool(tool);
    if (result.status !== 'success') throw new Error(t(result.reason ?? 'tool_config_load_failed', { tool: tool.displayName }));
    uiRenderer.renderHeader();
    uiRenderer.renderSuccess(t('tool_config_loaded', { tool: tool.displayName }));
    for (const note of tool.getLoadConfigNotes?.() ?? []) uiRenderer.renderHint(note);
  } catch (err: unknown) {
    uiRenderer.renderHeader();
    uiRenderer.renderError(
      err instanceof Error ? err.message : t('tool_config_load_failed', { tool: tool.displayName }),
    );
    for (const note of tool.getLoadConfigNotes?.() ?? []) uiRenderer.renderHint(note);
    await promptHelper.pressEnter();
    return;
  }

  uiRenderer.renderSuccess(t('tool_setup_ready', { tool: tool.displayName }));
  await promptHelper.pressEnter();
}

// 初始化向导专用：选择工具 → 引导配置
export async function runToolSetupFlow(): Promise<void> {
  const tools = toolManager.getAll();

  uiRenderer.renderHeader();
  uiRenderer.renderTitle(t('menu_configure_tools'));

  const choices = tools.map((tool) => ({
    name: tool.displayName,
    value: tool.name,
  }));

  const toolName = await promptHelper.select<string>(t('menu_select_action'), choices);
  const tool = toolManager.get(toolName);
  if (!tool) return;

  await setupTool(tool);
}
