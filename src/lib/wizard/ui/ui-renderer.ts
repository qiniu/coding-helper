import chalk from 'chalk';
import { stringWidth, padEnd } from '../../../utils/string-width.js';
import { logger } from '../../../utils/logger.js';
import { renderLogo as renderLogoArt } from './logo.js';
import { theme } from './theme.js';
import { configManager } from '../../config.js';
import { ENDPOINT_DEFINITIONS } from '../../endpoints.js';
import { t } from '../../i18n.js';

// 配置面板条目
export interface ConfigPanelItem {
  label: string;
  value: string;
  configured: boolean;
}

// 终端 UI 渲染器
export const uiRenderer = {
  // 清屏 - 清除终端内容和滚动缓冲区
  clearScreen(): void {
    process.stdout.write('\x1Bc');
  },

  // 渲染七牛 Logo
  renderLogo(): void {
    renderLogoArt();
  },

  // 统一页面头部：清屏 + Logo + 配置面板（线路 + API Key）
  renderHeader(): void {
    this.clearScreen();
    this.renderLogo();

    const endpointId = configManager.getEndpoint();
    const endpointDef = endpointId ? ENDPOINT_DEFINITIONS[endpointId] : undefined;
    const endpointDisplay = endpointDef
      ? t(endpointDef.i18nKey)
      : t('config_view_not_set');

    const apiKey = configManager.getApiKey();
    const apiKeyDisplay = apiKey
      ? this.maskApiKey(apiKey)
      : t('config_view_not_set');

    this.renderConfigPanel([
      { label: t('config_view_endpoint'), value: endpointDisplay, configured: !!endpointDef },
      { label: t('config_view_apikey'), value: apiKeyDisplay, configured: !!apiKey },
    ]);
  },

  // 渲染欢迎界面
  renderWelcome(title: string, description: string, privacyNotice: string): void {
    const line = '─'.repeat(50);
    logger.newLine();
    logger.log(chalk.cyan(line));
    logger.log(chalk.bold.cyan(`  ${title}`));
    logger.log(chalk.cyan(line));
    logger.newLine();
    logger.log(`  ${description}`);
    logger.newLine();
    logger.log(chalk.dim(`  ${privacyNotice}`));
    logger.newLine();
  },

  // 渲染标题 — 左右等长灰色线条 + 中间亮色标题
  renderTitle(title: string): void {
    const titleWidth = stringWidth(title);
    const totalWidth = 50;
    const sideLen = Math.max(2, Math.floor((totalWidth - titleWidth - 2) / 2));
    const leftLine = '─'.repeat(sideLen);
    const rightLine = '─'.repeat(sideLen);
    logger.newLine();
    logger.log(`  ${theme.subtle(leftLine)} ${theme.heading(title)} ${theme.subtle(rightLine)}`);
    logger.newLine();
  },

  // 渲染带边框的配置面板卡片
  renderConfigPanel(items: ConfigPanelItem[]): void {
    const labelWidth = 16;  // 标签列宽度
    const valueWidth = 32;  // 值列宽度
    const innerWidth = labelWidth + valueWidth + 5; // 状态圆点 + 间距
    const topBorder    = `  ${theme.border('┌' + '─'.repeat(innerWidth) + '┐')}`;
    const bottomBorder = `  ${theme.border('└' + '─'.repeat(innerWidth) + '┘')}`;
    const midBorder    = `  ${theme.border('├' + '─'.repeat(innerWidth) + '┤')}`;

    logger.log(topBorder);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      // 状态圆点：已配置绿色 ●，未配置灰色 ○
      const dot = item.configured
        ? theme.accent('●')
        : theme.subtle('○');
      const label = theme.label(padEnd(item.label, labelWidth));
      const val = item.configured
        ? theme.value(item.value)
        : theme.muted(item.value);

      // 计算可见宽度来精确对齐右边框
      // 边框内内容：空格 + 圆点(1) + 空格 + 标签(labelWidth) + 空格 + 值(变长)
      const valueVisibleWidth = stringWidth(item.value);
      const contentVisibleWidth = 1 + 1 + 1 + labelWidth + 1 + valueVisibleWidth;
      const padding = Math.max(0, innerWidth - contentVisibleWidth);

      logger.log(`  ${theme.border('│')} ${dot} ${label} ${val}${' '.repeat(padding)}${theme.border('│')}`);

      // 中间分隔线（不在最后一项后面）
      if (i < items.length - 1) {
        logger.log(midBorder);
      }
    }

    logger.log(bottomBorder);
    logger.newLine();
  },

  // 渲染键值对配置信息
  renderConfigItem(label: string, value: string | undefined, targetWidth = 16): void {
    const paddedLabel = padEnd(label, targetWidth);
    const displayValue = value || chalk.dim('N/A');
    logger.log(`  ${chalk.bold(paddedLabel)} ${displayValue}`);
  },

  // 渲染分隔线
  renderDivider(): void {
    logger.log(chalk.dim('─'.repeat(50)));
  },

  // 渲染灰色提示信息（次要文案）
  renderHint(message: string): void {
    logger.log(chalk.dim(`  ${message}`));
  },

  // 渲染成功消息
  renderSuccess(message: string): void {
    logger.success(message);
  },

  // 渲染错误消息
  renderError(message: string): void {
    logger.error(message);
  },

  // 渲染警告消息
  renderWarning(message: string): void {
    logger.warn(message);
  },

  // 遮蔽 API Key，只显示前4位和后4位
  maskApiKey(key: string): string {
    if (key.length <= 8) return '****';
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
  },
};
