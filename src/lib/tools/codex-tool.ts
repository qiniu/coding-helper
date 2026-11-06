import { findCommand, commandVersion } from '../../utils/find-command.js';
import { parse } from 'smol-toml';
import { readTextFile } from '../core/safe-write.js';
import { applyConfigEdits, restoreConfigEdits, parseConfigObject } from '../core/config-transaction.js';
import { validateToml, upsertTopLevelTomlKey, removeTopLevelTomlKey, removeTomlTable as removeSharedTomlTable } from '../core/toml-edit.js';
import { capContextWindow, fetchModelLimits, isRecord } from './openai-compat-tool.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ITool } from './base-tool.js';
import { configManager, type ModelConfig } from '../config.js';
import { DEFAULT_ENDPOINT, getBaseUrl, isQiniuBaseUrl } from '../endpoints.js';
import { t } from '../i18n.js';
import { uiRenderer } from '../wizard/ui/ui-renderer.js';
import { promptHelper } from '../wizard/ui/prompt-helper.js';

const CODEX_DIR = path.join(os.homedir(), '.codex');
const CODEX_CONFIG_FILE = path.join(CODEX_DIR, 'config.toml');
const CODEX_AUTH_FILE = path.join(CODEX_DIR, 'auth.json');
const CODEX_CATALOG_DIR = path.join(CODEX_DIR, 'model-catalogs');
const CODEX_CATALOG_FILE = path.join(CODEX_CATALOG_DIR, 'qnaigc.json');
const PROVIDER_NAME = 'qnaigc';
const PROFILE_NAME = 'qn-gpt';
const CODEX_MODEL = 'openai/gpt-6-astra';
const DEFAULT_CODEX_BASE_URL = getBaseUrl(DEFAULT_ENDPOINT);

export interface CodexCatalogModel {
  id: string;
  context_length: number;
  max_tokens: number;
  plain?: boolean;
  images?: boolean;
}

const GPT_MODELS: CodexCatalogModel[] = [
  ['openai/gpt-5-pro', 400000, 128000], ['openai/gpt-5.5', 1000000, 128000],
  ['openai/gpt-5.6-sol', 1050000, 128000], ['openai/gpt-5.6-terra', 1050000, 128000],
  ['openai/gpt-5.6-luna', 1050000, 128000], ['openai/gpt-6-astra', 1050000, 128000],
  ['openai/gpt-5.3-codex', 400000, 128000], ['openai/gpt-5-nano', 400000, 128000],
  ['openai/gpt-5.2-chat', 128000, 32000], ['openai/gpt-5-chat', 128000, 16400],
  ['openai/gpt-5-mini', 400000, 400000], ['openai/gpt-5', 400000, 128000],
  ['openai/gpt-5.2', 400000, 128000], ['openai/gpt-5.2-codex', 400000, 128000],
  ['openai/gpt-5.4-mini', 400000, 128000], ['openai/gpt-5.4-pro', 1000000, 128000],
  ['openai/gpt-5.4-nano', 400000, 128000], ['openai/gpt-5.4', 1050000, 128000],
].map(([id, context_length, max_tokens]) => ({ id: id as string, context_length: context_length as number, max_tokens: max_tokens as number }));

// Codex 工具实现
export class CodexTool implements ITool {
  supportsPreview = true;
  name = 'codex';
  displayName = 'Codex';
  defaultModel = CODEX_MODEL;
  command = 'codex';
  searchPaths?: string[];
  installCommand = 'npm install -g @openai/codex';
  updateCommand = 'npm install -g @openai/codex@latest';
  npmPackageName = '@openai/codex';
  aliases = ['openai-codex'];

  getVersion(): string | null { const file = findCommand(this.command, this.searchPaths); return file ? commandVersion(file) : null; }

  isInstalled(): boolean { return !!findCommand(this.command, this.searchPaths); }

  getConfig(): Record<string, unknown> {
    return {
      configPath: CODEX_CONFIG_FILE,
      authPath: CODEX_AUTH_FILE,
      configured: this.isConfigured(),
    };
  }

