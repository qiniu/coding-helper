import os from 'node:os';
import path from 'node:path';
import type { ModelConfig } from '../config.js';
import { t } from '../i18n.js';
import { parse } from 'smol-toml';
import { isQiniuBaseUrl } from '../endpoints.js';
import { readTextFile } from '../core/safe-write.js';
import { applyConfigEdits } from '../core/config-transaction.js';
import { OpenAICompatTool, fetchModelLimits, openAIBaseUrl, isRecord, type ModelLimits } from './openai-compat-tool.js';
import { escapeTomlString, normalizeToml, removeTomlTablesWhere, upsertTopLevelTomlKey, validateToml } from '../core/toml-edit.js';
const PROVIDER_ID = 'qiniu';
const MODEL_ALIAS_PREFIX = `${PROVIDER_ID}/`;

export function getKimiConfigFile(): string {
  const home = process.env.KIMI_CODE_HOME || path.join(os.homedir(), '.kimi-code');
  return path.join(home, 'config.toml');
}

// 七牛的表：[providers.qiniu] 与 [models."qiniu/<model>"]
function isManagedTable(name: string): boolean {
  return name === `providers.${PROVIDER_ID}` ||
    name.startsWith(`providers.${PROVIDER_ID}.`) ||
    name.startsWith(`models."${MODEL_ALIAS_PREFIX}`);
}

export function hasManagedKimiConfig(content: string): boolean {
  return content.split('\n').some((line) => line.trim() === `[providers.${PROVIDER_ID}]`);
}

// 写入七牛 provider 与模型别名，并设为 default_model；其他内容原样保留
export function applyKimiConfig(
  existing: string,
  baseUrl: string,
  apiKey: string,
  model: string,
  contextWindow = 128000,
  limits?: ModelLimits,
): string {
  const newline = existing.includes('\r\n') ? '\r\n' : '\n';
  const alias = `${MODEL_ALIAS_PREFIX}${model}`;
  let content = removeTomlTablesWhere(existing, isManagedTable);
  content = upsertTopLevelTomlKey(content, 'default_model', `"${escapeTomlString(alias)}"`);
  const tables = [
    `[providers.${PROVIDER_ID}]`,
    'type = "openai"',
    `base_url = "${escapeTomlString(openAIBaseUrl(baseUrl))}"`,
    `api_key = "${escapeTomlString(apiKey)}"`,
    '',
    `[models."${escapeTomlString(alias)}"]`,
    `provider = "${PROVIDER_ID}"`,
    `model = "${escapeTomlString(model)}"`,
    `max_context_size = ${contextWindow}`,
    ...(limits?.modalities ? [`capabilities = ${JSON.stringify(limits.modalities.input.filter(value => ['image','video','audio'].includes(value)).map(value => value + '_in'))}`] : []),
    '',
  ].join(newline);
  const body = content.trim();
  return normalizeToml(body ? `${body}${newline}${newline}${tables}` : tables);
}

// 官方安装脚本自带运行时，兼容本项目支持的 Node 18+。
// https://www.kimi.com/en/help/kimi-code/cli-getting-started
export function getKimiInstallCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32'
    ? "powershell -NoProfile -ExecutionPolicy Bypass -Command \"$ErrorActionPreference = 'Stop'; irm https://code.kimi.com/kimi-code/install.ps1 | iex\""
    : 'bash -o pipefail -c "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash"';
}

export class KimiCodeTool extends OpenAICompatTool {
  name = 'kimi-code';
  displayName = 'Kimi Code CLI';
  command = 'kimi';
  installCommand = getKimiInstallCommand();
  updateCommand = this.installCommand;
  npmPackageName = '@moonshot-ai/kimi-code';
  aliases = ['kimi'];

  getConfig(): Record<string, unknown> {
    return { configPath: getKimiConfigFile(), configured: this.isConfigured() };
  }

  isConfigured(): boolean {
    const config = parse(readTextFile(getKimiConfigFile()) ?? '');
    return isRecord(config.providers) && isRecord(config.providers.qiniu) && isQiniuBaseUrl(config.providers.qiniu.base_url);
  }

  async loadConfig(apiKey: string, baseUrl: string, models: ModelConfig): Promise<void> {
    const model = this.resolveModel(models);
    const version = this.getVersion();
    if (version && Number(version.split('.')[0]) < 2) throw new Error(t('kimi_legacy_cli', { version, command: this.installCommand }));
    const limits = await fetchModelLimits(baseUrl, apiKey, model);
    applyConfigEdits(this.name, [{ file: getKimiConfigFile(), build: content => {
      const next = applyKimiConfig(content ?? '', baseUrl, apiKey, model, limits.contextWindow, limits); validateToml(next); return next;
    } }]);
  }
  unloadConfig(): void { this.restoreManagedConfig([getKimiConfigFile()]); }
}
