import { parseContextSize } from '../lib/core/context.js';
import { configManager, type ModelConfig } from '../lib/config.js';
import { i18n, t } from '../lib/i18n.js';
import { CUSTOM_ENDPOINT, DEFAULT_ENDPOINT, ENDPOINT_DEFINITIONS, getBaseUrl, otherEndpoint } from '../lib/endpoints.js';
import { validateApiKey, checkAccountStatus, describeAccountStatus } from '../lib/api-validator.js';
import { toolManager } from '../lib/tool-manager.js';
import { modelService } from '../lib/model-service.js';
import { marketModelService } from '../lib/market-model-service.js';
import { parseQuickArgs, pickApiKey, pickModel } from '../lib/core/quick-args.js';
import { modelConfigFor, savedModelFor, mergeModelConfigs } from '../lib/core/model-mapping.js';
import { applyTool, exitCodeFor, type ToolResult } from '../lib/core/tool-service.js';
import { previewWrites, publicPlannedChanges } from '../lib/core/safe-write.js';
import type { ITool } from '../lib/tools/base-tool.js';
import { promptHelper } from '../lib/wizard/ui/prompt-helper.js';
import { uiRenderer } from '../lib/wizard/ui/ui-renderer.js';
import { jsonToolResults, renderToolResults } from '../lib/wizard/ui/tool-results.js';
import { withQuietLogs } from '../utils/logger.js';

export interface QuickOptions { intl?: boolean; json?: boolean; dryRun?: boolean; save?: boolean; key?: string; model?: string; context?: string; }

class QuickError extends Error {
  constructor(public readonly code: string, public readonly suggestions: string[] = []) { super(code); }
}

