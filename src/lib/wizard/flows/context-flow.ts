import { configManager } from '../../config.js';
import { parseContextSize, formatContextSize } from '../../core/context.js';
import { applyTool, exitCodeFor, getSyncTargets } from '../../core/tool-service.js';
import { toolManager } from '../../tool-manager.js';
import { t } from '../../i18n.js';
import { promptHelper } from '../ui/prompt-helper.js';
import { uiRenderer } from '../ui/ui-renderer.js';
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
  const names = await promptHelper.checkbox(t('targets_prompt'), candidates.map(tool => ({ name: tool.displayName, value: tool.name })));
  if (!names.length || !await promptHelper.confirm(t('context_targets_hint', { value: contextLabel(context) }), false)) return;
  const results = await configManager.withContextWindows(Object.fromEntries(names.map(name => [name, context ?? 0])), async () => {
    const results = [];
    for (const tool of candidates.filter(tool => names.includes(tool.name))) results.push(await applyTool(tool));
    return results;
  });
  const successful = results.filter(result => result.status === 'success').map(result => result.tool.name);
  if (successful.length) configManager.setContextWindow(context, successful);
  renderToolResults(results, configManager.getApiKey());
  process.exitCode = exitCodeFor(results);
}
