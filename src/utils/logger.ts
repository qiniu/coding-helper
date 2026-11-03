import chalk from 'chalk';
import { AsyncLocalStorage } from 'node:async_hooks';
import { visibleWidth } from './string-width.js';

const quietLogs = new AsyncLocalStorage<boolean>();
export function withQuietLogs<T>(operation: () => Promise<T>): Promise<T> {
  return quietLogs.run(true, operation);
}

// 清屏后已输出的终端行数（按列宽折行计算），供页头与菜单判断剩余高度；未清屏时不跟踪
let screenContent: string[] | undefined;
let frameRenderer: (() => void) | undefined;
let frameTail: string[] = [];

export interface ScreenFrame {
  render?: () => void;
  lines: string[];
}

function countRows(...parts: unknown[]): void {
  if (!screenContent) return;
  const text = parts.map(part => String(part ?? '')).join(' ');
  screenContent.push(text);
  frameTail.push(text);
}
export const screen = {
  // 清屏时调用：从 0 开始计数
  reset(): void { screenContent = []; frameRenderer = undefined; frameTail = []; },
  // 清屏后已用的行数；没有清屏过时返回 undefined
  used(): number | undefined {
    if (!screenContent) return undefined;
    const columns = process.stdout.columns || 80;
    return screenContent.reduce((total, text) => total + text.split('\n').reduce((rows, line) => rows + Math.max(1, Math.ceil(visibleWidth(line) / columns)), 0), 0);
  },
  // 记住页头的渲染方法，缩放后重新计算尺寸，而不是回放旧宽度的像素图。
  rememberFrame(render: () => void): void { frameRenderer = render; frameTail = []; },
  capture(): ScreenFrame { return { render: frameRenderer, lines: [...frameTail] }; },
  repaint(frame: ScreenFrame): void {
    if (frame.render) frame.render();
    else { process.stdout.write('\x1B[2J\x1B[H'); this.reset(); }
    for (const line of frame.lines) logger.log(line);
  },
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
