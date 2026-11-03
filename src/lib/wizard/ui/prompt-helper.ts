import inquirer from 'inquirer';
import { pickModel, type PickOptions, type PickResult } from '../flows/model-pick-flow.js';
import { menuPrompt } from './prompts.js';
import { scoreModel, closestModels, resolveModelId, parseModelQuery, type SearchableModel } from '../../core/model-search.js';
import { RECOMMENDED_MODELS } from '../../core/quick-args.js';
import { t } from '../../i18n.js';
import { theme } from './theme.js';

export interface ModelChoice { name: string; value: string; description?: string; model?: SearchableModel; }

// 搜索选择的跳过标记
const SKIP_VALUE = '__skip__';
export const MANUAL_MODEL_VALUE = '__manual_model__';

// inquirer 封装 - 统一交互式 prompt
export const promptHelper = {
  async pickModel(options: PickOptions): Promise<PickResult> { return pickModel(options); },
  // 单选列表
  async select<T extends string>(message: string, choices: { name: string; value: T }[]): Promise<T> {
    const { answer } = await inquirer.prompt([
      {
        type: 'list',
        name: 'answer',
        message,
        choices,
      },
    ]);
    return answer as T;
  },

  // 密码/隐藏输入
  async password(message: string): Promise<string> {
    const { answer } = await inquirer.prompt([
      {
        type: 'password',
        name: 'answer',
        message,
        mask: '*',
      },
    ]);
    return answer as string;
  },

  // 文本输入
  async input(message: string, defaultValue?: string): Promise<string> {
    const { answer } = await inquirer.prompt([
      {
        type: 'input',
        name: 'answer',
        message,
        default: defaultValue,
      },
    ]);
    return answer as string;
  },

  // 确认 (上下选择)
  async confirm(message: string, defaultValue = true): Promise<boolean> {
    const choices = defaultValue
      ? [
          { name: `${theme.icon('✔')} ${t('confirm_yes')}`, value: true },
          { name: `${theme.dimIcon('✘')} ${t('confirm_no')}`, value: false },
        ]
      : [
          { name: `${theme.dimIcon('✘')} ${t('confirm_no')}`, value: false },
          { name: `${theme.icon('✔')} ${t('confirm_yes')}`, value: true },
        ];

    const { answer } = await inquirer.prompt([
      {
        type: 'list',
        name: 'answer',
        message,
        choices,
      },
    ]);
    return answer as boolean;
  },

  // 按回车继续（不显示 Yes/No，仅等待用户按回车）
  async pressEnter(message?: string): Promise<void> {
    await inquirer.prompt([
      {
        type: 'input',
        name: 'answer',
        message: message || t('press_enter_to_continue'),
      },
    ]);
  },

  // 多选列表
  async checkbox<T extends string>(message: string, choices: { name: string; value: T }[]): Promise<T[]> {
    const { answer } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'answer',
        message,
        choices,
        pageSize: 15,
      },
    ]);
    return answer as T[];
  },

  // 搜索+自动补全选择（同时展示输入框和可滚动列表，支持自定义输入和跳过）
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
