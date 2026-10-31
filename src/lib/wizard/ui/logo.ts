import chalk from 'chalk';
import { visibleWidth, truncate } from '../../../utils/string-width.js';
import { logger } from '../../../utils/logger.js';
import { GRADIENT } from './theme.js';
import { VERSION } from '../../version.js';
import { t } from '../../i18n.js';
import { logoGrid, renderGrid, renderSprite, joinBlocks, pixelsSupported, LOGO_WIDTH, SPRITE_WIDTH } from './pixel.js';

// "QINIU" ASCII Art（不支持 256 色或终端过窄时使用，约 34 列宽）
const LOGO_LINES = [
  '  ██████  ██ ███    ██ ██ ██    ██',
  ' ██    ██ ██ ████   ██ ██ ██    ██',
  ' ██    ██ ██ ██ ██  ██ ██ ██    ██',
  ' ██ ▄▄ ██ ██ ██  ██ ██ ██ ██    ██',
  '  ██████  ██ ██   ████ ██  ██████ ',
  '     ▀▀                           ',
];

// Logo 与小牛之间留 4 列
const LOGO_GAP = 4;
// 像素 Logo + 小牛需要的最小终端宽度
const PIXEL_MIN_COLUMNS = 2 + LOGO_WIDTH + LOGO_GAP + SPRITE_WIDTH + 4;

function renderTagline(): void {
  const prefix = `  ${chalk.bold.hex('#E8F6FF')('Coding Helper')}  ${chalk.hex('#7D8B99')(`v${VERSION}`)}`;
  const line = `${prefix}  ${chalk.hex('#7D8B99')('·')}  ${chalk.hex('#9FB0BF')(t('header_tagline'))}`;
  const columns = process.stdout.columns || 80;
  logger.log(visibleWidth(line) <= columns ? line : prefix);
}

// 渲染七牛 Logo：宽终端用像素字 + 小牛，否则用文字 Logo
export function renderLogo(sprite = 'qiniu'): void {
  logger.newLine();
  if (process.stdout.columns && process.stdout.columns < 38) {
    logger.log(truncate(`  QINIU Coding Helper v${VERSION}`, process.stdout.columns));
    logger.newLine(); return;
  }
  if (pixelsSupported() && (process.stdout.columns || 0) >= PIXEL_MIN_COLUMNS) {
    const blocks = [renderGrid(logoGrid()), renderSprite(sprite)];
    for (const line of joinBlocks(blocks, [LOGO_WIDTH + LOGO_GAP - 1, SPRITE_WIDTH], 1)) logger.log(`  ${line}`);
    logger.newLine();
    renderTagline();
    logger.newLine();
    return;
  }
  for (let i = 0; i < LOGO_LINES.length; i++) {
    const color = GRADIENT[i] || GRADIENT[GRADIENT.length - 1];
    logger.log(chalk.hex(color)(LOGO_LINES[i]));
  }
  renderTagline();
  logger.newLine();
}
