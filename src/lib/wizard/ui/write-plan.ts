import { configManager } from '../../config.js';
import type { PlanItem } from '../../core/write-plan.js';
export type { PlanItem, PlanChange } from '../../core/write-plan.js';
import { applyTool, exitCodeFor, type ToolResult } from '../../core/tool-service.js';
import { previewWrites, publicPlannedChanges } from '../../core/safe-write.js';
import type { ITool } from '../../tools/base-tool.js';
import { t } from '../../i18n.js';
import { withQuietLogs } from '../../../utils/logger.js';
import { uiRenderer, type StepInfo } from './ui-renderer.js';
import { checkPrompt, menuPrompt } from './prompts.js';
import { renderToolResults, safeToolFailureReason } from './tool-results.js';

export async function selectTargets(message: string, tools: ITool[], options: { preselect?: string[]; detail?: (tool: ITool) => string; allowEmpty?: boolean; nextLabel?: string } = {}): Promise<ITool[] | undefined> {
  if (!tools.length) return [];
  const selected = await checkPrompt({ message, allowEmpty: options.allowEmpty, nextLabel: options.nextLabel,
    items: tools.map(tool => ({ value: tool.name, label: tool.displayName, tag: options.detail?.(tool), checked: options.preselect?.includes(tool.name) ?? false, preferred: true })) });
  return selected === undefined ? undefined : tools.filter(tool => selected.includes(tool.name));
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
async function apply(items: PlanItem[], persist: boolean): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  for (const item of items) {
    const context = item.context === undefined ? {} : { [item.tool.name]: item.context ?? 0 };
    const result = await configManager.withContextWindows(context, () => withQuietLogs(() => applyTool(item.tool, { apiKey: item.connection!.apiKey!, baseUrl: item.connection!.baseUrl, models: item.models ?? configManager.getModels() })));
    if (result.status === 'failed') result.reason = safeToolFailureReason(result.reason, 'plan_write_failed');
    if (persist && result.status === 'success') {
      try { configManager.saveToolSettings(item.models ?? {}, context, item.main); }
      catch { result.status = 'failed'; result.reason = 'helper_settings_failed'; }
    }
    results.push(result);
  }
  return results;
}
export async function previewWritePlan(items: PlanItem[]) {
  const prepared = prepare(items); const failed = await validate(prepared);
  if (failed.length) return { value: failed, changes: [] };
  return previewWrites(() => apply(prepared, false));
}
export async function commitWritePlan(items: PlanItem[]): Promise<ToolResult[]> {
  const prepared = prepare(items); const failed = await validate(prepared);
  return failed.length ? failed : apply(prepared, true);
}
export async function confirmAndWrite(title: string, initial: PlanItem[], untouched: ITool[] = [], options: { step?: StepInfo; edit?: (item: PlanItem) => Promise<PlanItem | undefined> } = {}): Promise<ToolResult[] | 'back'> {
  if (!initial.length) return 'back';
  let items = prepare(initial);
  while (true) {
    const preview = await previewWritePlan(items);
    const invalid = preview.value.some(result => result.status === 'failed');
    uiRenderer.renderPage(title, options.step);
    // 预演失败仍允许调整计划；只有有效预演才能提交真实写入。
    if (invalid) renderToolResults(preview.value, undefined, true);
    for (const item of items) {
      if (!item.changes.length) uiRenderer.renderHint(item.tool.displayName);
      for (const change of item.changes) uiRenderer.renderConfigItem(`${item.tool.displayName} · ${change.label}`, `${change.before ?? '—'} → ${change.after}${change.note ? ' · ' + change.note : ''}`);
    }
    if (untouched.length) uiRenderer.renderHint(t('plan_untouched', { tools: untouched.map(tool => tool.displayName).join(', ') }));
    const { value, action } = await menuPrompt({ message: t('plan_prompt'), escape: true, default: 'back', items: [
      ...(options.edit ? [...items.map(item => ({ value: 'tool:' + item.tool.name, label: item.tool.displayName, hint: t('slots_done') })), { separator: '' }] : []),
      { value: 'write', label: t('plan_write', { count: String(items.length) }), disabled: invalid }, { value: 'files', label: t('plan_view_changes') }, { value: 'back', label: t('tool_back') },
    ] });
    if (action === 'escape' || value === 'back') return 'back';
    if (value === 'files') {
      for (const change of publicPlannedChanges(preview.changes)) console.log(JSON.stringify(change));
      await menuPrompt({ message: t('plan_view_changes'), escape: true, items: [{ value: 'back', label: t('tool_back') }] }); continue;
    }
    const selected = items.find(item => 'tool:' + item.tool.name === value);
    if (selected) {
      const edited = await options.edit?.(selected); if (edited) items = items.map(item => item === selected ? { ...edited, connection: selected.connection } : item); continue;
    }
    if (value !== 'write' || invalid) continue;
    const results = await commitWritePlan(items); renderToolResults(results); process.exitCode = exitCodeFor(results); return results;
  }
}
