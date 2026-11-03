import { configManager } from '../../config.js';
import type { PlanItem } from '../../core/write-plan.js';
import { currentMainModel, pickModel, planForTool } from './model-pick-flow.js';
import { confirmAndWrite, selectTargets } from '../ui/write-plan.js';
import { editToolModels } from './model-slots-flow.js';
import { t } from '../../i18n.js';
import { applyTool } from '../../core/tool-service.js';
import { toolManager } from '../../tool-manager.js';
import { promptHelper } from '../ui/prompt-helper.js';
import { uiRenderer } from '../ui/ui-renderer.js';
import type { ITool } from '../../tools/base-tool.js';

// 切换前展示已接入工具的配置，不把读取失败或缺失记录猜成某个默认模型。
function currentModelDetail(tool: ITool): string {
  try {
    const models = configManager.getModels();
    if (tool.name === 'claude-code' && models.claudeCode?.useDefaultModels) return t('slots_builtin_value');
    const selected = tool.name === 'codebuddy' ? models.codeBuddyModels : tool.name === 'workbuddy' ? models.workbuddyModels : undefined;
    return selected?.length ? selected.join(', ') : currentMainModel(tool, models) ?? t('model_current_unknown');
  } catch { return t('model_current_unknown'); }
}

// 首次配置与确认页调整共用计划：保留内置模型入口和 Buddy 多模型选择，确认前不保存配置。
async function editSetupPlan(tool: ITool, from?: PlanItem): Promise<PlanItem | undefined> {
  return editToolModels(tool, from);
}

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
export async function runToolSetupFlow(candidates?: ITool[], options: { showCurrentModels?: boolean } = {}): Promise<boolean> {
  const tools = candidates ?? toolManager.getAll();
  toolSelection: while (true) {
    const targets = await selectTargets(t('setup_select_tools'), tools, { detail: options.showCurrentModels ? currentModelDetail : undefined });
    if (!targets?.length) return false;
    const previewable = targets.filter(tool => !tool.launchOnly && tool.supportsPreview === true);
    if (previewable.length) while (true) {
      const plans: PlanItem[] = [];
      const shared = previewable.filter(tool => !['claude-code', 'codebuddy', 'workbuddy'].includes(tool.name));
      for (const tool of previewable.filter(tool => !shared.includes(tool))) {
        const plan = await editSetupPlan(tool);
        if (!plan) continue toolSelection;
        plans.push(plan);
      }
      if (shared.length) {
        const currentModels = options.showCurrentModels ? shared.map(tool => {
          try { return { tool: tool.displayName, model: currentMainModel(tool) }; }
          catch { return { tool: tool.displayName }; }
        }) : undefined;
        const picked = await pickModel({ tools: shared, currentModels });
        if (picked === 'back' || !('model' in picked)) continue toolSelection;
        plans.push(...shared.map(tool => planForTool(tool, picked.model)));
      }
      const ordered = previewable.map(tool => plans.find(plan => plan.tool === tool)!);
      const results = await confirmAndWrite(t('page_confirm'), ordered, [], { edit: item => editSetupPlan(item.tool, item) });
      if (results !== 'back') { await promptHelper.pressEnter(); if (results.some(result => result.status === 'failed')) return false; break; }
    }
    // 启动器只配置模型；外部 writer 使用原有的单工具配置流程单独处理。
    for (const tool of targets.filter(tool => tool.launchOnly || tool.supportsPreview !== true)) {
      if (!tool.launchOnly) uiRenderer.renderHint(t('setup_preview_fallback', { tool: tool.displayName }));
      if (!await setupTool(tool)) continue toolSelection;
    }
    return true;
  }
}
