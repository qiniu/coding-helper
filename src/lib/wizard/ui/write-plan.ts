import ora from 'ora';
import chalk from 'chalk';
import { configManager } from '../../config.js';
import type { PlanItem, PlanChange } from '../../core/write-plan.js';
export type { PlanItem, PlanChange } from '../../core/write-plan.js';
import { applyTool, exitCodeFor, type ToolResult } from '../../core/tool-service.js';
import { previewWrites, type PlannedChange } from '../../core/safe-write.js';
import type { ITool } from '../../tools/base-tool.js';
import { t } from '../../i18n.js';
import { logger, withQuietLogs } from '../../../utils/logger.js';
import { padVisible, stripAnsi, truncate, visibleWidth } from '../../../utils/string-width.js';
import { uiRenderer, type StepInfo } from './ui-renderer.js';
import { checkPrompt, menuPrompt, type MenuEntry } from './prompts.js';
import { renderToolResults, safeToolFailureReason } from './tool-results.js';
import { theme } from './theme.js';
import { isExternallyModified } from '../../core/rebaseline.js';
import { detectSorted, displayPath, formatConfiguredBadge, formatInstallState, renderFileChanges, renderResultSummary, toolIcon } from './tool-view.js';

// 勾选要处理的工具：左侧色点，右侧为 detail（如当前模型）或安装 / 接入状态；已安装的排在前面
// installable：未安装的工具标出「回车安装」；在该行直接回车时通过 onInstall 告知调用方进入安装页
export async function selectTargets(message: string, tools: ITool[], options: { preselect?: string[]; detail?: (tool: ITool) => string; allowEmpty?: boolean; nextLabel?: string; installable?: boolean; default?: string; onEnter?: (tool: ITool) => void } = {}): Promise<ITool[] | undefined> {
  if (!tools.length) return [];
  const detections = detectSorted(tools);
  const width = Math.max(...tools.map(tool => visibleWidth(tool.displayName)));
  const selected = await checkPrompt({ message, allowEmpty: options.allowEmpty, nextLabel: options.nextLabel, default: options.default,
    onEnterSingle: value => { const tool = tools.find(candidate => candidate.name === value); if (tool) options.onEnter?.(tool); },
    items: detections.map(detection => {
      const { tool } = detection;
      const tag = options.detail?.(tool) ?? `${padVisible(formatInstallState(detection), 10)}  ${detection.configured || isExternallyModified(tool) ? formatConfiguredBadge(detection) : ''}`;
      return { value: tool.name, label: padVisible(tool.displayName, width), icon: toolIcon(tool.name, detection.installed === false), tag,
        checked: options.preselect?.includes(tool.name) ?? false, preferred: true,
        ...(options.installable && detection.installed === false && tool.installCommand
          ? { enterLabel: t('install_action'), description: theme.subtle(`${t('tool_detail_install_enter')}  ${tool.installCommand}`) } : {}) };
    }),
    summary: picked => picked.length
      ? theme.value(t('targets_summary', { count: String(picked.length), total: String(tools.length) }))
      : theme.subtle(t('targets_none')),
  });
  return selected === undefined ? undefined : detections.map(detection => detection.tool).filter(tool => selected.includes(tool.name));
}
// 外部已切到其他服务的工具：写入时自动以当前配置为还原基线（applyTool 处理），确认页多显示一行说明
function withBaselineRow(item: PlanItem): PlanItem {
  const label = t('plan_rebaseline');
  if (!isExternallyModified(item.tool) || item.changes.some(change => change.label === label)) return item;
  // 放在最后：收起时摘要仍显示模型变化
  return { ...item, changes: [...item.changes, { label, before: t('plan_rebaseline_before'), after: t('plan_rebaseline_after') }] };
}
function prepare(items: PlanItem[]): PlanItem[] {
  return items.map(item => ({ ...item, connection: { ...(item.connection ?? configManager.getConnection(item.tool.name)) },
    models: item.models ? structuredClone(item.models) : undefined }));
}
async function validate(items: PlanItem[]): Promise<ToolResult[]> {
  const failures: ToolResult[] = [];
  for (const item of items) {
    if (!item.connection?.apiKey) { failures.push({ tool: item.tool, status: 'failed', reason: 'apikey_not_set' }); continue; }
    if (item.context !== undefined && item.context !== null && (!Number.isSafeInteger(item.context) || item.context < 1000)) { failures.push({ tool: item.tool, status: 'failed', reason: 'context_invalid' }); continue; }
    try {
      const models = [...new Set([item.main, ...Object.values(item.overrides ?? {})].filter((model): model is string => !!model))];
      for (const model of models) if (await item.tool.checkModel?.(model, { apiKey: item.connection.apiKey, baseUrl: item.connection.baseUrl })) throw new Error();
    } catch { failures.push({ tool: item.tool, status: 'failed', reason: 'plan_validation_failed' }); }
  }
  return failures.length ? items.map(item => failures.find(result => result.tool === item.tool) ?? { tool: item.tool, status: 'skipped', reason: 'plan_validation_cancelled' }) : [];
}
async function apply(items: PlanItem[], persist: boolean, progress?: (item: PlanItem, result?: ToolResult) => void): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  for (const item of items) {
    progress?.(item);
    const context = item.context === undefined ? {} : { [item.tool.name]: item.context ?? 0 };
    const result = await configManager.withContextWindows(context, () => withQuietLogs(() => applyTool(item.tool, { apiKey: item.connection!.apiKey!, baseUrl: item.connection!.baseUrl, models: item.models ?? configManager.getModels() })));
    if (result.status === 'failed') result.reason = safeToolFailureReason(result.reason, 'plan_write_failed');
    if (persist && result.status === 'success') {
      try { configManager.saveToolSettings(item.models ?? {}, context, item.main); }
      catch { result.status = 'failed'; result.reason = 'helper_settings_failed'; }
    }
    progress?.(item, result);
    results.push(result);
  }
  return results;
}
export async function previewWritePlan(items: PlanItem[]) {
  const prepared = prepare(items); const failed = await validate(prepared);
  if (failed.length) return { value: failed, changes: [] };
  return previewWrites(() => apply(prepared, false));
}
export async function commitWritePlan(items: PlanItem[], progress?: (item: PlanItem, result?: ToolResult) => void): Promise<ToolResult[]> {
  const prepared = prepare(items); const failed = await validate(prepared);
  return failed.length ? failed : apply(prepared, true, progress);
}

