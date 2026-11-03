import ora from 'ora';
import { t } from '../../i18n.js';
import { configManager } from '../../config.js';
import { savedModelFor } from '../../core/model-mapping.js';
import { slotOverrides, toolSlots } from '../../core/model-slots.js';
import type { ITool } from '../../tools/base-tool.js';
import { uiRenderer, type StepInfo } from '../ui/ui-renderer.js';
import { menuPrompt, type MenuEntry } from '../ui/prompts.js';
import type { PlanItem } from '../../core/write-plan.js';
import { theme } from '../ui/theme.js';
import { builtinPlanForClaude, pickModel, planForTool } from './model-pick-flow.js';

import { editBuddyModelsPlan } from './buddy-model-plan.js';

const MAIN = '__main__';
const SAVE = '__save__';
const BUILTIN = '__builtin__';

// 一个工具的模型页：主模型 + 各槽位（默认跟随主模型）；回车或 → 打开选模型，最后一行「保存」。
// 返回新的写入计划；Esc 返回 undefined
export async function editToolModels(tool: ITool, from?: PlanItem, options: { step?: StepInfo } = {}): Promise<PlanItem | undefined> {
  if (tool.name === 'codebuddy' || tool.name === 'workbuddy') return editBuddyModelsPlan(tool, from, options.step);
  const saved = configManager.getModels();
  let main = from?.main ?? savedModelFor(tool, saved) ?? tool.defaultModel;
  const original = main;
  const overrides = { ...(from?.overrides ?? slotOverrides(tool.name, saved)) };
  const slots = toolSlots(tool.name);
  const originalOverrides = { ...overrides };
  const title = t('slots_title', { tool: tool.displayName });
  // Claude Code 可以不设置自定义模型，沿用内置模型 ID；已保存为内置模型时进入页面即处于该状态
  const canBuiltin = tool.name === 'claude-code';
  let builtin = canBuiltin && (from ? from.builtin === true : saved.claudeCode?.useDefaultModels === true);
  // 首次进入一律聚焦主模型，回车直接打开模型选择；改过一项之后才聚焦「保存」
  let last: string = MAIN;

  while (true) {
    // 使用内置模型时各项由 Claude Code 决定，换一句说明
    uiRenderer.renderPage(title, options.step, builtin ? t('slots_builtin_subtitle') : slots.length ? t('slots_subtitle') : undefined);
    const builtinValue = theme.value(t('slots_builtin_value'));
    const entries: MenuEntry<string>[] = [
      {
        value: MAIN,
        label: tool.name === 'claude-code' ? t('plan_claude_main') : t('plan_model'),
        hint: builtin ? builtinValue : main ? theme.value(main) : theme.warning(t('slots_main_unset')),
        ...(builtin ? { description: theme.subtle(t('slots_builtin_main_hint')) } : {}),
      },
      ...slots.map((slot) => {
        const own = overrides[slot.id];
        return {
          value: slot.id,
          label: t(slot.labelKey),
          // 使用内置模型时各槽位也由 Claude Code 决定，不能单独设置
          disabled: builtin,
          hint: builtin ? theme.subtle(t('slots_builtin_value'))
            : own
              ? `${theme.value(own)}  ${theme.subtle(t('slot_custom'))}`
              : theme.subtle(`${t('slot_follow_main')}${main ? ` · ${main}` : ''}`),
          description: theme.subtle(t(slot.hintKey)),
        };
      }),
      ...(canBuiltin ? [
        { separator: '' },
        {
          value: BUILTIN,
          label: t('slots_builtin'),
          hint: builtin ? theme.success(`✔ ${t('slots_builtin_selected')}`) : '',
          description: theme.subtle(t('slots_builtin_hint')),
        },
      ] : []),
      { separator: '' },
      { value: SAVE, label: theme.brandBold(from ? t('slots_done') : t('slots_save')) },
    ];
    const { value, action } = await menuPrompt<string>({
      message: t('menu_select_action'),
      default: last,
      escape: true,
      arrows: true,
      items: entries,
    });
    if (action === 'escape') return undefined;
    if (action === 'left') continue;
    last = value;

    // 切换「使用 Claude Code 内置模型」；选中后聚焦「保存」
    if (value === BUILTIN) {
      builtin = !builtin;
      last = builtin ? SAVE : MAIN;
      continue;
    }

    if (value === SAVE) {
      // 内置模型不需要探测兼容性，直接生成写入计划
      if (builtin) return { ...builtinPlanForClaude(tool), connection: configManager.getConnection(tool.name) };
      if (!main) {
        last = MAIN;
        continue;
      }
      // 主模型及改变过的有效槽位逐一验证；共享同一模型的槽位只探测一次。
      const selectedMain = main;
      const changed = [...new Set([
        ...(selectedMain !== original ? [selectedMain] : []),
        ...slots.filter(slot => (overrides[slot.id] || selectedMain) !== (originalOverrides[slot.id] || original)).map(slot => overrides[slot.id] || selectedMain),
      ])];
      let rejected = false;
      const connection = configManager.getConnection(tool.name);
      if (tool.checkModel) for (const model of changed) {
        const spinner = ora({ text: t('model_checking', { tool: tool.displayName, model }), indent: 2 }).start();
        let reason: string | undefined;
        try { reason = await tool.checkModel(model, { apiKey: connection.apiKey ?? '', baseUrl: connection.baseUrl }); }
        catch { reason = 'quick_model_incompatible'; }
        if (reason) {
          spinner.fail(t(reason, { tool: tool.displayName, model }));
          last = slots.find(slot => overrides[slot.id] === model)?.id ?? MAIN;
          rejected = true;
          break;
        }
        spinner.succeed(t('model_compatible', { tool: tool.displayName, model }));
      }
      if (rejected) continue;
      return { ...planForTool(tool, main, overrides), connection };
    }

    const isMain = value === MAIN;
    const picked = await pickModel({
      tools: [tool],
      step: options.step,
      title: isMain ? title : `${title} · ${t(slots.find((s) => s.id === value)!.labelKey)}`,
      current: isMain ? main : overrides[value],
      follow: isMain ? undefined : main ?? '',
    });
    if (picked === 'back') continue;
    if (isMain) {
      // 选了具体模型就改为自定义映射
      if ('model' in picked) { main = picked.model; builtin = false; }
    } else if ('follow' in picked) delete overrides[value];
    else if ('model' in picked) overrides[value] = picked.model;
    last = SAVE;
  }
}
