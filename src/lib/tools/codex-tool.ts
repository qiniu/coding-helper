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
const PROVIDER_NAME = 'qnaigc';
const PROFILE_NAME = 'qn-gpt';
const CODEX_MODEL = 'openai/gpt-5.5';
const DEFAULT_CODEX_BASE_URL = getBaseUrl(DEFAULT_ENDPOINT);

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
    writeCodexAuth(buildCodexAuthJson(readCodexAuth(), apiKey));
    const content = readCodexConfig();
    writeCodexConfig(buildCodexConfig(content, baseUrl, models.codexModel || this.defaultModel));
  }

  async unloadConfig(): Promise<void> {
    const content = readCodexConfig();
    writeCodexConfig(removeManagedCodexConfig(content));
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

export function buildCodexConfig(existing: string, baseUrl?: string, model?: string): string {
  let content = removeManagedCodexConfig(existing);
  content = upsertTopLevelModelProvider(content);

  const providerBaseUrl = `${(baseUrl || DEFAULT_CODEX_BASE_URL).replace(/\/+$/, '')}/bypass/openai/v1`;
  const sections = [
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

  return normalizeToml(`${content.trimEnd()}\n\n${sections.join('\n')}`);
}

export function removeManagedCodexConfig(existing: string): string {
  let content = existing;
  content = removeTopLevelQnaigcModelProvider(content);
  content = removeTomlTable(content, `model_providers.${PROVIDER_NAME}`);
  content = removeTomlTable(content, `profiles.${PROFILE_NAME}`);
  return normalizeToml(content);
}

export function buildCodexAuthJson(existing: string, apiKey: string): string {
  const auth = parseJsonObject(existing);
  auth.auth_mode = 'apikey';
  auth.OPENAI_API_KEY = apiKey;
  return `${JSON.stringify(auth, null, 2)}\n`;
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
