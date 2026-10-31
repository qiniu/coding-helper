import { pickModel, type PickOptions, type PickResult } from '../flows/model-pick-flow.js';
import { t } from '../../i18n.js';
import { menuPrompt, checkPrompt, secretPrompt, textPrompt, continuePrompt } from './prompts.js';

import { scoreModel, closestModels, resolveModelId, parseModelQuery, type SearchableModel } from '../../core/model-search.js';
import { RECOMMENDED_MODELS } from '../../core/quick-args.js';
export interface ModelChoice { name: string; value: string; description?: string; model?: SearchableModel; }
const SKIP_VALUE = '__skip__';
export const MANUAL_MODEL_VALUE = '__manual_model__';

export const promptHelper = {
  async pickModel(options: PickOptions): Promise<PickResult> { return pickModel(options); },
  async select<T extends string>(message: string, choices: { name: string; value: T }[]): Promise<T> {
    const back = choices.find(choice => ['back', 'exit', '__back__'].includes(choice.value));
    const result = await menuPrompt({ message, escape: !!back, items: choices.map(choice => ({ value: choice.value, label: choice.name })) });
    return result.action === 'escape' ? back!.value : result.value;
  },
  async password(message: string): Promise<string> { return await secretPrompt({ message, escape: true }) ?? ''; },
  async input(message: string, defaultValue?: string): Promise<string> { return await textPrompt({ message, default: defaultValue }) ?? ''; },
  async confirm(message: string, defaultValue = true): Promise<boolean> {
    const choices = defaultValue ? [{ value: true, label: t('confirm_yes') }, { value: false, label: t('confirm_no') }]
      : [{ value: false, label: t('confirm_no') }, { value: true, label: t('confirm_yes') }];
    const result = await menuPrompt({ message, escape: true, items: choices });
    return result.action !== 'escape' && result.value;
  },
  async pressEnter(message?: string): Promise<void> { await continuePrompt(message ?? t('press_enter_to_continue')); },
  async checkbox<T extends string>(message: string, choices: { name: string; value: T }[]): Promise<T[]> {
    return await checkPrompt({ message, allowEmpty: true, items: choices.map(choice => ({ value: choice.value, label: choice.name })) }) ?? [];
  },
  async searchSelect(
    message: string,
    items: ModelChoice[],
    allowSkip = false,
  ): Promise<string | undefined> {
    const byId = new Map(items.map(item => [item.value, item]));
    const controls = new Set([MANUAL_MODEL_VALUE, ...(allowSkip ? [SKIP_VALUE] : [])]);
    const controlLabels = [...(byId.get(MANUAL_MODEL_VALUE) ? [byId.get(MANUAL_MODEL_VALUE)!.name] : []), ...(allowSkip ? [t('model_skip_option')] : [])];
    const modelOf = (value: string): SearchableModel => ({ ...(byId.get(value)?.model ?? { id: value, context: 0, toolCall: false, vision: false }), name: byId.get(value)?.name });
    const rows = items.map(item => ({ value: item.value, label: item.name, description: item.description }));
    const { value, action, query } = await menuPrompt({
      message, escape: true, searchable: true, customFirst: true, pageSize: 10,
      items: [...(allowSkip ? [{ value: SKIP_VALUE, label: `⊘ ${t('model_skip_option')}` }] : []), ...rows],
      filter: (item, q) => controls.has(item.value)
        ? item.label.toLowerCase().includes(q.trim().toLowerCase()) ? 50 : undefined
        : scoreModel(modelOf(item.value), q, { recommended: RECOMMENDED_MODELS.includes(item.value) }),
      suggest: q => {
        const parsed = parseModelQuery(q);
        const candidates = items.filter(item => !controls.has(item.value) && scoreModel(modelOf(item.value), [parsed.toolCall ? 'tools' : '', parsed.reasoning ? 'thinking' : '', parsed.vision ? 'vision' : '', parsed.minContext ? `${parsed.minContext / 1000}k` : ''].join(' ')) !== undefined);
        return closestModels(candidates.map(item => item.value), q).map(id => rows.find(row => row.value === id)!);
      },
      highlight: q => parseModelQuery(q).words.join(''),
      customLabel: q => {
        const parsed = parseModelQuery(q);
        return /^[\w.\-/:]+$/.test(q.trim()) && !parsed.minContext && !parsed.vision && !parsed.toolCall && !parsed.reasoning && !byId.has(q.trim()) && !controlLabels.some(label => label.toLowerCase().includes(q.trim().toLowerCase()))
          ? t('model_custom_value', { value: resolveModelId(q, items.map(item => item.value)) }) : undefined;
      },
    });
    if (action === 'escape' || (allowSkip && value === SKIP_VALUE)) return undefined;
    return (action === 'custom' ? resolveModelId(query ?? '', items.map(item => item.value)) : value).trim() || undefined;
  },
};
