import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import { atomicWriteFile } from './core/safe-write.js';
import { CUSTOM_ENDPOINT, DEFAULT_ENDPOINT, getBaseUrl, normalizeEndpointId, registerCustomBaseUrls } from './endpoints.js';

// 配置文件路径
const CONFIG_DIR = path.join(os.homedir(), '.coding-helper');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.yaml');

// 模型配置接口
export interface ModelConfig {
  claudeCode?: ClaudeCodeConfig;
  codeBuddyModels?: string[];
  workbuddyModels?: string[];
  hermesModel?: string;
  codexModel?: string;
  // 通用客户端（OpenCode 等）按工具名记录所选模型
  toolModels?: Record<string, string>;
  // 通用客户端未单独选择时使用的默认模型
  defaultModel?: string;
}

export interface ClaudeCodeConfig {
  haikuModel?: string;
  sonnetModel?: string;
  opusModel?: string;
  subagentModel?: string;
  useDefaultModels?: boolean;
}

// 配置文件结构
interface Config {
  lang?: string;
  endpoint?: string;
  base_url?: string;
  context_windows?: Record<string, number>;
  context_window?: number;
  api_key?: string;
  claudeCode?: ClaudeCodeConfig;
  codeBuddyModels?: string[];
  workbuddyModels?: string[];
  hermesModel?: string;
  codexModel?: string;
  toolModels?: Record<string, string>;
  defaultModel?: string;
}

// 配置管理器单例
class ConfigManager {
  private config: Config = {};
  private contextScope = new AsyncLocalStorage<Record<string, number>>();
  private loaded = false;