  isConfigured(): boolean {
    const config = parse(readTextFile(CODEX_CONFIG_FILE) ?? '');
    const profile = typeof config.profile === 'string' && isRecord(config.profiles) ? config.profiles[config.profile] : undefined;
    const provider = isRecord(profile)
      ? profile.model_provider ?? config.model_provider : config.model_provider;
    if (typeof provider !== 'string') return false;
    const entry = isRecord(config.model_providers) ? config.model_providers[provider] : undefined;
    return isRecord(entry) && isQiniuBaseUrl(entry.base_url);
  }

  clearModelConfig(): void {
    const files = [CODEX_CONFIG_FILE, CODEX_AUTH_FILE, CODEX_CATALOG_FILE];
    if (!restoreConfigEdits(this.name, files) && files.some(file => fs.existsSync(file))) {
      throw new Error('No restoration record for Codex. Configuration is unchanged; remove legacy credentials manually or recover a known backup.');
    }
  }

  async loadConfig(apiKey: string, baseUrl: string, models: ModelConfig): Promise<void> {
    const model = models.codexModel || this.defaultModel;
    const extra: CodexCatalogModel[] = [];
    if (!GPT_MODELS.some(entry => entry.id === model)) {
      const limits = await fetchModelLimits(baseUrl, apiKey, model, this.name);
      extra.push({ id: model, context_length: limits.contextWindow, max_tokens: limits.maxOutputTokens, plain: true, images: limits.modalities?.input.includes('image') ?? false });
    }
    applyConfigEdits(this.name, [
      { file: CODEX_CONFIG_FILE, build: content => mergeCodexConfig(content ?? '', baseUrl, model, CODEX_CATALOG_FILE) },
      { file: CODEX_AUTH_FILE, build: content => JSON.stringify({ ...parseConfigObject(content), auth_mode: 'apikey', OPENAI_API_KEY: apiKey }, null, 2) + '\n' },
      { file: CODEX_CATALOG_FILE, build: content => { if (content !== undefined) parseConfigObject(content); return buildCodexModelCatalog([...GPT_MODELS, ...extra].map(entry => ({ ...entry, context_length: capContextWindow(entry.context_length, this.name) }))); } },
    ]);
  }

  async unloadConfig(): Promise<void> { this.clearModelConfig(); }

