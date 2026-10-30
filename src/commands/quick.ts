import { configManager } from '../lib/config.js';
import { i18n, t } from '../lib/i18n.js';
import { DEFAULT_ENDPOINT, ENDPOINT_DEFINITIONS, getBaseUrl, otherEndpoint } from '../lib/endpoints.js';
import { validateApiKey, checkAccountStatus, describeAccountStatus } from '../lib/api-validator.js';
import { toolManager } from '../lib/tool-manager.js';
import { modelService } from '../lib/model-service.js';
import { marketModelService } from '../lib/market-model-service.js';
import { parseQuickArgs, pickApiKey, pickModel } from '../lib/core/quick-args.js';
import { modelConfigFor, savedModelFor } from '../lib/core/model-mapping.js';
import { applyTool, type ToolResult } from '../lib/core/tool-service.js';
import { promptHelper } from '../lib/wizard/ui/prompt-helper.js';
import { uiRenderer } from '../lib/wizard/ui/ui-renderer.js';
import { jsonToolResults, renderToolResults } from '../lib/wizard/ui/tool-results.js';
import { withQuietLogs } from '../utils/logger.js';

export interface QuickOptions { intl?: boolean; json?: boolean; key?: string; model?: string; }

export async function quickCommand(target: string, rest: string[], options: QuickOptions): Promise<void> {
  let initialized = false;
  try {
    i18n.init(); initialized = true;
    const args = parseQuickArgs(target, rest, { apiKey: options.key, model: options.model });
    if (args.tools === 'all' || args.tools.length !== 1) throw new Error('Specify one tool');
    const tool = toolManager.get(args.tools[0]);
    if (!tool) throw new Error('Unknown tool');
    let picked = pickApiKey(args, process.env, configManager.getApiKey());
    if (!picked && !options.json && process.stdin.isTTY && process.stdout.isTTY) {
      const key = (await promptHelper.password(t('apikey_prompt'))).trim();
      if (key) picked = { key, source: 'prompt' };
    }
    if (!picked) throw new Error('API key missing');
    const apiKey = picked.key;
    let endpoint = options.intl ? 'international' : configManager.getEndpoint();
    if (!Object.hasOwn(ENDPOINT_DEFINITIONS, endpoint)) endpoint = DEFAULT_ENDPOINT;
    let validation = await validateApiKey(apiKey, getBaseUrl(endpoint));
    if (!validation.valid && validation.error === 'Invalid API Key') {
      const alternate = otherEndpoint(endpoint);
      const retry = await validateApiKey(apiKey, getBaseUrl(alternate));
      if (retry.valid) { endpoint = alternate; validation = retry; }
    }
    if (!validation.valid) throw new Error('API key validation failed');
    const baseUrl = getBaseUrl(endpoint);
    const account = await checkAccountStatus(apiKey, baseUrl);
    if (account.usable === false) throw new Error(describeAccountStatus(account));
    const available = (await modelService.fetchModels(baseUrl, apiKey)).map(model => model.id);
    let capable: Set<string> | undefined;
    try {
      const market = await marketModelService.fetchModels(baseUrl, apiKey);
      if (market.length) capable = new Set(market.filter(model => model.features?.includes('工具调用') || model.architecture?.function_calling?.supported).map(model => model.id));
    } catch { /* 元数据不可用时仅校验模型存在性及适配器协议。 */ }
    const saved = savedModelFor(tool, configManager.getModels());
    const pick = pickModel(args.model, saved, available, capable);
    let model: string | undefined;
    if (args.model) {
      if ('model' in pick) model = pick.model;
      else if (pick.error === 'not_available' && tool.checkModel) model = args.model;
      if (!model) throw new Error('Requested model is unavailable or does not support tool calling');
      if (await tool.checkModel?.(model, { apiKey, baseUrl })) throw new Error('Model protocol is incompatible');
    } else {
      const candidates = tool.checkModel ? [saved, tool.defaultModel, 'model' in pick ? pick.model : undefined] : ['model' in pick ? pick.model : undefined];
      for (const candidate of [...new Set(candidates.filter((value): value is string => !!value))]) {
        if (!await tool.checkModel?.(candidate, { apiKey, baseUrl })) { model = candidate; break; }
      }
      if (!model) throw new Error('No compatible model is available');
    }
    const models = modelConfigFor(tool, model);
    const apply = (): Promise<ToolResult> => tool.launchOnly ? Promise.resolve({ tool, status: 'success' }) : applyTool(tool, { apiKey, baseUrl, models });
    const result = await (options.json ? withQuietLogs(apply) : apply());
    let helperSaved = false, saveFailed = false;
    if (result.status === 'success') {
      try {
        configManager.saveSettings(apiKey, endpoint, models);
        modelService.clearCache(); marketModelService.clearCache(); helperSaved = true;
      } catch { saveFailed = true; }
    }
    const exitCode = result.status === 'success' && !saveFailed ? 0 : 1;
    if (options.json) console.log(JSON.stringify({ keySource: picked.source, endpoint, model, results: jsonToolResults([result]), helperSaved, ...(saveFailed ? { error: 'helper_settings_failed' } : {}), exitCode }, null, 2));
    else {
      renderToolResults([result], apiKey);
      if (saveFailed) uiRenderer.renderError(t('quick_save_failed'));
      if (result.status === 'success' && !saveFailed) uiRenderer.renderHint(`${t('quick_start')}: ${tool.launchOnly ? `coding-helper run ${tool.name}` : tool.command}`);
    }
    process.exitCode = exitCode;
  } catch {
    if (options.json) console.log(JSON.stringify({ error: 'quick_configuration_failed', exitCode: 1 }));
    else { if (!initialized) i18n.init('en_US'); uiRenderer.renderError(t('quick_failed')); }
    process.exitCode = 1;
  }
}
