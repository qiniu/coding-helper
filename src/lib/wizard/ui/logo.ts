import chalk from 'chalk';
import { logger } from '../../../utils/logger.js';
import { GRADIENT } from './theme.js';
import { VERSION } from '../../version.js';

// "QINIU" ASCII Art（block 风格，约 34 列宽）
const LOGO_LINES = [
  '  ██████  ██ ███    ██ ██ ██    ██',
  ' ██    ██ ██ ████   ██ ██ ██    ██',
  ' ██    ██ ██ ██ ██  ██ ██ ██    ██',
  ' ██ ▄▄ ██ ██ ██  ██ ██ ██ ██    ██',
  '  ██████  ██ ██   ████ ██  ██████ ',
  '     ▀▀                           ',
];

// 渲染七牛 Logo（逐行渐变色）和副标题 + 版本号
export function renderLogo(): void {
  logger.newLine();
  // 逐行应用渐变色
  for (let i = 0; i < LOGO_LINES.length; i++) {
    const color = GRADIENT[i] || GRADIENT[GRADIENT.length - 1];
    logger.log(chalk.hex(color)(LOGO_LINES[i]));
  }
  logger.log(chalk.bold.hex(GRADIENT[1])('            Coding Helper'));
  logger.log(chalk.hex('#6B7280')(`               v${VERSION}`));
  logger.newLine();
}
