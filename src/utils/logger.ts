import chalk from 'chalk';

// 日志工具 - 统一终端输出格式
export const logger = {
  info(message: string): void {
    console.log(chalk.blue('ℹ'), message);
  },

  success(message: string): void {
    console.log(chalk.green('✔'), message);
  },

  warn(message: string): void {
    console.log(chalk.yellow('⚠'), message);
  },

  error(message: string): void {
    console.error(chalk.red('✖'), message);
  },

  // 普通输出，不带前缀
  log(message: string): void {
    console.log(message);
  },

  // 空行
  newLine(): void {
    console.log();
  },
};
