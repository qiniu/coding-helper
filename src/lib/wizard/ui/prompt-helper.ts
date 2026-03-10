import inquirer from 'inquirer';
import search from '@inquirer/search';
import { t } from '../../i18n.js';
import { theme } from './theme.js';

// 搜索选择的跳过标记
const SKIP_VALUE = '__skip__';

// inquirer 封装 - 统一交互式 prompt
export const promptHelper = {
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

  // 搜索+自动补全选择（同时展示输入框和可滚动列表，支持自定义输入和跳过）
  async searchSelect(
    message: string,
    items: { name: string; value: string; description?: string }[],
    allowSkip = false,
  ): Promise<string | undefined> {
    const answer = await search({
      message,
      pageSize: 10,
      source: async (term) => {
        const results: { name: string; value: string; description?: string }[] = [];

        // 始终在顶部添加跳过选项
        if (allowSkip) {
          results.push({
            name: `⊘ ${t('model_skip_option')}`,
            value: SKIP_VALUE,
          });
        }

        const keyword = (term || '').trim().toLowerCase();

        if (!keyword) {
          // 无输入时显示完整列表
          results.push(...items);
          return results;
        }

        // 根据输入过滤列表
        const filtered = items.filter(
          (item) =>
            item.name.toLowerCase().includes(keyword) ||
            item.value.toLowerCase().includes(keyword),
        );

        // 如果用户输入的值不匹配任何现有项，在列表头部注入自定义值选项
        const exactMatch = items.some(
          (item) => item.value.toLowerCase() === keyword,
        );
        if (!exactMatch) {
          results.push({
            name: `✎ ${t('model_custom_value', { value: term || '' })}`,
            value: (term || '').trim(),
          });
        }

        results.push(...filtered);
        return results;
      },
    });

    // 跳过时返回 undefined
    if (answer === SKIP_VALUE) {
      return undefined;
    }

    return (answer as string).trim() || undefined;
  },
};
