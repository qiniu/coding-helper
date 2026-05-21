import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import type { ITool } from './base-tool.js';
import { configManager, type ModelConfig } from '../config.js';
import { t } from '../i18n.js';
import { uiRenderer } from '../wizard/ui/ui-renderer.js';
import { runOpenCodeModelSelectionFlow } from '../wizard/flows/opencode-model-selection-flow.js';

// OpenCode 跨平台配置路径（官方约定，Windows 也用此路径）
const OPENCODE_DIR = path.join(os.homedir(), '.config', 'opencode');
const OPENCODE_CONFIG_FILE = path.join(OPENCODE_DIR, 'opencode.json');

// 七牛是多 provider 聚合端点（同时支持 OpenAI / Anthropic 协议），
// 用统一的自定义 provider + openai-compatible 适配器路由所有模型，
// 这样不论用户选 deepseek / qwen / anthropic / 任何前缀的模型都走同一入口。
const PROVIDER_KEY = 'qiniu';
const PROVIDER_DISPLAY_NAME = 'Qiniu';
const PROVIDER_NPM = '@ai-sdk/openai-compatible';

// OpenCode 工具实现
export class OpenCodeTool implements ITool {
  name = 'opencode';
  displayName = 'OpenCode';
  command = 'opencode';
  installCommand = 'npm install -g opencode-ai';
  updateCommand = 'npm install -g opencode-ai@latest';
  npmPackageName = 'opencode-ai';
  aliases = ['oc'];

  getVersion(): string | null {
    try {
      const output = execSync('opencode --version', { stdio: 'pipe', encoding: 'utf-8' }).trim();
      const match = output.match(/(\d+\.\d+\.\d+)/);
      return match ? match[1] : output;
    } catch {
      return null;
    }
  }

  isInstalled(): boolean {
    try {
      const command = process.platform === 'win32' ? 'where opencode' : 'which opencode';
      execSync(command, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  getConfig(): Record<string, unknown> {
    const content = readOpenCodeConfig();
    return {
      configPath: OPENCODE_CONFIG_FILE,
      configured: hasManagedOpenCodeConfig(content),
    };
  }

  clearModelConfig(): void {
    writeOpenCodeConfig(removeManagedOpenCodeConfig(readOpenCodeConfig()));
  }

  async loadConfig(apiKey: string, baseUrl: string, models: ModelConfig): Promise<void> {
    const content = readOpenCodeConfig();
    writeOpenCodeConfig(buildOpenCodeConfig(content, baseUrl, apiKey, models.opencodeModel));
  }

  async unloadConfig(): Promise<void> {
    writeOpenCodeConfig(removeManagedOpenCodeConfig(readOpenCodeConfig()));
  }

  async runModelConfigFlow(): Promise<boolean> {
    return runOpenCodeModelSelectionFlow();
  }

  renderModelConfigSummary(): void {
    const models = configManager.getModels();
    uiRenderer.renderModelConfigItem(t('config_view_opencode_model'), models.opencodeModel);
  }
}

// ========== 纯函数（导出供测试） ==========

// 在已有 JSON 上写入七牛托管的 model + provider.qiniu，保留所有其他字段
export function buildOpenCodeConfig(existing: string, baseUrl: string, apiKey: string, model?: string): string {
  const config = parseJson(existing);

  if (!config.$schema) {
    config.$schema = 'https://opencode.ai/config.json';
  }

  // OpenCode model 字段格式: <provider-id>/<raw-model-id>
  // 给用户选的 model 前置 qiniu/ 让 OpenCode 路由到我们托管的 provider
  if (model) {
    config.model = `${PROVIDER_KEY}/${model}`;
  }

  const provider = (isPlainObject(config.provider) ? config.provider : {}) as Record<string, unknown>;
  // 七牛走 OpenAI 兼容协议，baseURL 必须带 /v1 后缀
  const sanitizedBaseUrl = `${(baseUrl || 'https://api.qnaigc.com').replace(/\/+$/, '')}/v1`;

  // 复用已有的 models 字段（OpenCode 会用此声明展示可选模型），追加当前选的
  const existingQiniu = isPlainObject(provider[PROVIDER_KEY])
    ? (provider[PROVIDER_KEY] as Record<string, unknown>)
    : undefined;
  const models = isPlainObject(existingQiniu?.models)
    ? { ...(existingQiniu!.models as Record<string, unknown>) }
    : {};
  if (model) {
    models[model] = {};
  }

  provider[PROVIDER_KEY] = {
    npm: PROVIDER_NPM,
    name: PROVIDER_DISPLAY_NAME,
    options: {
      apiKey,
      baseURL: sanitizedBaseUrl,
    },
    models,
  };
  config.provider = provider;

  return `${JSON.stringify(config, null, 2)}\n`;
}

// 仅在 provider.qiniu 由本工具托管时移除它和顶层 model（以 qiniu/ 开头才删）
export function removeManagedOpenCodeConfig(existing: string): string {
  const config = parseJson(existing);
  const provider = isPlainObject(config.provider) ? (config.provider as Record<string, unknown>) : undefined;

  if (isManagedQiniuProvider(provider)) {
    delete provider![PROVIDER_KEY];
    if (Object.keys(provider!).length === 0) {
      delete config.provider;
    }
    if (typeof config.model === 'string' && config.model.startsWith(`${PROVIDER_KEY}/`)) {
      delete config.model;
    }
  }

  const keys = Object.keys(config);
  if (keys.length === 0 || (keys.length === 1 && keys[0] === '$schema')) {
    return '';
  }

  return `${JSON.stringify(config, null, 2)}\n`;
}

// ========== 私有辅助 ==========

function readOpenCodeConfig(): string {
  try {
    if (fs.existsSync(OPENCODE_CONFIG_FILE)) {
      return fs.readFileSync(OPENCODE_CONFIG_FILE, 'utf-8');
    }
  } catch {
    // 文件不存在或读取失败按空配置处理
  }
  return '';
}

function writeOpenCodeConfig(content: string): void {
  if (content.trim()) {
    if (!fs.existsSync(OPENCODE_DIR)) {
      fs.mkdirSync(OPENCODE_DIR, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(OPENCODE_CONFIG_FILE, content, { encoding: 'utf-8', mode: 0o600 });
  } else if (fs.existsSync(OPENCODE_CONFIG_FILE)) {
    // 完全空时删除文件，避免遗留无意义的空 JSON
    fs.unlinkSync(OPENCODE_CONFIG_FILE);
  }
}

function parseJson(content: string): Record<string, unknown> {
  if (!content.trim()) return {};
  try {
    const parsed = JSON.parse(content);
    return isPlainObject(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// 识别本工具写入的 provider.qiniu —— 用 npm 字段作为管理标志，
// 避免误删用户自己手写的同名 provider
function isManagedQiniuProvider(provider: Record<string, unknown> | undefined): boolean {
  if (!provider) return false;
  const qiniu = provider[PROVIDER_KEY];
  if (!isPlainObject(qiniu)) return false;
  return qiniu.npm === PROVIDER_NPM;
}

function hasManagedOpenCodeConfig(content: string): boolean {
  const config = parseJson(content);
  const provider = isPlainObject(config.provider) ? (config.provider as Record<string, unknown>) : undefined;
  return isManagedQiniuProvider(provider);
}