  async checkModel(model: string, connection: { apiKey: string; baseUrl: string }): Promise<string | undefined> {
    try {
      const response = await fetch(`${connection.baseUrl}/bypass/openai/v1/responses`, {
        method: 'POST', headers: { Authorization: `Bearer ${connection.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: 'hi', max_output_tokens: 16, stream: true }), signal: AbortSignal.timeout(60000),
      });
      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => {});
        return 'quick_model_incompatible';
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let text = '', size = 0;
      try {
        while (size <= 65536) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.length;
          if (size > 65536) return 'quick_model_incompatible';
          text += decoder.decode(chunk.value, { stream: true });
          if (isCodexCompatibleStream(text)) return undefined;
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    } catch { /* 网络和非标准流都不能冒充模型兼容。 */ }
    return 'quick_model_incompatible';
  }

  async runModelConfigFlow(): Promise<boolean> {
    uiRenderer.renderHeader();
    uiRenderer.renderHint(t('codex_fixed_model_hint', { model: this.defaultModel }));
    configManager.setModels({ codexModel: this.defaultModel });
    await promptHelper.pressEnter();
    return true;
  }

  renderModelConfigSummary(): void {
    uiRenderer.renderConfigItem(t('config_view_codex_model'), configManager.getModels().codexModel || this.defaultModel);
  }
}

export function isCodexCompatibleStream(text: string): boolean {
  let completed = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const event: unknown = JSON.parse(data);
      if (!isRecord(event) || typeof event.type !== 'string') return false;
      if (['response.failed', 'error'].includes(event.type)) return false;
      if (event.type === 'response.incomplete') {
        const response = isRecord(event.response) ? event.response : undefined;
        const details = response && isRecord(response.incomplete_details) ? response.incomplete_details : undefined;
        if (details?.reason !== 'max_output_tokens') return false;
        completed = true;
      }
      if (event.type === 'response.completed') completed = true;
    } catch { return false; }
  }
  return completed;
}

export function buildCodexConfig(_existing: string, baseUrl?: string, model?: string, catalogPath?: string): string {
  const providerBaseUrl = `${(baseUrl || DEFAULT_CODEX_BASE_URL).replace(/\/+$/, '')}/bypass/openai/v1`;
  const sections = [
    ...(model ? [`model = "${escapeTomlString(model)}"`] : []),
    `model_provider = "${PROVIDER_NAME}"`,
    ...(catalogPath ? [`model_catalog_json = "${escapeTomlString(catalogPath)}"`] : []),
    '',
    `[model_providers.${PROVIDER_NAME}]`,
    'name = "Qiniu"',
    `base_url = "${escapeTomlString(providerBaseUrl)}"`,
    'requires_openai_auth = true',
    'wire_api = "responses"',
    '',
  ];

  if (model) {
    sections.push(
      `[profiles.${PROFILE_NAME}]`,
      `model_provider = "${PROVIDER_NAME}"`,
      `model = "${escapeTomlString(model)}"`,
      '',
    );
  }

  return normalizeToml(sections.join('\n'));
}

export function removeManagedCodexConfig(existing: string): string {
  let content = existing;
  if (hasManagedCodexConfig(content)) content = removeTopLevelModel(content);
  content = removeTopLevelCatalogPath(content);
  content = removeTopLevelQnaigcModelProvider(content);
  content = removeTomlTable(content, `model_providers.${PROVIDER_NAME}`);
  content = removeTomlTable(content, `profiles.${PROFILE_NAME}`);
  return normalizeToml(content);
}

function removeTopLevelModel(content: string): string {
  const lines = content.split('\n');
  const firstTableIndex = lines.findIndex((line) => /^\[[^\]]+\]\s*$/.test(line.trim()));
  const searchEnd = firstTableIndex >= 0 ? firstTableIndex : lines.length;
  return lines.filter((line, lineIndex) => lineIndex >= searchEnd || !/^model\s*=/.test(line.trim())).join('\n');
}

function removeTopLevelCatalogPath(content: string): string {
  const lines = content.split('\n');
  return lines.filter((line) => !/^model_catalog_json\s*=\s*"[^"\n]*(?:\/|\\\\)model-catalogs(?:\/|\\\\)qnaigc\.json"\s*$/.test(line.trim())).join('\n');
}

export function buildCodexAuthJson(existing: string, apiKey: string): string {
  const auth = parseJsonObject(existing);
  auth.auth_mode = 'apikey';
  auth.OPENAI_API_KEY = apiKey;
  return `${JSON.stringify(auth, null, 2)}\n`;
}

export function backupCodexFile(filePath: string, now = new Date()): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  const pad = (value: number): string => String(value).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const baseBackupPath = `${filePath}.bak-fenno-${timestamp}`;
  let backupPath = baseBackupPath;
  let suffix = 1;
  while (fs.existsSync(backupPath)) {
    backupPath = `${baseBackupPath}-${suffix}`;
    suffix += 1;
  }
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

export function formatCodexBackupNote(
  backupPath: string,
  translate: (key: string, params?: Record<string, string>) => string = t,
): string {
  const key = 'codex_backup_created';
  const translated = translate(key, { path: backupPath });
  return translated === key ? `Codex 原配置已备份到：${backupPath}` : translated;
}

export function buildCodexModelCatalog(models: CodexCatalogModel[]): string {
  const reasoningLevels = ['low', 'medium', 'high', 'xhigh'].map((effort) => ({
    effort,
    description: effort === 'low' ? 'Fast responses with lighter reasoning' :
      effort === 'medium' ? 'Balances speed and reasoning depth for everyday tasks' :
      effort === 'high' ? 'Greater reasoning depth for complex problems' :
      'Extra high reasoning depth for complex problems',
  }));
  return JSON.stringify({ models: models.map((model, index) => ({
    slug: model.id,
    display_name: model.id.replace('openai/', '').replace(/(^|[-.])([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`),
    description: `${model.id.replace('openai/', '')} coding model.`,
    default_reasoning_level: model.plain ? null : 'medium',
    supported_reasoning_levels: model.plain ? [] : reasoningLevels,
    shell_type: 'unified_exec',
    visibility: 'list',
    supported_in_api: true,
    priority: index + 1,
    additional_speed_tiers: [],
    service_tiers: [],
    context_window: model.context_length,
    max_context_window: model.context_length,
    effective_context_window_percent: 95,
    input_modalities: model.plain && !model.images ? ['text'] : ['text', 'image'],
    used_fallback_model_metadata: false,
    support_verbosity: false,
    supports_parallel_tool_calls: false,
    truncation_policy: { mode: 'tokens', limit: 10000 },
    experimental_supported_tools: [],
    base_instructions: 'You are Codex, a coding agent based on GPT-5.',
  })) }) + '\n';
}

