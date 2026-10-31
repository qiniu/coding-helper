import { registeredTools } from '../../tool-registry.js';
import chalk from 'chalk';
import { stringWidth, padEnd, truncate, visibleWidth } from '../../../utils/string-width.js';
import { logger } from '../../../utils/logger.js';
import { renderLogo as renderLogoArt } from './logo.js';
import { theme } from './theme.js';
import { configManager, type Connection } from '../../config.js';
import { CUSTOM_ENDPOINT, ENDPOINT_DEFINITIONS } from '../../endpoints.js';
import { t } from '../../i18n.js';

export interface StepInfo { current: number; total: number; keys?: string[]; }

// 配置面板条目
export interface ConfigPanelItem {
  label: string;
  value: string;
  configured: boolean;
}

export function connectedToolNames(): string[] {
  return registeredTools().filter(tool => { try { return !tool.launchOnly && tool.isConfigured?.(); } catch { return false; } }).map(tool => tool.name);
}

// 终端 UI 渲染器
export const uiRenderer = {
  renderPage(title: string, step?: StepInfo, subtitle?: string, connection?: Connection): void {
    this.renderHeader({ connection });
    this.renderTitle(step ? `${title} (${step.current}/${step.total})` : title);
    if (subtitle) this.renderHint(subtitle);
  },
  // 清屏 - 清除终端内容和滚动缓冲区
  clearScreen(): void {
    process.stdout.write('\x1Bc');
  },

  // 渲染七牛 Logo
  renderLogo(): void {
    renderLogoArt();
  },

  // 统一页面头部：清屏 + Logo + 配置面板（线路 + API Key）
  renderHeader(options: { full?: boolean; crumb?: string; connection?: Connection } = {}): void {
    this.clearScreen();
    if (options.full) this.renderLogo();
    else logger.log(`  ${theme.brandBold('QINIU')} ${theme.heading('Coding Helper')}${options.crumb ? '  >  ' + options.crumb : ''}`);
    this.renderStatusBar(options.connection);
  },
  renderStatusBar(connection?: Connection): void {
    const apiKey = connection ? connection.apiKey : configManager.getApiKey();
    const total = registeredTools().filter(tool => !tool.launchOnly).length;
    const parts = [
      `${theme.success('●')} ${theme.subtle(this.endpointLabel(connection?.endpoint, connection?.baseUrl))}`,
      `${theme.subtle('Key')} ${apiKey ? theme.subtle(this.maskApiKey(apiKey)) : theme.warning(t('config_view_not_set'))}`,
      `${theme.subtle(t('status_applied'))} ${theme.brand(String(connectedToolNames().length))} / ${total}`,
    ];
    const profile = connection ? connection.profile : configManager.getActiveProfile();
    if (profile) parts.push(`${theme.subtle(t('profile_label'))} ${theme.brand(profile)}`);
    const columns = Math.max(12, process.stdout.columns || 100);
    const line = parts.join(theme.subtle('  ·  '));
    if (visibleWidth(line) + 4 <= columns) logger.log(`  ${line}`);
    else for (const part of parts) logger.log(`  ${part}`);
    logger.log(`  ${theme.border('─'.repeat(Math.max(1, Math.min(columns - 4, 72))))}`);
    logger.newLine();
  },
  endpointLabel(endpoint = configManager.getEndpoint(), baseUrl = configManager.baseUrl): string {
    const definition = ENDPOINT_DEFINITIONS[endpoint];
    return definition ? t(definition.i18nKey) : `${t('endpoint_custom')} ${baseUrl.replace(/^https?:\/\//, '')}`;
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

  // 渲染带边框的配置面板卡片（动态宽度，自适应内容）
  renderConfigPanel(items: ConfigPanelItem[]): void {
    if (items.length === 0) return;

    const MIN_INNER_WIDTH = 40;  // 最小内宽，保持美观
    const MAX_INNER_WIDTH = 70;  // 最大内宽，防止面板过宽
    const OVERHEAD = 4;          // 每行固定开销：空格(1) + 圆点(1) + 空格(1) + 标签后空格(1)

    // 动态计算标签列宽度：取所有标签中最大可见宽度
    const labelWidth = Math.max(...items.map(item => stringWidth(item.label)));
    // 动态计算值列宽度：取所有值中最大可见宽度
    const maxValueWidth = Math.max(...items.map(item => stringWidth(item.value)));
    // 计算所需内宽并约束在 [MIN, MAX] 范围内
    const neededWidth = OVERHEAD + labelWidth + maxValueWidth;
    const innerWidth = Math.max(MIN_INNER_WIDTH, Math.min(MAX_INNER_WIDTH, neededWidth));
    // 可用的值列最大宽度（超出时截断）
    const maxAllowedValueWidth = innerWidth - OVERHEAD - labelWidth;

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

      // 值超出可用宽度时截断
      const displayValue = stringWidth(item.value) > maxAllowedValueWidth
        ? truncate(item.value, maxAllowedValueWidth)
        : item.value;
      const val = item.configured
        ? theme.value(displayValue)
        : theme.muted(displayValue);

      // 计算可见宽度来精确对齐右边框
      const valueVisibleWidth = stringWidth(displayValue);
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

  // 渲染模型配置项，未配置时灰显"未设置"
  renderModelConfigItem(label: string, value: string | undefined): void {
    this.renderConfigItem(label, value || chalk.dim(t('model_confirm_not_set')));
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
