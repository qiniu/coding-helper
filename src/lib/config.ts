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
export interface ProfileEntry {
  api_key: string;
  endpoint: string;
  base_url?: string;
}

export interface Profile {
  name: string;
  apiKey: string;
  endpoint: string;
  baseUrl: string;
}

// 一个工具实际使用的连接
export interface Connection {
  apiKey?: string;
  endpoint: string;
  baseUrl: string;
  profile?: string;
}

interface Config {
  lang?: string;
  endpoint?: string;
  base_url?: string;
  profile?: string;
  profiles?: Record<string, ProfileEntry>;
  tool_profiles?: Record<string, string>;
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
    this.registerCustomUrls();
  }

  // 保存配置
  private registerCustomUrls(): void {
    registerCustomBaseUrls([this.config.base_url, ...Object.values(this.config.profiles ?? {}).map(entry => entry.base_url)].filter((url): url is string => !!url));
  }

  private save(): void {
    this.registerCustomUrls();
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
    this.syncActiveProfile();
    this.registerCustomUrls();
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
    this.syncActiveProfile();
    this.save();
  }

  revokeApiKey(): void {
    this.load();
    delete this.config.api_key;
    const active = this.getActiveProfile();
    if (active) this.config.profiles![active].api_key = '';
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
  saveSettings(apiKey: string, endpoint: string, models: ModelConfig, settings: { contexts?: Record<string, number>; toolNames?: string[]; profile?: string; baseUrl?: string } = {}): void {
    this.load();
    const savesCurrent = !settings.profile || settings.profile === this.config.profile;
    const next: Config = { ...this.config, ...models, ...(savesCurrent ? { api_key: apiKey, endpoint } : {}) };
    if (models.claudeCode) next.claudeCode = { ...this.config.claudeCode, ...models.claudeCode };
    if (models.toolModels) next.toolModels = { ...this.config.toolModels, ...models.toolModels };
    if (savesCurrent && endpoint === CUSTOM_ENDPOINT) next.base_url = getBaseUrl(endpoint, settings.baseUrl ?? next.base_url);
    else if (savesCurrent && endpoint !== CUSTOM_ENDPOINT) delete next.base_url;
    if (settings.toolNames) {
      const bindings = { ...next.tool_profiles };
      for (const tool of settings.toolNames) {
        if (settings.profile && settings.profile !== next.profile) bindings[tool] = settings.profile;
        else delete bindings[tool];
      }
      next.tool_profiles = bindings;
      if (!settings.profile) delete next.profile;
    }
    if (settings.contexts) next.context_windows = { ...next.context_windows, ...settings.contexts };
    this.ensureDir();
    atomicWriteFile(CONFIG_FILE, yaml.dump(next, { lineWidth: -1 }));
    this.config = next;
    this.registerCustomUrls();
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

  getActiveProfile(): string | undefined {
    this.load();
    const name = this.config.profile;
    return name && (name && Object.hasOwn(this.config.profiles ?? {}, name) ? this.config.profiles![name] : undefined) ? name : undefined;
  }

  listProfiles(): Profile[] {
    this.load();
    return Object.entries(this.config.profiles ?? {}).map(([name, p]) => toProfile(name, p));
  }

  getProfile(name: string): Profile | undefined {
    this.load();
    const entry = (name && Object.hasOwn(this.config.profiles ?? {}, name) ? this.config.profiles![name] : undefined);
    return entry ? toProfile(name, entry) : undefined;
  }

  saveProfile(name: string, apiKey: string, endpoint: string, baseUrl?: string): void {
    this.load();
    validateProfileName(name);
    const normalizedUrl = getBaseUrl(endpoint, baseUrl);
    this.config.profiles = {
      ...this.config.profiles,
      [name]: { api_key: apiKey, endpoint, ...(endpoint === CUSTOM_ENDPOINT && baseUrl ? { base_url: normalizedUrl } : {}) },
    };
    // 正在用的配置档被修改时，顶层连接一起更新
    if (this.config.profile === name) this.copyProfileToTop(name);
    this.save();
  }

  removeProfile(name: string): void {
    this.load();
    if (!(name && Object.hasOwn(this.config.profiles ?? {}, name) ? this.config.profiles![name] : undefined)) return;
    delete this.config.profiles![name];
    if (Object.keys(this.config.profiles!).length === 0) delete this.config.profiles;
    if (this.config.profile === name) delete this.config.profile;
    for (const [tool, profile] of Object.entries(this.config.tool_profiles ?? {})) {
      if (profile === name) delete this.config.tool_profiles![tool];
    }
    this.save();
  }

  // 切换当前配置档：顶层连接改为它，取消所有工具的单独绑定
  useProfile(name: string): void {
    this.load();
    if (!(name && Object.hasOwn(this.config.profiles ?? {}, name) ? this.config.profiles![name] : undefined)) throw new Error(`Profile not found: ${name}`);
    this.config.profile = name;
    this.copyProfileToTop(name);
    delete this.config.tool_profiles;
    this.save();
  }

  getToolProfile(toolName: string): string | undefined {
    this.load();
    const name = this.config.tool_profiles?.[toolName];
    return name && (name && Object.hasOwn(this.config.profiles ?? {}, name) ? this.config.profiles![name] : undefined) ? name : undefined;
  }

  // 把单个工具绑定到某个配置档；与当前配置档相同或传 undefined 时解除绑定
  setToolProfile(toolName: string, name: string | undefined): void {
    this.load();
    if (name && !this.getProfile(name)) throw new Error('Profile not found');
    const tools = { ...this.config.tool_profiles };
    if (name && name !== this.config.profile) tools[toolName] = name;
    else delete tools[toolName];
    this.config.tool_profiles = Object.keys(tools).length ? tools : undefined;
    if (!this.config.tool_profiles) delete this.config.tool_profiles;
    this.save();
  }

  // 工具实际使用的连接：单独绑定了配置档的用它，否则用当前连接
  getConnection(toolName?: string): Connection {
    const pinned = toolName ? this.getToolProfile(toolName) : undefined;
    if (pinned) {
      const p = this.getProfile(pinned)!;
      return { apiKey: p.apiKey, endpoint: p.endpoint, baseUrl: p.baseUrl, profile: pinned };
    }
    return { apiKey: this.getApiKey(), endpoint: this.getEndpoint(), baseUrl: this.baseUrl, profile: this.getActiveProfile() };
  }

  private copyProfileToTop(name: string): void {
    const p = this.config.profiles![name];
    this.config.api_key = p.api_key;
    this.config.endpoint = p.endpoint;
    if (p.base_url) this.config.base_url = p.base_url;
    else delete this.config.base_url;
  }

  // 修改当前 Key / 线路时，同步写回当前配置档
  private syncActiveProfile(): void {
    const name = this.config.profile;
    if (!name || !(name && Object.hasOwn(this.config.profiles ?? {}, name) ? this.config.profiles![name] : undefined) || !this.config.api_key) return;
    this.config.profiles![name] = {
      api_key: this.config.api_key,
      endpoint: this.config.endpoint || DEFAULT_ENDPOINT,
      ...(this.config.base_url ? { base_url: this.config.base_url } : {}),
    };
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

function toProfile(name: string, entry: ProfileEntry): Profile {
  const endpoint = normalizeEndpointId(entry.endpoint || DEFAULT_ENDPOINT);
  const baseUrl = getBaseUrl(endpoint, entry.base_url);
  return { name, apiKey: entry.api_key, endpoint, baseUrl };
}

function validateProfileName(name: string): void {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('Invalid profile name');
}

// 导出单例
export const configManager = new ConfigManager();