function parseJsonObject(content: string): Record<string, unknown> {
  if (!content.trim()) return {};
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function upsertTopLevelModelProvider(content: string): string {
  const lines = content.split('\n');
  const firstTableIndex = lines.findIndex((line) => /^\[[^\]]+\]\s*$/.test(line.trim()));
  const searchEnd = firstTableIndex >= 0 ? firstTableIndex : lines.length;
  const index = lines.findIndex((line, lineIndex) => lineIndex < searchEnd && /^model_provider\s*=/.test(line.trim()));
  if (index >= 0) {
    lines[index] = `model_provider = "${PROVIDER_NAME}"`;
    return lines.join('\n');
  }
  return `model_provider = "${PROVIDER_NAME}"\n${content}`;
}

function removeTopLevelQnaigcModelProvider(content: string): string {
  const lines = content.split('\n');
  const firstTableIndex = lines.findIndex((line) => /^\[[^\]]+\]\s*$/.test(line.trim()));
  const searchEnd = firstTableIndex >= 0 ? firstTableIndex : lines.length;
  return lines
    .filter((line, lineIndex) => (
      lineIndex >= searchEnd ||
      !/^model_provider\s*=\s*"qnaigc"\s*$/.test(line.trim())
    ))
    .join('\n');
}

function removeTomlTable(content: string, tableName: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let skipping = false;
  const header = `[${tableName}]`;
  const dottedHeaderPrefix = `[${tableName}.`;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === header || trimmed.startsWith(dottedHeaderPrefix)) {
      skipping = true;
      continue;
    }
    if (skipping && /^\[[^\]]+\]\s*$/.test(trimmed)) {
      skipping = false;
    }
    if (!skipping) {
      result.push(line);
    }
  }

  return result.join('\n');
}

function hasManagedCodexConfig(content: string): boolean {
  return content.includes(`[model_providers.${PROVIDER_NAME}]`);
}

function normalizeToml(content: string): string {
  const trimmed = content.trim();
  return trimmed ? `${trimmed}\n` : '';
}

function escapeTomlString(value: string): string { return JSON.stringify(value).slice(1, -1); }

export function mergeCodexConfig(existing: string, baseUrl: string, model: string, catalogPath: string): string {
  const newline = existing.includes('\r\n') ? '\r\n' : '\n';
  validateToml(existing);
  let content = removeSharedTomlTable(removeSharedTomlTable(existing, 'model_providers.qnaigc'), 'profiles.qn-gpt');
  // 新版 Codex 不再接受顶层 profile；直接使用顶层路由并统一文件式 API Key 认证。
  content = removeTopLevelTomlKey(content, 'profile');
  for (const [key, value] of Object.entries({ model, model_provider: PROVIDER_NAME, model_catalog_json: catalogPath,
    cli_auth_credentials_store: 'file', forced_login_method: 'api' })) {
    content = upsertTopLevelTomlKey(content, key, JSON.stringify(value));
  }
  const generated = buildCodexConfig('', baseUrl, model, catalogPath);
  const next = content.trimEnd() + newline + newline + generated.slice(generated.indexOf('[model_providers.')).replace(/\n/g, newline);
  validateToml(next);
  return next;
}
