import chalk from 'chalk';
import { visibleWidth, truncate } from '../../../utils/string-width.js';
import { logger } from '../../../utils/logger.js';
import { GRADIENT } from './theme.js';
import { VERSION } from '../../version.js';
import { t } from '../../i18n.js';
import { registeredTools } from '../../tool-registry.js';
import { compactQiniuGrid, logoGrid, renderGrid, renderSprite, joinBlocks, pixelsSupported, LOGO_WIDTH, spriteGrid } from './pixel.js';

// 紧凑品牌页头不依赖 256 色：无颜色终端仍可显示同一牛头轮廓。
export const COMPACT_LOGO_HEIGHT = 6;
export const COMPACT_LOGO_MIN_COLUMNS = 38;

export function renderCompactLogo(): void {
  logger.newLine();
  const mark = renderGrid(compactQiniuGrid());
  const columns = process.stdout.columns || 80;
  for (const [index, line] of mark.entries()) {
    const text = truncate(index === 2 ? 'Coding Helper' : index === 3 ? `v${VERSION}` : '', columns - 21);
    const label = index === 2 ? chalk.bold(text) : chalk.dim(text);
    logger.log(`  ${line}   ${label}`);
  }
}

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
// 按当前角色的实际宽度判断终端能否容纳像素页头

// 标语里的工具数取自注册表（含只能启动接入的工具），新增工具时不用改文案
function renderTagline(): void {
  const prefix = `  ${chalk.bold.hex('#E8F6FF')('Coding Helper')}  ${chalk.hex('#7D8B99')(`v${VERSION}`)}`;
  const line = `${prefix}  ${chalk.hex('#7D8B99')('·')}  ${chalk.hex('#9FB0BF')(t('header_tagline', { count: String(registeredTools().length) }))}`;
  const columns = process.stdout.columns || 80;
  logger.log(visibleWidth(line) <= columns ? line : prefix);
}

// renderLogo 会输出的行数（与下面的分支一一对应），用于按终端高度决定能否显示完整 Logo
// 渲染七牛 Logo：宽终端用像素字与牛头并排，窄终端保留牛头；工具页可显示工具角色。
export function renderLogo(sprite = 'qiniu'): void {
  logger.newLine();
  if (process.stdout.columns && process.stdout.columns < 38) {
    logger.log(truncate(`  QINIU Coding Helper v${VERSION}`, process.stdout.columns));
    logger.newLine(); return;
  }
  const spriteWidth = Math.max(0, ...(spriteGrid(sprite) ?? []).map(row => row.length));
  const pixelMinColumns = 2 + LOGO_WIDTH + LOGO_GAP + spriteWidth + 4;
  if (pixelsSupported() && (process.stdout.columns || 0) >= pixelMinColumns) {
    const blocks = [renderGrid(logoGrid()), renderSprite(sprite)];
    for (const line of joinBlocks(blocks, [LOGO_WIDTH + LOGO_GAP - 1, spriteWidth], 1)) logger.log(`  ${line}`);
    logger.newLine();
    renderTagline();
    logger.newLine();
    return;
  }
  // 宽度不足以并排显示时，欢迎页仍用官方牛头，不退回纯字母。
  if (sprite === 'qiniu') {
    for (const line of renderSprite('qiniu')) logger.log(`  ${line}`);
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
