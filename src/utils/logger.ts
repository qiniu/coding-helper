import chalk from 'chalk';
import { AsyncLocalStorage } from 'node:async_hooks';

const quietLogs = new AsyncLocalStorage<boolean>();
export function withQuietLogs<T>(operation: () => Promise<T>): Promise<T> {
  return quietLogs.run(true, operation);
}

// 日志工具 - 统一终端输出格式
export const logger = {
  info(message: string): void {
    if (quietLogs.getStore()) return;
    console.log(chalk.blue('ℹ'), message);
  },

  success(message: string): void {
    if (quietLogs.getStore()) return;
    console.log(chalk.green('✔'), message);
  },

  warn(message: string): void {
    if (quietLogs.getStore()) return;
    console.log(chalk.yellow('⚠'), message);
  },

  error(message: string): void {
    if (quietLogs.getStore()) return;
    console.error(chalk.red('✖'), message);
  },

  // 普通输出，不带前缀
  log(message: string): void {
    if (quietLogs.getStore()) return;
    console.log(message);
  },

  // 空行
  newLine(): void {
    if (quietLogs.getStore()) return;
    console.log();
  },
};
