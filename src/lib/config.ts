import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import { atomicWriteFile } from './core/safe-write.js';
import { DEFAULT_ENDPOINT, getBaseUrl, normalizeEndpointId } from './endpoints.js';

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

  setEndpoint(endpoint: string): void {
    this.load();
    this.config.endpoint = endpoint;
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

  // 根据当前线路获取 base URL
  get baseUrl(): string {
    return getBaseUrl(this.getEndpoint());
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
