import { configManager } from '../lib/config.js';
import { CUSTOM_ENDPOINT, getBaseUrl, normalizeCustomBaseUrl } from '../lib/endpoints.js';
import { validateApiKey } from '../lib/api-validator.js';
import { isValidProfileName } from '../lib/core/quick-args.js';
import { applyTool, getSyncTargets, syncConfiguredTools, exitCodeFor } from '../lib/core/tool-service.js';
import { toolManager } from '../lib/tool-manager.js';
import { i18n } from '../lib/i18n.js';
import { modelService } from '../lib/model-service.js';
import { marketModelService } from '../lib/market-model-service.js';
import { renderToolResults } from '../lib/wizard/ui/tool-results.js';

function fail(): void { console.error('Profile operation failed. Check the name, key, endpoint and configuration.'); process.exitCode = 1; }
function clearCaches(): void { modelService.clearCache(); marketModelService.clearCache(); }
export function profileListCommand(options: { json?: boolean } = {}): void {
  try {
    i18n.init();
    const profiles = configManager.listProfiles().map(profile => ({ name: profile.name, endpoint: profile.endpoint, baseUrl: profile.baseUrl, apiKeySet: !!profile.apiKey,
      tools: toolManager.getAll().filter(tool => configManager.getToolProfile(tool.name) === profile.name).map(tool => tool.name) }));
    if (options.json) console.log(JSON.stringify({ active: configManager.getActiveProfile() ?? null, profiles }, null, 2));
    else for (const profile of profiles) console.log(`${profile.name === configManager.getActiveProfile() ? '*' : ' '} ${profile.name}  ${profile.baseUrl}  ${profile.tools.join(', ')}`);
  } catch { fail(); }
}
export async function profileAddCommand(name: string, key: string | undefined, options: { intl?: boolean; baseUrl?: string; keyStdin?: boolean; use?: boolean } = {}): Promise<void> {
  try {
    i18n.init();
    if (!isValidProfileName(name) || (options.intl && options.baseUrl !== undefined)) throw new Error();
    if (options.keyStdin) {
      if (key) throw new Error();
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of process.stdin) { const data = Buffer.from(chunk); size += data.length; if (size > 65536) throw new Error(); chunks.push(data); }
      key = Buffer.concat(chunks).toString('utf8');
    }
    const apiKey = (key ?? process.env.QINIU_API_KEY ?? '').trim();
    if (!apiKey || /\s/.test(apiKey)) throw new Error();
    const endpoint = options.baseUrl !== undefined ? CUSTOM_ENDPOINT : options.intl ? 'international' : 'china';
    const baseUrl = options.baseUrl !== undefined ? normalizeCustomBaseUrl(options.baseUrl) : getBaseUrl(endpoint);
    const validation = await validateApiKey(apiKey, baseUrl);
    if (!validation.valid) throw new Error();
    configManager.saveProfile(name, apiKey, endpoint, baseUrl);
    if (options.use) configManager.useProfile(name);
    clearCaches(); console.log(`Profile saved: ${name}`);
  } catch { fail(); }
}
export async function profileUseCommand(name: string, tools?: string, options: { sync?: boolean } = {}): Promise<void> {
  try {
    i18n.init(); const profile = configManager.getProfile(name); if (!profile?.apiKey) throw new Error();
    if (tools === undefined) {
      const targets = options.sync ? getSyncTargets(toolManager.getAll()) : [];
      configManager.useProfile(name); clearCaches();
      if (options.sync) { const results = await syncConfiguredTools(targets); renderToolResults(results, profile.apiKey); process.exitCode = exitCodeFor(results); }
      else console.log(`Active profile: ${name}. Client settings unchanged; use --sync to update configured clients.`);
      return;
    }
    const names = tools.split(',').map(value => value.trim()).filter(Boolean); if (!names.length) throw new Error();
    const targets = [...new Set(names.map(value => { const tool = toolManager.get(value); if (!tool) throw new Error(); return tool; }))];
    const results = [];
    for (const tool of targets) {
      const result = tool.launchOnly ? { tool, status: 'success' as const } : await applyTool(tool, { apiKey: profile.apiKey, baseUrl: profile.baseUrl });
      results.push(result.status === 'skipped' ? { ...result, status: 'failed' as const } : result);
      if (result.status === 'success') configManager.setToolProfile(tool.name, name);
    }
    renderToolResults(results, profile.apiKey); process.exitCode = exitCodeFor(results);
  } catch { fail(); }
}
export async function profileRemoveCommand(name: string): Promise<void> {
  try { i18n.init(); if (!configManager.getProfile(name)) throw new Error(); configManager.removeProfile(name); clearCaches(); console.log(`Profile removed: ${name}. Client settings unchanged; restore or sync them explicitly.`); }
  catch { fail(); }
}