  // 确保配置目录存在
  private ensureDir(): void {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    }
  }

  // 加载配置
  private load(): void {
    if (this.loaded) return;
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const parsed = yaml.load(content);
        if (parsed !== undefined && parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) throw new Error('Invalid configuration');
        this.config = (parsed ?? {}) as Config;
      }
    } catch {
      throw new Error('Cannot parse helper configuration. Repair config.yaml before retrying.');
    }
    this.loaded = true;
    registerCustomBaseUrls(this.config.base_url ? [this.config.base_url] : []);
  }

  // 保存配置
  private save(): void {
    this.ensureDir();
    const content = yaml.dump(this.config, { lineWidth: -1 });
    atomicWriteFile(CONFIG_FILE, content);
  }

  // 强制重新加载
  reload(): void {
    this.loaded = false;
    this.load();
  }

  // 首次运行检查
  isFirstRun(): boolean {
    return !fs.existsSync(CONFIG_FILE);
  }

  // 语言偏好
  getLang(): string {
    this.load();
    return this.config.lang || 'zh_CN';
  }

  setLang(lang: string): void {
    this.load();
    this.config.lang = lang;
    this.save();
  }

  // 线路选择
  getEndpoint(): string {
    this.load();
    // 规范化旧 id，兼容历史配置（如 modelink → international）
    return normalizeEndpointId(this.config.endpoint || DEFAULT_ENDPOINT);
  }

  setEndpoint(endpoint: string, baseUrl?: string): void {
    this.load();
    const url = getBaseUrl(endpoint, baseUrl);
    this.config.endpoint = endpoint;
    if (endpoint === CUSTOM_ENDPOINT) this.config.base_url = url;
    else delete this.config.base_url;
    registerCustomBaseUrls(this.config.base_url ? [this.config.base_url] : []);
    this.save();
  }

  // API Key 管理
  getApiKey(): string | undefined {
    this.load();
    return this.config.api_key;
  }

  setApiKey(apiKey: string): void {
    this.load();
    this.config.api_key = apiKey;
    this.save();
  }

  revokeApiKey(): void {
    this.load();
    delete this.config.api_key;
    this.save();
  }

  // 清除 coding-helper 配置（语言、线路、Key、模型）
  // 保留 backups/ 与 state.json：之后仍可按记录的原值把客户端还原
  clearConfig(): void {
    this.config = {};
    this.loaded = false;
    fs.rmSync(CONFIG_FILE, { force: true });
  }

  // 模型配置
  getModels(): ModelConfig {
    this.load();
    return {
      claudeCode: this.config.claudeCode ? { ...this.config.claudeCode } : undefined,
      codeBuddyModels: this.config.codeBuddyModels,
      workbuddyModels: this.config.workbuddyModels,
      hermesModel: this.config.hermesModel,
      codexModel: this.config.codexModel,
      toolModels: this.config.toolModels ? { ...this.config.toolModels } : undefined,
      defaultModel: this.config.defaultModel,
    };
  }

  setModels(models: ModelConfig): void {
    this.load();
    // 使用 'in' 检查来区分「未传递」和「显式传递 undefined」
    if ('claudeCode' in models) {
      this.config.claudeCode = models.claudeCode
        ? { ...this.config.claudeCode, ...models.claudeCode }
        : undefined;
    }
    if ('codeBuddyModels' in models) this.config.codeBuddyModels = models.codeBuddyModels;
    if ('workbuddyModels' in models) this.config.workbuddyModels = models.workbuddyModels;
    if ('hermesModel' in models) this.config.hermesModel = models.hermesModel;
    if ('codexModel' in models) this.config.codexModel = models.codexModel;
    if ('toolModels' in models) {
      this.config.toolModels = models.toolModels
        ? { ...this.config.toolModels, ...models.toolModels }
        : undefined;
    }
    if ('defaultModel' in models) this.config.defaultModel = models.defaultModel;
    this.save();
  }

  // 客户端装载成功后一次提交连接与模型，校验失败不覆盖已有设置。
  saveSettings(apiKey: string, endpoint: string, models: ModelConfig, settings: { contexts?: Record<string, number> } = {}): void {
    this.load();
    const next: Config = { ...this.config, ...models, api_key: apiKey, endpoint };
    if (models.claudeCode) next.claudeCode = { ...this.config.claudeCode, ...models.claudeCode };
    if (models.toolModels) next.toolModels = { ...this.config.toolModels, ...models.toolModels };
    if (settings.contexts) next.context_windows = { ...next.context_windows, ...settings.contexts };
    if (endpoint === CUSTOM_ENDPOINT) next.base_url = getBaseUrl(endpoint, next.base_url);
    else delete next.base_url;
    this.ensureDir();
    atomicWriteFile(CONFIG_FILE, yaml.dump(next, { lineWidth: -1 }));
    this.config = next;
    registerCustomBaseUrls(next.base_url ? [next.base_url] : []);
  }

  // 旧全局值只作兜底；显式 auto 用 0 遮蔽旧值，不影响其他工具。
  getContextWindow(toolName?: string): number | undefined {
    this.load();
    const scope = this.contextScope.getStore();
    if (toolName && scope && Object.hasOwn(scope, toolName)) return scope[toolName] || undefined;
    const own = toolName ? this.config.context_windows?.[toolName] : undefined;
    return (own ?? this.config.context_window) || undefined;
  }

  withContextWindows<T>(values: Record<string, number>, operation: () => Promise<T>): Promise<T> {
    return this.contextScope.run(values, operation);
  }

  setContextWindow(tokens: number | undefined, toolNames: string[]): void {
    this.load();
    if (tokens !== undefined && (!Number.isSafeInteger(tokens) || tokens < 1000)) throw new Error('invalid_context');
    const values = { ...this.config.context_windows };
    for (const name of toolNames) Object.defineProperty(values, name, { value: tokens ?? 0, writable: true, configurable: true, enumerable: true });
    this.config.context_windows = values;
    this.save();
  }

  // 根据当前线路获取 base URL
  get baseUrl(): string {
    return getBaseUrl(this.getEndpoint(), this.config.base_url);
  }

  // 获取配置目录路径
  get configDir(): string {
    return CONFIG_DIR;
  }

  // 获取配置文件路径
  get configFile(): string {
    return CONFIG_FILE;
  }
}

// 导出单例
export const configManager = new ConfigManager();
