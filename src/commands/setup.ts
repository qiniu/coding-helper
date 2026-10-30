import { configManager } from '../lib/config.js';
import { i18n, t } from '../lib/i18n.js';
import { validateApiKey, checkAccountStatus, describeAccountStatus } from '../lib/api-validator.js';
import { toolManager } from '../lib/tool-manager.js';
import { modelService } from '../lib/model-service.js';
import { marketModelService } from '../lib/market-model-service.js';
import { applyTool, exitCodeFor, hasSavedToolModelConfig, type ToolResult } from '../lib/core/tool-service.js';
import type { ITool } from '../lib/tools/base-tool.js';
import { promptHelper } from '../lib/wizard/ui/prompt-helper.js';
import { uiRenderer } from '../lib/wizard/ui/ui-renderer.js';
import { jsonToolResults, renderToolResults } from '../lib/wizard/ui/tool-results.js';
import { withQuietLogs } from '../utils/logger.js';

export interface SetupOptions { tools?: string; yes?: boolean; json?: boolean; keyStdin?: boolean; }

export async function setupCommand(options: SetupOptions): Promise<void> {
  try {
    i18n.init();
    const interactive = !!process.stdin.isTTY && !!process.stdout.isTTY && !options.yes && !options.json && !options.keyStdin;
    let targets: ITool[] = [];
    const skipped: ToolResult[] = [];
    if (options.tools !== undefined) {
      const names = options.tools.split(',').map(name => name.trim()).filter(Boolean);
      if (!names.length) throw new Error('No tool names provided');
      targets = [...new Set(names.map(name => {
        const tool = toolManager.get(name);
        if (!tool) throw new Error(t('auth_unknown_tool', { tool: name }));
        return tool;
      }))];
    } else if (interactive) {
      const names = await promptHelper.checkbox(t('setup_select_tools'), toolManager.getAll().map(tool => ({ name: tool.displayName, value: tool.name })));
      targets = names.map(name => toolManager.get(name)!);
    } else {
      for (const tool of toolManager.getAll()) {
        try {
          const installed = tool.isInstalled();
          if (installed === true) targets.push(tool);
          else skipped.push({ tool, status: 'skipped', reason: installed === null ? 'setup_reason_desktop' : 'setup_reason_not_installed' });
        } catch { skipped.push({ tool, status: 'failed', reason: 'installation_detection_failed' }); }
      }
    }
    let apiKey = configManager.getApiKey();
    if (options.keyStdin) {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of process.stdin) {
        const bytes = Buffer.from(chunk); size += bytes.length;
        if (size > 65536) throw new Error('API key input is too long');
        chunks.push(bytes);
      }
      apiKey = Buffer.concat(chunks).toString('utf8').trim();
      if (!apiKey || /\s/.test(apiKey)) throw new Error('Expected one API key');
      const validation = await validateApiKey(apiKey, configManager.baseUrl);
      if (!validation.valid) throw new Error(validation.error ?? 'Invalid API key');
    }
    if (!apiKey) throw new Error(t('setup_no_key'));
    const account = targets.length ? await checkAccountStatus(apiKey, configManager.baseUrl) : undefined;
    if (account && account.usable !== true && !options.json) uiRenderer.renderWarning(describeAccountStatus(account));
    const results: ToolResult[] = [];
    for (const tool of targets) {
      if (interactive && tool.requiresModelSelection && !tool.launchOnly && !hasSavedToolModelConfig(tool, configManager.getModels())) await tool.runModelConfigFlow();
      const apply = () => applyTool(tool, { apiKey, baseUrl: configManager.baseUrl });
      results.push(await (options.json ? withQuietLogs(apply) : apply()));
    }
    if (options.keyStdin && results.some(result => result.status === 'success')) {
      configManager.setApiKey(apiKey); modelService.clearCache(); marketModelService.clearCache();
    }
    results.push(...skipped);
    const exitCode = exitCodeFor(results);
    if (options.json) console.log(JSON.stringify({ results: jsonToolResults(results), account, exitCode }, null, 2));
    else renderToolResults(results, apiKey);
    process.exitCode = exitCode;
  } catch (error) {
    if (options.json) console.log(JSON.stringify({ error: 'setup_failed', exitCode: 1 }));
    else uiRenderer.renderError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
