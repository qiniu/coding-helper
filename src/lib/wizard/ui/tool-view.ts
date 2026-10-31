import fs from 'node:fs';
import os from 'node:os';
import ora from 'ora';
import path from 'node:path';
import chalk from 'chalk';
import { t } from '../../i18n.js';
import { configManager } from '../../config.js';
import { savedModelFor } from '../../core/model-mapping.js';
import { backupsRoot, type PlannedChange } from '../../core/safe-write.js';
import type { ToolDetection, ToolResult } from '../../core/tool-service.js';
import type { ITool } from '../../tools/base-tool.js';
import { logger } from '../../../utils/logger.js';
import { truncate, visibleWidth } from '../../../utils/string-width.js';
import { spriteColor } from './pixel.js';
import { theme } from './theme.js';
import { uiRenderer } from './ui-renderer.js';
import { safeToolFailureReason } from './tool-results.js';

// 路径里的家目录显示为 ~
export function displayPath(file: string): string {
  // 预演记录的是真实路径，家目录可能经过符号链接
  for (const home of new Set([os.homedir(), realHome()])) {
    if (file === home || file.startsWith(home + path.sep)) return '~' + file.slice(home.length);
  }
  return file;
}

function realHome(): string {
  try { return fs.realpathSync(os.homedir()); } catch { return os.homedir(); }
}

// 工具的小圆点：品牌色只出现在这里；未安装时为灰色空心圆
export function toolIcon(toolName: string, dim = false): string {
  if (dim) return theme.border('○');
  return chalk.level >= 2 ? chalk.hex(spriteColor(toolName))('●') : '●';
}

// 安装状态文本：v1.2.3 / 未安装 / 桌面应用
export function formatInstallState(detection: ToolDetection): string {
  if (detection.installed === null) return theme.subtle(t('tool_badge_desktop'));
  if (!detection.installed) return theme.border(t('tool_badge_not_installed'));
  return theme.value(detection.version ? `v${detection.version.replace(/^v/, '')}` : t('tool_badge_installed'));
}

// 接入状态徽标：● 已接入七牛 / ○ 未接入
export function formatConfiguredBadge(detection: ToolDetection): string {
  return detection.configured
    ? theme.success(`● ${t('tool_badge_configured')}`)
    : theme.border(`○ ${t('tool_badge_not_configured')}`);
}

// 列表用的轻量检测：只查是否安装、是否接入，不运行 --version（启动客户端可能很慢或卡住）
export function quickDetect(tool: ITool): ToolDetection {
  const detection: ToolDetection = { tool, installed: null, version: null, configured: null, errors: [] };
  try { detection.installed = tool.isInstalled(); } catch { detection.errors.push('installation_detection_failed'); }
  try { detection.configured = tool.isConfigured?.() ?? null; } catch { detection.errors.push('configuration_detection_failed'); }
  return detection;
}

// 检测一组工具并按「已安装在前」排序（同组保持注册顺序）；交互检查脚本也用它确定列表顺序
export function detectSorted(tools: ITool[]): ToolDetection[] {
  return tools.map(quickDetect).sort((a, b) => Number(b.installed !== false) - Number(a.installed !== false));
}

// 已接入工具当前使用的模型（未接入时为空）
export function currentToolModel(detection: ToolDetection): string | undefined {
  if (!detection.configured) return undefined;
  return savedModelFor(detection.tool, configManager.getModels()) ?? detection.tool.defaultModel;
}

function statusText(result: ToolResult): string {
  if (result.status === 'success') return theme.success(`✔ ${t('setup_status_success')}`);
  if (result.status === 'skipped') return theme.warning(`– ${t('setup_status_skipped')}`);
  return theme.danger(`✖ ${t('setup_status_failed')}`);
}

// 结果原因：跳过原因是 i18n key；失败原因先脱敏，避免把含旧凭据的解析异常带到终端
function reasonText(result: ToolResult): string {
  if (!result.reason) return '';
  const key = result.status === 'failed' ? safeToolFailureReason(result.reason) : result.reason;
  return t(key, { tool: result.tool.displayName });
}

