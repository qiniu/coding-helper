import os from 'node:os';
import path from 'node:path';
import type { ModelConfig } from '../config.js';
import { t } from '../i18n.js';
import { isQiniuBaseUrl } from '../endpoints.js';
import { readJsonObjectStrict, formatJsonLike } from '../core/safe-write.js';
import { applyConfigEdits, parseConfigObject } from '../core/config-transaction.js';
import { OpenAICompatTool, fetchModelLimits, isRecord, openAIBaseUrl, type ModelLimits } from './openai-compat-tool.js';
const DISPLAY_PREFIX = 'Qiniu: ';
export function getDroidInstallCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32'
    ? "powershell -NoProfile -ExecutionPolicy Bypass -Command \"$ErrorActionPreference = 'Stop'; try { irm https://app.factory.ai/cli/windows | iex } catch { Write-Error $_; exit 1 }\""
    : "bash -o pipefail -c 'curl -fsSL https://app.factory.ai/cli | sh'";
}
function droidSettingsFile(): string { return path.join(os.homedir(), '.factory', 'settings.json'); }
function isQiniuModel(entry: unknown): boolean { return isRecord(entry) && typeof entry.displayName === 'string' && entry.displayName.startsWith(DISPLAY_PREFIX); }
export function applyDroidSettings(settings: Record<string, unknown>, baseUrl: string, apiKey: string, model: string, limits?: ModelLimits): Record<string, unknown> {
  if (Object.hasOwn(settings, 'customModels') && (!Array.isArray(settings.customModels) || !settings.customModels.every(isRecord))) throw new Error('Invalid Droid customModels array.');
  const existing = Array.isArray(settings.customModels) ? settings.customModels : [];
  const index = existing.findIndex(entry => isQiniuModel(entry) && entry.model === model && entry.baseUrl === openAIBaseUrl(baseUrl));
  const previous = index >= 0 ? existing[index] as Record<string, unknown> : undefined;
  if (limits && (!Number.isFinite(limits.contextWindow) || !Number.isFinite(limits.maxOutputTokens) || limits.maxOutputTokens <= 0 || limits.contextWindow <= limits.maxOutputTokens)) {
    throw new Error('Droid requires a positive input allowance after reserving output tokens.');
  }
  const next = {
    ...(previous ?? {}),
    model, displayName: DISPLAY_PREFIX + model, baseUrl: openAIBaseUrl(baseUrl), apiKey, provider: 'generic-chat-completion-api',
    ...(limits && !(limits.verified === false && previous) ? { maxOutputTokens: limits.maxOutputTokens, maxContextLimit: limits.contextWindow - limits.maxOutputTokens,
      noImageSupport: !limits.modalities?.input.includes('image') } : {}),
  };
  // 自定义模型ID包含数组索引；不得删掉旧条目导致其他模型索引改变。
  const customModels = [...existing];
  if (index >= 0) customModels[index] = next;
  else customModels.push(next);
  return { ...settings, customModels };
}

export class DroidTool extends OpenAICompatTool {
  name = 'droid';
  displayName = 'Factory Droid';
  command = 'droid';
  installCommand = getDroidInstallCommand();
  aliases = ['factory'];

  getLoadConfigNotes(): string[] { return [t('droid_select_loaded_model')]; }

  getConfig(): Record<string, unknown> {
    try {
      return readJsonObjectStrict(droidSettingsFile());
    } catch {
      return {};
    }
  }

  isConfigured(): boolean {
    const models = readJsonObjectStrict(droidSettingsFile()).customModels;
    return Array.isArray(models) && models.some(model => isQiniuModel(model) && isRecord(model) && isQiniuBaseUrl(model.baseUrl));
  }

  async loadConfig(apiKey: string, baseUrl: string, models: ModelConfig): Promise<void> {
    const model = this.resolveModel(models); const limits = await fetchModelLimits(baseUrl, apiKey, model);
    applyConfigEdits(this.name, [{ file: droidSettingsFile(), build: content => formatJsonLike(content, applyDroidSettings(parseConfigObject(content), baseUrl, apiKey, model, limits)) }]);
  }
  unloadConfig(): void { this.restoreManagedConfig([droidSettingsFile()]); }
}
