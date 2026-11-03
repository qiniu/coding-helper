import { commitWritePlan, confirmAndWrite, selectTargets } from '../ui/write-plan.js';
import { configManager } from '../../config.js';
import { parseContextSize, formatContextSize } from '../../core/context.js';
import { exitCodeFor, getSyncTargets, type ToolResult } from '../../core/tool-service.js';
import { toolManager } from '../../tool-manager.js';
import { t } from '../../i18n.js';
import { promptHelper } from '../ui/prompt-helper.js';
import { uiRenderer } from '../ui/ui-renderer.js';
import { menuPrompt } from '../ui/prompts.js';
import { renderToolResults } from '../ui/tool-results.js';
export const CONTEXT_UNSUPPORTED_TOOLS = ['claude-code', 'hermes', 'copilot'];
export function contextLabel(tokens?: number): string { return tokens ? formatContextSize(tokens) : t('context_auto'); }
export async function runContextFlow(): Promise<void> {
  const candidates = getSyncTargets(toolManager.getAll()).filter(tool => !CONTEXT_UNSUPPORTED_TOOLS.includes(tool.name));
  if (!candidates.length) {
    uiRenderer.renderHint(t('context_no_tools'));
    await promptHelper.pressEnter();
    return;
  }
  let context: number | undefined;
  while (true) {
    const input = await promptHelper.input(t('context_custom_prompt'));
    if (!input.trim()) return;
    try { context = parseContextSize(input); break; }
    catch { uiRenderer.renderError(t('context_invalid', { value: input })); }
  }
  const targets = await selectTargets(t('targets_prompt'), candidates);
  if (!targets?.length) return;
  const plans = targets.map(tool => ({ tool, connection: configManager.getConnection(tool.name), context: context ?? null,
    changes: [{ label: t('plan_context'), before: contextLabel(configManager.getContextWindow(tool.name)), after: contextLabel(context) }] }));
  const safe = plans.filter(plan => plan.tool.supportsPreview === true);
  const normal = plans.filter(plan => plan.tool.supportsPreview !== true);
  const results: ToolResult[] = [];
  if (safe.length) {
    const written = await confirmAndWrite(t('context_title'), safe);
    if (written === 'back') return;
    results.push(...written);
    await promptHelper.pressEnter();
  }
  if (normal.length) {
    uiRenderer.renderPage(t('context_title'));
    uiRenderer.renderHint(t('context_preview_fallback', { tools: normal.map(plan => plan.tool.displayName).join(', ') }));
    const confirmation = await menuPrompt({ message: t('context_targets_hint', { value: contextLabel(context) }), escape: true, default: false,
      items: [{ value: false, label: t('confirm_no') }, { value: true, label: t('confirm_yes') }] });
    if (confirmation.action === 'escape' || !confirmation.value) return;
    const written = await commitWritePlan(normal);
    results.push(...written);
    renderToolResults(written);
    process.exitCode = exitCodeFor(results);
    await promptHelper.pressEnter();
  }
}

export function contextMenuHint(connected: string[]): string {
  const values = [...new Set(connected.filter(name => !CONTEXT_UNSUPPORTED_TOOLS.includes(name)).map(name => contextLabel(configManager.getContextWindow(name))))];
  return values.length > 1 ? t('context_mixed') : values[0] ?? contextLabel();
}