export async function quickCommand(target: string, rest: string[], options: QuickOptions): Promise<void> {
  let initialized = false;
  try {
    i18n.init(); initialized = true;
    const args = parseQuickArgs(target, rest, { apiKey: options.key, model: options.model });
    const tools = args.tools === 'all' ? toolManager.getAll().filter(tool => tool.isInstalled() === true)
      : [...new Set(args.tools.map(name => {
        const tool = toolManager.get(name);
        if (!tool) throw new QuickError('unknown_tool');
        return tool;
      }))];
    if (!tools.length) throw new QuickError('no_installed_tools');
    let context: number | undefined;
    if (options.context !== undefined) {
      try { context = parseContextSize(options.context) ?? 0; }
      catch { throw new QuickError('context_invalid', ['96k', '200000', 'auto']); }
    }
    if (context !== undefined && tools.some(tool => ['claude-code', 'hermes', 'copilot'].includes(tool.name))) throw new QuickError('context_unsupported');
    const profile = args.profile ? configManager.getProfile(args.profile) : undefined;
    if (args.profile && !profile) throw new QuickError('profile_not_found');
    if (profile && !profile.apiKey) throw new QuickError('key_missing');
    if (profile && (args.apiKey || process.env.QINIU_API_KEY || options.intl)) throw new QuickError('profile_connection_conflict');
    let picked = pickApiKey(args, profile ? {} : process.env, profile?.apiKey ?? configManager.getApiKey());
    if (!picked && !options.json && process.stdin.isTTY && process.stdout.isTTY) {
      const key = (await promptHelper.password(t('apikey_prompt'))).trim();
      if (key) picked = { key, source: 'prompt' };
    }
    if (!picked) throw new QuickError('key_missing');
    const apiKey = picked.key;
    let endpoint = profile?.endpoint ?? (options.intl ? 'international' : configManager.getEndpoint());
    if (endpoint !== CUSTOM_ENDPOINT && !Object.hasOwn(ENDPOINT_DEFINITIONS, endpoint)) endpoint = DEFAULT_ENDPOINT;
    const customUrl = endpoint === CUSTOM_ENDPOINT ? profile?.baseUrl ?? configManager.baseUrl : undefined;
    let validation = await validateApiKey(apiKey, getBaseUrl(endpoint, customUrl));
    if (!profile && endpoint !== CUSTOM_ENDPOINT && !validation.valid && validation.error === 'Invalid API Key') {
      const alternate = otherEndpoint(endpoint);
      const retry = await validateApiKey(apiKey, getBaseUrl(alternate));
      if (retry.valid) { endpoint = alternate; validation = retry; }
    }
    if (!validation.valid) throw new QuickError('key_invalid');
    const baseUrl = getBaseUrl(endpoint, customUrl);
    const available = (await modelService.fetchModels(baseUrl, apiKey)).map(model => model.id);
    let capable: Set<string> | undefined;
    try {
      const market = await marketModelService.fetchModels(baseUrl, apiKey);
      if (market.length) capable = new Set(market.filter(model => model.features?.includes('工具调用') || model.architecture?.function_calling?.supported).map(model => model.id));
    } catch { /* 元数据不可用时仅校验模型存在性及适配器协议。 */ }
    const savedModels = configManager.getModels();
    const requested = pickModel(args.model, undefined, available, capable);
    if (args.model && 'error' in requested && !(requested.error === 'not_available' && tools.every(tool => !!tool.checkModel))) {
      throw new QuickError('model_unavailable', requested.suggestions);
    }
    const results: ToolResult[] = [];
    const plans: { tool: ITool; model: string; models: ModelConfig }[] = [];
    // 所有模型计划先完成校验，随后才进行任何客户端写入。
    for (const tool of tools) {
      if (tool.launchOnly && options.save === false) { results.push({ tool, status: 'skipped', reason: 'quick_launch_only_no_save' }); continue; }
      const saved = savedModelFor(tool, savedModels);
      const pick = pickModel(args.model, saved, available, capable);
      const candidates = args.model ? ['model' in requested ? requested.model : args.model]
        : tool.checkModel ? [saved && (!available.includes(saved) || capable === undefined || capable.has(saved)) ? saved : undefined, tool.defaultModel, 'model' in pick ? pick.model : undefined]
        : ['model' in pick ? pick.model : undefined];
      let model: string | undefined;
      for (const candidate of [...new Set(candidates.filter((value): value is string => !!value))]) {
        if (!await tool.checkModel?.(candidate, { apiKey, baseUrl })) { model = candidate; break; }
      }
      if (!model) { results.push({ tool, status: 'skipped', reason: 'quick_model_incompatible' }); continue; }
      plans.push({ tool, model, models: { ...modelConfigFor(tool, model, savedModels), slotModels: savedModels.slotModels } });
    }
    const account = await checkAccountStatus(apiKey, baseUrl, plans.map(plan => plan.model));
    if (account.usable === false) throw new Error(describeAccountStatus(account));
    const perform = async (): Promise<ToolResult[]> => {
      const applied: ToolResult[] = [];
      for (const { tool, models } of plans) {
        const apply = async (): Promise<ToolResult> => {
          if (tool.launchOnly) return { tool, status: 'success' };
          return applyTool(tool, { apiKey, baseUrl, models });
        };
        applied.push(await (options.json || options.dryRun ? withQuietLogs(apply) : apply()));
      }
      return applied;
    };
    const contexts = context === undefined ? {} : Object.fromEntries(tools.map(tool => [tool.name, context]));
    const scopedPerform = () => configManager.withContextWindows(contexts, perform);
    const planned = options.dryRun ? await previewWrites(scopedPerform) : { value: await scopedPerform(), changes: [] };
    results.push(...planned.value);
    results.sort((a, b) => tools.indexOf(a.tool) - tools.indexOf(b.tool));
    const successful = plans.filter(plan => results.some(result => result.tool === plan.tool && result.status === 'success'));
    let helperSaved = false, saveFailed = false;
    if (successful.length && !options.dryRun && options.save !== false) {
      try {
        configManager.saveSettings(apiKey, endpoint, mergeModelConfigs(...successful.map(plan => plan.models)), { toolNames: successful.map(plan => plan.tool.name), profile: profile?.name, baseUrl, contexts: context === undefined ? undefined : Object.fromEntries(successful.map(plan => [plan.tool.name, context])) });
        modelService.clearCache(); marketModelService.clearCache(); helperSaved = true;
      } catch { saveFailed = true; }
    }
    const exitCode = saveFailed || !successful.length ? 1 : exitCodeFor(results);
    const model = tools.length === 1 ? plans[0]?.model : 'model' in requested ? requested.model : undefined;
    const preview = options.dryRun ? { dryRun: true, changes: publicPlannedChanges(planned.changes) } : {};
    if (options.json) console.log(JSON.stringify({ keySource: picked.source, endpoint, model, ...(profile ? { profile: profile.name } : {}),
      toolModels: Object.fromEntries(plans.map(plan => [plan.tool.name, plan.model])),
      results: jsonToolResults(results), helperSaved, ...(saveFailed ? { error: 'helper_settings_failed' } : {}), ...preview, exitCode }, null, 2));
    else {
      renderToolResults(results, apiKey, !!options.dryRun);
      if (saveFailed) uiRenderer.renderError(t('quick_save_failed'));
      if (options.dryRun) for (const change of publicPlannedChanges(planned.changes)) console.log(JSON.stringify(change));
      else if (!saveFailed) for (const { tool } of successful) uiRenderer.renderHint(`${t('quick_start')}: ${tool.launchOnly ? `coding-helper run ${tool.name}` : [tool.command, ...(tool.launchArgs ?? [])].join(' ')}`);
    }
    process.exitCode = exitCode;
  } catch (error) {
    const code = error instanceof QuickError ? error.code : 'quick_configuration_failed';
    if (options.json) console.log(JSON.stringify({ error: code, ...(error instanceof QuickError && error.suggestions.length ? { suggestions: error.suggestions } : {}), exitCode: 1 }));
    else { if (!initialized) i18n.init('en_US'); uiRenderer.renderError(code === 'context_invalid' ? t('context_invalid', { value: options.context ?? '' }) : `${t('quick_failed')} (${code})`); }
    process.exitCode = 1;
  }
}
