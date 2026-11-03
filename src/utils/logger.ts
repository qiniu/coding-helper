import chalk from 'chalk';
import { AsyncLocalStorage } from 'node:async_hooks';
import { visibleWidth } from './string-width.js';

const quietLogs = new AsyncLocalStorage<boolean>();
export function withQuietLogs<T>(operation: () => Promise<T>): Promise<T> {
  return quietLogs.run(true, operation);
}

// 清屏后已输出的终端行数（按列宽折行计算），供页头与菜单判断剩余高度；未清屏时不跟踪
let screenRows: number | undefined;
function countRows(...parts: unknown[]): void {
  if (screenRows === undefined) return;
  const columns = process.stdout.columns || 80;
  for (const line of parts.map(part => String(part ?? '')).join(' ').split('\n')) {
    screenRows += Math.max(1, Math.ceil(visibleWidth(line) / columns));
  }
}
export const screen = {
  // 清屏时调用：从 0 开始计数
  reset(): void { screenRows = 0; },
  // 清屏后已用的行数；没有清屏过时返回 undefined
  used(): number | undefined { return screenRows; },
};

// 日志工具 - 统一终端输出格式
export const logger = {
  info(message: string): void {
    if (quietLogs.getStore()) return;
    countRows('ℹ', message);
    console.log(chalk.blue('ℹ'), message);
  },

  success(message: string): void {
    if (quietLogs.getStore()) return;
    countRows('✔', message);
    console.log(chalk.green('✔'), message);
  },

  warn(message: string): void {
    if (quietLogs.getStore()) return;
    countRows('⚠', message);
    console.log(chalk.yellow('⚠'), message);
  },

  error(message: string): void {
    if (quietLogs.getStore()) return;
    countRows('✖', message);
    console.error(chalk.red('✖'), message);
  },

  // 普通输出，不带前缀
  log(message: string): void {
    if (quietLogs.getStore()) return;
    countRows(message);
    console.log(message);
  },

  // 空行
  newLine(): void {
    if (quietLogs.getStore()) return;
    countRows('');
    console.log();
  },
};