// 安装状态；null 表示桌面应用，必须保留。只有没有实现安装检测（如测试替身）时才按已安装处理
function installState(tool: ITool): boolean | null {
  if (typeof tool.isInstalled !== 'function') return true;
  try { return tool.isInstalled(); } catch { return true; }
}

function launchHint(tool: ITool): string {
  if (installState(tool) === null) return t('result_restart_app', { tool: tool.displayName });
  return tool.command;
}

// 写入结果：标题 + 圆角结果表（工具 / 结果 / 模型 / 启动）+ 下一步与撤销提示
export function renderResultSummary(results: ToolResult[], options: { undoCommand?: string } = {}): void {
  if (!results.length) return;
  const ok = results.filter(result => result.status === 'success');
  logger.newLine();
  logger.log(`  ${ok.length === results.length
    ? theme.success(`✔ ${t('result_headline_ok', { count: String(ok.length) })}`)
    : theme.warning(`! ${t('result_headline_partial', { ok: String(ok.length), total: String(results.length) })}`)}`);
  logger.newLine();
  const models = configManager.getModels();
  uiRenderer.renderTable(
    [t('setup_col_tool'), t('setup_col_result'), t('result_col_model'), t('result_col_launch')],
    results.map(result => [
      `${toolIcon(result.tool.name)} ${theme.value(result.tool.displayName)}`,
      statusText(result),
      result.status === 'success'
        // 模型原值完整交给表格，放不下时由 renderTable 按字段换行；失败原因在表内截断，完整内容列在表下方
        ? chalk.hex('#8BE9FF')(savedModelFor(result.tool, models) ?? result.tool.defaultModel ?? '—')
        : theme.subtle(truncate(reasonText(result), 32)),
      result.status === 'success' ? theme.brand(launchHint(result.tool)) : '',
    ]),
  );
  // 表格里截断的失败原因完整列在下方
  for (const result of results.filter(item => item.status !== 'success' && visibleWidth(reasonText(item)) > 32)) {
    logger.log(`  ${result.status === 'failed' ? theme.danger('✖') : theme.warning('–')} ${theme.value(result.tool.displayName)}  ${theme.subtle(reasonText(result))}`);
  }
  logger.newLine();
  if (ok.length) {
    const commands = ok.filter(result => installState(result.tool) !== null).map(result => theme.value(launchHint(result.tool)));
    if (commands.length) logger.log(`  ${theme.brandBold(t('result_next'))}  ${t('result_next_launch', { commands: commands.join(theme.subtle(' / ')) })}`);
    logger.log(`  ${theme.subtle(t('result_undo'))}  ${theme.value(options.undoCommand ?? 'npx qiniu-coding-helper restore')}`);
    logger.log(`  ${theme.subtle(t('result_backup_dir', { path: displayPath(backupsRoot()) }))}`);
    logger.newLine();
  }
}

// 写入某个工具时的临时进度行（⠋ 正在写入 X…）；完成后清除，结果统一在结果表里展示
export async function withProgress<T>(tool: ITool, operation: () => Promise<T>): Promise<T> {
  const spinner = ora({ text: t('setup_applying', { tool: tool.displayName }), color: 'cyan', indent: 2 }).start();
  try {
    return await operation();
  } finally {
    spinner.stop();
  }
}

// 改动文件列表：只显示动作、路径和行数，不输出文件正文（可能含旧 Key 或其他供应商凭据）
export function renderFileChanges(changes: PlannedChange[]): void {
  if (!changes.length) {
    uiRenderer.renderHint(t('plan_files_empty'));
    return;
  }
  const lines = (text: string | undefined): number => text === undefined ? 0 : text.split('\n').length;
  for (const change of changes) {
    const [label, color] = change.after === undefined
      ? [t('dry_run_delete'), theme.danger]
      : change.before === undefined ? [t('dry_run_create'), theme.success] : [t('dry_run_modify'), theme.warning];
    const count = t('plan_files_lines', { before: String(lines(change.before)), after: String(lines(change.after)) });
    logger.log(`    ${color(label)}  ${theme.value(displayPath(change.file))}  ${theme.subtle(count)}`);
  }
  logger.newLine();
}
