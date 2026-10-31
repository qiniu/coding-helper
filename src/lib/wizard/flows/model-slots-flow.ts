import ora from 'ora';
import { t } from '../../i18n.js';
import { configManager } from '../../config.js';
import { savedModelFor } from '../../core/model-mapping.js';
import { slotOverrides, toolSlots } from '../../core/model-slots.js';
import type { ITool } from '../../tools/base-tool.js';
import { uiRenderer } from '../ui/ui-renderer.js';
import { menuPrompt, type MenuEntry } from '../ui/prompts.js';
import type { PlanItem } from '../../core/write-plan.js';
import { theme } from '../ui/theme.js';
import { pickModel, planForTool } from './model-pick-flow.js';

const MAIN = '__main__';
const SAVE = '__save__';

// 一个工具的模型页：主模型 + 各槽位（默认跟随主模型）；回车或 → 打开选模型，最后一行「保存」。
// 返回新的写入计划；Esc 返回 undefined
export async function editToolModels(tool: ITool, from?: PlanItem): Promise<PlanItem | undefined> {
  const saved = configManager.getModels();
  let main = from?.main ?? savedModelFor(tool, saved) ?? tool.defaultModel;
  const original = main;
  const overrides = { ...(from?.overrides ?? slotOverrides(tool.name, saved)) };
  const slots = toolSlots(tool.name);
  const originalOverrides = { ...overrides };
  const title = t('slots_title', { tool: tool.displayName });
  let last: string = main ? SAVE : MAIN;

  while (true) {
    uiRenderer.renderPage(title, undefined, slots.length ? t('slots_subtitle') : undefined);
    const entries: MenuEntry<string>[] = [
      {
        value: MAIN,
        label: tool.name === 'claude-code' ? t('plan_claude_main') : t('plan_model'),
        hint: main ? theme.value(main) : theme.warning(t('slots_main_unset')),
      },
      ...slots.map((slot) => {
        const own = overrides[slot.id];
        return {
          value: slot.id,
          label: t(slot.labelKey),
          hint: own
            ? `${theme.value(own)}  ${theme.subtle(t('slot_custom'))}`
            : theme.subtle(`${t('slot_follow_main')}${main ? ` · ${main}` : ''}`),
          description: theme.subtle(t(slot.hintKey)),
        };
      }),
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

    if (value === SAVE) {
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
      title: isMain ? title : `${title} · ${t(slots.find((s) => s.id === value)!.labelKey)}`,
      current: isMain ? main : overrides[value],
      follow: isMain ? undefined : main ?? '',
    });
    if (picked === 'back') continue;
    if (isMain) {
      if ('model' in picked) main = picked.model;
    } else if ('follow' in picked) delete overrides[value];
    else overrides[value] = picked.model;
    last = SAVE;
  }
}