// 逐个工具预演，得到每个工具会改的文件（确认页展开时显示）
async function previewByTool(items: PlanItem[]): Promise<{ results: ToolResult[]; files: Map<ITool, PlannedChange[]> }> {
  const failed = await validate(items);
  const files = new Map<ITool, PlannedChange[]>();
  if (failed.length) return { results: failed, files };
  const results: ToolResult[] = [];
  for (const item of items) {
    const preview = await previewWrites(() => apply([item], false));
    results.push(...preview.value);
    files.set(item.tool, preview.changes);
  }
  return { results, files };
}

// 写入时逐个工具显示临时进度（⠋ 正在写入 X…），写完清除，只保留结果表
function spinnerProgress(): (item: PlanItem, result?: ToolResult) => void {
  let spinner: ReturnType<typeof ora> | undefined;
  return (item, result) => {
    if (!result) spinner = ora({ text: t('setup_applying', { tool: item.tool.displayName }), color: 'cyan', indent: 2 }).start();
    else spinner?.stop();
  };
}

// 一项改动的显示：原值 → 新值 · 附注
function changeText(change: PlanChange): string {
  const after = chalk.hex('#8BE9FF')(change.after);
  const value = change.before && change.before !== change.after ? `${theme.subtle(change.before)} ${theme.subtle('→')} ${after}` : after;
  const note = change.note ?? (change.before === change.after ? t('plan_unchanged') : '');
  return note ? `${value}  ${theme.subtle(note)}` : value;
}

// 收起时一行的摘要：第一项的变化，以及其余几项的情况
function itemSummary(item: PlanItem): string {
  const [first, ...rest] = item.changes;
  if (!first) return '';
  const following = rest.filter(change => change.note === t('slot_following')).length;
  const own = rest.filter(change => change.note === t('slot_kept') || change.note === t('slot_custom')).length;
  const others = rest.length - following - own;
  const extra = [
    following ? t('plan_more_following', { count: String(following) }) : '',
    own ? t('plan_more_own', { count: String(own) }) : '',
    others > 0 ? t('plan_more_changes', { count: String(others) }) : '',
  ].filter(Boolean).join(' · ');
  return `${changeText(first)}${extra ? theme.subtle(`  ${extra}`) : ''}`;
}

function changedFiles(item: PlanItem, files: Map<ITool, PlannedChange[]>, failed = false): string[] {
  // 预演未通过时还不知道会改哪些文件，不能显示「没有需要修改的文件」
  if (failed) return [t('plan_files_preview_failed')];
  const changed = files.get(item.tool);
  return changed?.length ? changed.map(change => displayPath(change.file)) : [t('plan_files_none')];
}

// 右侧值超出终端宽度时整行截断（否则菜单会隐藏所有右侧值）
function fit(text: string, width: number): string {
  return visibleWidth(text) <= width ? text : theme.subtle(truncate(stripAnsi(text), width));
}

const WRITE = '__write__';
const FILES = '__files__';
const BACK = '__back__';

