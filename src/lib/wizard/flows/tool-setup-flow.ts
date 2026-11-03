import { configManager } from '../../config.js';
import type { PlanItem } from '../../core/write-plan.js';
import { currentMainModel, pickModel, planForTool } from './model-pick-flow.js';
import { confirmAndWrite, selectTargets } from '../ui/write-plan.js';
import { editToolModels } from './model-slots-flow.js';
import { t } from '../../i18n.js';
import { applyTool } from '../../core/tool-service.js';
import { toolManager } from '../../tool-manager.js';
import { promptHelper } from '../ui/prompt-helper.js';
import { uiRenderer, FLOW_STEP_KEYS, type StepInfo, checklistRows } from '../ui/ui-renderer.js';
import type { ITool } from '../../tools/base-tool.js';
import { installTool } from '../menus/tool-menu.js';

function installState(tool: ITool): boolean | null {
  try { return tool.isInstalled(); } catch { return null; }
}

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
async function editSetupPlan(tool: ITool, from?: PlanItem, step?: StepInfo): Promise<PlanItem | undefined> {
  return editToolModels(tool, from, { step });
}

export async function setupTool(tool: ITool, step?: StepInfo): Promise<boolean> {
  // 用户取消模型配置时跳过后续装载与就绪提示，避免误报"配置成功"
  const completed = await tool.runModelConfigFlow({ step });
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

// 选择工具 → 选模型 → 确认写入；取消或失败返回 false。
// first：「选工具」在整个流程中的步序（首次向导为第 4 步，菜单里为第 1 步）
export async function runToolSetupFlow(candidates?: ITool[], steps: { first: number; total: number; keys: string[] } = { first: 1, total: FLOW_STEP_KEYS.length, keys: FLOW_STEP_KEYS }, options: { showCurrentModels?: boolean } = {}): Promise<boolean> {
  const tools = candidates ?? toolManager.getAll();
  const step = (offset: number): StepInfo => ({ current: steps.first + offset, total: steps.total, keys: steps.keys });
  let targets: ITool[] | undefined;
  let cursor: string | undefined;
  toolSelection: while (true) {
    // 进度 2 + 标题与说明 3 + 整个工具勾选列表
    uiRenderer.renderPage(t('page_tools'), step(0), t('page_tools_hint'), undefined, { bodyRows: 5 + checklistRows(tools.length) });
    let entered: ITool | undefined;
    targets = await selectTargets(t('setup_select_tools'), tools, { installable: true, default: cursor, detail: options.showCurrentModels ? currentModelDetail : undefined, onEnter: tool => { entered = tool; } });
    if (!targets?.length) return false;
    cursor = targets[0].name;
    // 在未安装的命令行工具上直接回车：先进安装页；可安装、跳过安装直接配置，或返回重选。勾选后继续则直接配置
    const only = entered;
    if (only && installState(only) === false && only.installCommand) {
      const installed = await installTool(only, { allowSkip: true });
      if (!installed) { cursor = only.name; continue; }
    }
    const previewable = targets.filter(tool => !tool.launchOnly && tool.supportsPreview === true);
    if (previewable.length) while (true) {
      const plans: PlanItem[] = [];
      const shared = previewable.filter(tool => !['claude-code', 'codebuddy', 'workbuddy'].includes(tool.name));
      for (const tool of previewable.filter(tool => !shared.includes(tool))) {
        const plan = await editSetupPlan(tool, undefined, step(1));
        if (!plan) continue toolSelection;
        plans.push(plan);
      }
      if (shared.length) {
        const currentModels = options.showCurrentModels ? shared.map(tool => {
          try { return { tool: tool.displayName, model: currentMainModel(tool) }; }
          catch { return { tool: tool.displayName }; }
        }) : undefined;
        const picked = await pickModel({ tools: shared, step: step(1), currentModels });
        if (picked === 'back' || !('model' in picked)) continue toolSelection;
        plans.push(...shared.map(tool => planForTool(tool, picked.model)));
      }
      const ordered = previewable.map(tool => plans.find(plan => plan.tool === tool)!);
      const results = await confirmAndWrite(t('page_confirm'), ordered, [], { step: step(2), edit: item => editSetupPlan(item.tool, item, step(1)) });
      if (results !== 'back') { await promptHelper.pressEnter(); if (results.some(result => result.status === 'failed')) return false; break; }
    }
    // 启动器只配置模型；外部 writer 使用原有的单工具配置流程单独处理。
    for (const tool of targets.filter(tool => tool.launchOnly || tool.supportsPreview !== true)) {
      if (!tool.launchOnly) uiRenderer.renderHint(t('setup_preview_fallback', { tool: tool.displayName }));
      if (!await setupTool(tool, step(1))) continue toolSelection;
    }
    return true;
  }
}
