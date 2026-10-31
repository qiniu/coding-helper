import { pickModel, planForTool } from './model-pick-flow.js';
import { confirmAndWrite, selectTargets } from '../ui/write-plan.js';
import { editToolModels } from './model-slots-flow.js';
import { t } from '../../i18n.js';
import { applyTool } from '../../core/tool-service.js';
import { toolManager } from '../../tool-manager.js';
import { promptHelper } from '../ui/prompt-helper.js';
import { uiRenderer } from '../ui/ui-renderer.js';
import type { ITool } from '../../tools/base-tool.js';

export async function setupTool(tool: ITool): Promise<boolean> {
  // 用户取消模型配置时跳过后续装载与就绪提示，避免误报"配置成功"
  const completed = await tool.runModelConfigFlow();
  if (!completed) return false;
  if (tool.launchOnly) {
    uiRenderer.renderHeader();
    uiRenderer.renderSuccess(t('tool_setup_ready', { tool: tool.displayName }));
    uiRenderer.renderHint(t('setup_reason_launch_only'));
    await promptHelper.pressEnter();
    return true;
  }

  if (tool.name === 'codex') {
    uiRenderer.renderHeader();
    const confirmed = await promptHelper.confirm(t('tool_config_load_confirm', { tool: tool.displayName }));
    if (!confirmed) return false;
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
    return false;
  }

  uiRenderer.renderSuccess(t('tool_setup_ready', { tool: tool.displayName }));
  await promptHelper.pressEnter();
  return true;
}

// 初始化向导专用：选择工具 → 引导配置；取消或失败返回 false。
export async function runToolSetupFlow(candidates?: ITool[]): Promise<boolean> {
  const tools = candidates ?? toolManager.getAll();
  const targets = await selectTargets(t('setup_select_tools'), tools);
  if (!targets?.length) return false;
  const previewable = targets.filter(tool => !tool.launchOnly && tool.supportsPreview === true);
  if (previewable.length) while (true) {
    const picked = await pickModel({ tools: previewable });
    if (picked === 'back' || !('model' in picked)) return false;
    const plans = previewable.map(tool => planForTool(tool, picked.model));
    const results = await confirmAndWrite(t('menu_configure_tools'), plans, [], { edit: item => editToolModels(item.tool, item) });
    if (results !== 'back') { await promptHelper.pressEnter(); if (results.some(result => result.status === 'failed')) return false; break; }
  }
  // 启动器只配置模型；外部 writer 使用原有的单工具配置流程单独处理。
  for (const tool of targets.filter(tool => tool.launchOnly || tool.supportsPreview !== true)) {
    if (!tool.launchOnly) uiRenderer.renderHint(t('setup_preview_fallback', { tool: tool.displayName }));
    if (!await setupTool(tool)) return false;
  }
  return true;
}