// 确认页：每个工具一行，→ 展开查看每一项和会改的文件，← 收起；有 edit 时回车调整该工具，否则回车展开 / 收起。
// 只有预演通过才能写入；写入时逐个显示进度，最后显示结果表。Esc 返回 'back'
export async function confirmAndWrite(title: string, initial: PlanItem[], untouched: ITool[] = [], options: { step?: StepInfo; edit?: (item: PlanItem) => Promise<PlanItem | undefined> } = {}): Promise<ToolResult[] | 'back'> {
  if (!initial.length) return 'back';
  let items = prepare(initial).map(withBaselineRow);
  const expanded = new Set<string>(items.length === 1 ? [items[0].tool.name] : []);
  let preview = await previewByTool(items);
  let last = BACK;
  while (true) {
    const invalid = preview.results.some(result => result.status === 'failed');
    uiRenderer.renderPage(title, options.step, t('plan_subtitle', { count: String(items.length) }));
    // 预演失败仍允许调整计划；只有有效预演才能提交真实写入。
    if (invalid) {
      renderToolResults(preview.results, undefined, true);
      uiRenderer.renderHint(t('plan_invalid_hint'));
      logger.newLine();
    }
    const nameWidth = Math.max(...items.map(item => visibleWidth(item.tool.displayName)));
    const entries: MenuEntry<string>[] = [];
    for (const item of items) {
      const open = expanded.has(item.tool.name);
      entries.push({ value: 'tool:' + item.tool.name, icon: toolIcon(item.tool.name),
        label: `${padVisible(item.tool.displayName, nameWidth)} ${theme.subtle(open ? '▾' : '▸')}`,
        hint: open ? '' : itemSummary(item),
        description: theme.subtle(options.edit ? t('plan_row_hint_edit') : t('plan_row_hint')) });
      if (!open) continue;
      const rows: [string, string][] = item.changes.map(change => [change.label, changeText(change)]);
      changedFiles(item, preview.files, preview.results.some(result => result.tool === item.tool && result.status === 'failed')).forEach((file, i) => rows.push([i === 0 ? t('plan_file') : '', theme.subtle(file)]));
      rows.forEach(([label, value], i) => entries.push({ value: `row:${item.tool.name}:${i}`, label: `   ${theme.subtle(label)}`, hint: value, disabled: true }));
    }
    const fileCount = [...preview.files.values()].reduce((sum, changes) => sum + changes.length, 0);
    entries.push({ separator: '' },
      { value: WRITE, label: theme.brandBold(t('plan_write', { count: String(items.length) })), disabled: invalid },
      { value: FILES, label: t('plan_view_changes'), hint: invalid ? '' : theme.subtle(t('plan_files_count', { count: String(fileCount) })), description: theme.subtle(t('plan_view_changes_hint', { count: String(fileCount) })) },
      { value: BACK, label: t('tool_back') });
    // 前缀 4 列 + 图标 2 列 + 标签 + 4 列间距 + 2 列留白；放不下的右侧值单独截断
    const columns = Math.min(process.stdout.columns || 100, 140);
    const labelWidth = Math.max(...entries.map(entry => 'label' in entry ? visibleWidth(entry.label) : 0));
    const hintWidth = columns - 12 - labelWidth;
    if (hintWidth >= 12) {
      for (const entry of entries) if ('hint' in entry && entry.hint) entry.hint = fit(entry.hint, hintWidth);
    } else {
      // 窄终端放不下右侧一列：明细行的值改放在标签下一行，其余右侧值省略，保证确认前能看到每一项
      const narrow: MenuEntry<string>[] = [];
      for (const entry of entries) {
        if (!('label' in entry) || !entry.hint) { narrow.push(entry); continue; }
        if (!entry.disabled) { narrow.push({ ...entry, hint: '' }); continue; }
        if (stripAnsi(entry.label).trim()) narrow.push({ ...entry, hint: '' });
        narrow.push({ value: entry.value + ':value', label: '     ' + fit(entry.hint, Math.max(8, columns - 12)), disabled: true });
      }
      entries.splice(0, entries.length, ...narrow);
    }
    if (untouched.length) uiRenderer.renderHint(t('plan_untouched', { tools: untouched.map(tool => tool.displayName).join(', ') }));
    const { value, action } = await menuPrompt({ message: t('plan_prompt'), escape: true, arrows: true, default: last, pageSize: 20, items: entries });
    if (action === 'escape' || value === BACK) return 'back';
    last = value;
    const selected = items.find(item => 'tool:' + item.tool.name === value);
    if (selected && (action === 'right' || action === 'left')) {
      if (action === 'right') expanded.add(selected.tool.name); else expanded.delete(selected.tool.name);
      continue;
    }
    if (action === 'right' || action === 'left') continue;
    if (value === FILES) {
      uiRenderer.renderPage(t('plan_files_title'), options.step);
      for (const item of items) {
        logger.log(`  ${toolIcon(item.tool.name)} ${theme.heading(item.tool.displayName)}`);
        renderFileChanges(preview.files.get(item.tool) ?? []);
      }
      await menuPrompt({ message: t('plan_view_changes'), escape: true, items: [{ value: 'back', label: t('tool_back') }] });
      continue;
    }
    if (selected) {
      if (!options.edit) {
        if (expanded.has(selected.tool.name)) expanded.delete(selected.tool.name); else expanded.add(selected.tool.name);
        continue;
      }
      // 调整后光标回到「返回」，与首次进入一致，避免误触写入
      last = BACK;
      const edited = await options.edit(selected);
      if (edited) { items = items.map(item => item === selected ? withBaselineRow({ ...edited, connection: selected.connection }) : item); preview = await previewByTool(items); }
      continue;
    }
    if (value !== WRITE || invalid) continue;
    uiRenderer.renderPage(title, options.step);
    const results = await commitWritePlan(items, spinnerProgress());
    renderResultSummary(results);
    process.exitCode = exitCodeFor(results);
    return results;
  }
}
