import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import type { ITool } from './base-tool.js';
import { configManager, type ModelConfig } from '../config.js';
import { DEFAULT_ENDPOINT, getBaseUrl } from '../endpoints.js';
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
const CODEX_MODEL = 'openai/gpt-5.5';
const DEFAULT_CODEX_BASE_URL = getBaseUrl(DEFAULT_ENDPOINT);

export interface CodexCatalogModel {
  id: string;
  context_length: number;
  max_tokens: number;
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
  name = 'codex';
  displayName = 'Codex';
  defaultModel = CODEX_MODEL;
  command = 'codex';
  installCommand = 'npm install -g @openai/codex';
  updateCommand = 'npm install -g @openai/codex@latest';
  npmPackageName = '@openai/codex';
  aliases = ['openai-codex'];
  private lastBackupPaths: string[] = [];

  getVersion(): string | null {
    try {
      const output = execSync('codex --version', { stdio: 'pipe', encoding: 'utf-8' }).trim();
      const match = output.match(/(\d+\.\d+\.\d+)/);
      return match ? match[1] : output;
    } catch {
      return null;
    }
  }

  isInstalled(): boolean {
    try {
      const command = process.platform === 'win32' ? 'where codex' : 'which codex';
      execSync(command, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  getConfig(): Record<string, unknown> {
    const content = readCodexConfig();
    return {
      configPath: CODEX_CONFIG_FILE,
      authPath: CODEX_AUTH_FILE,
      configured: hasManagedCodexConfig(content),
    };
  }

  clearModelConfig(): void {
    const content = readCodexConfig();
    writeCodexConfig(removeTomlTable(content, 'profiles.qn-gpt'));
  }

  async loadConfig(apiKey: string, baseUrl: string, models: ModelConfig): Promise<void> {
    this.lastBackupPaths = [
      backupCodexFile(CODEX_CONFIG_FILE),
      backupCodexFile(CODEX_CATALOG_FILE),
    ].filter((backup): backup is string => !!backup);
    writeCodexAuth(buildCodexAuthJson(readCodexAuth(), apiKey));
    writeCodexCatalog(buildCodexModelCatalog(GPT_MODELS));
    writeCodexConfig(buildCodexConfig('', baseUrl, models.codexModel || this.defaultModel, CODEX_CATALOG_FILE));
  }

  getLoadConfigNotes(): string[] {
    return this.lastBackupPaths.map((path) => t('codex_backup_created', { path }));
  }

  async unloadConfig(): Promise<void> {
    const content = readCodexConfig();
    writeCodexConfig(removeManagedCodexConfig(content));
    if (fs.existsSync(CODEX_CATALOG_FILE)) fs.rmSync(CODEX_CATALOG_FILE);
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
  content = removeTopLevelCatalogPath(content);
  content = removeTopLevelQnaigcModelProvider(content);
  content = removeTomlTable(content, `model_providers.${PROVIDER_NAME}`);
  content = removeTomlTable(content, `profiles.${PROFILE_NAME}`);
  return normalizeToml(content);
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

export function buildCodexModelCatalog(models: CodexCatalogModel[]): string {
  const reasoningLevels = ['low', 'medium', 'high', 'xhigh'].map((effort) => ({
    effort,
    description: effort === 'low' ? 'Fast responses with lighter reasoning' :
      effort === 'medium' ? 'Balances speed and reasoning depth for everyday tasks' :
      effort === 'high' ? 'Greater reasoning depth for complex problems' :
      'Extra high reasoning depth for complex problems',
  }));
  return JSON.stringify({ models: models.filter((model) => model.id.startsWith('openai/gpt')).map((model, index) => ({
    slug: model.id,
    display_name: model.id.replace('openai/', '').replace(/(^|[-.])([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`),
    description: `${model.id.replace('openai/', '')} coding model.`,
    default_reasoning_level: 'medium',
    supported_reasoning_levels: reasoningLevels,
    shell_type: 'unified_exec',
    visibility: 'list',
    supported_in_api: true,
    priority: index + 1,
    additional_speed_tiers: [],
    service_tiers: [],
    context_window: model.context_length,
    max_context_window: model.context_length,
    effective_context_window_percent: 95,
    input_modalities: ['text', 'image'],
    used_fallback_model_metadata: false,
    support_verbosity: false,
    truncation_policy: { mode: 'tokens', limit: 10000 },
    experimental_supported_tools: [],
    base_instructions: 'You are Codex, a coding agent based on GPT-5.',
  })) }) + '\n';
}

function readCodexConfig(): string {
  try {
    if (fs.existsSync(CODEX_CONFIG_FILE)) {
      return fs.readFileSync(CODEX_CONFIG_FILE, 'utf-8');
    }
  } catch {
    // 文件不存在或读取失败时按空配置处理
  }
  return '';
}

function readCodexAuth(): string {
  try {
    if (fs.existsSync(CODEX_AUTH_FILE)) {
      return fs.readFileSync(CODEX_AUTH_FILE, 'utf-8');
    }
  } catch {
    // 文件不存在或读取失败时按空配置处理
  }
  return '';
}

function writeCodexConfig(content: string): void {
  if (!fs.existsSync(CODEX_DIR)) {
    fs.mkdirSync(CODEX_DIR, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(CODEX_CONFIG_FILE, content, { encoding: 'utf-8', mode: 0o600 });
}

function writeCodexCatalog(content: string): void {
  if (!fs.existsSync(CODEX_CATALOG_DIR)) {
    fs.mkdirSync(CODEX_CATALOG_DIR, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(CODEX_CATALOG_FILE, content, { encoding: 'utf-8', mode: 0o600 });
}

function writeCodexAuth(content: string): void {
  if (!fs.existsSync(CODEX_DIR)) {
    fs.mkdirSync(CODEX_DIR, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(CODEX_AUTH_FILE, content, { encoding: 'utf-8', mode: 0o600 });
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

function escapeTomlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
