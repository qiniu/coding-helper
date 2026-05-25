import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import { DEFAULT_ENDPOINT, getBaseUrl } from './endpoints.js';

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
        this.config = (yaml.load(content) as Config) || {};
      }
    } catch {
      this.config = {};
    }
    this.loaded = true;
  }

  // 保存配置
  private save(): void {
    this.ensureDir();
    const content = yaml.dump(this.config, { lineWidth: -1 });
    fs.writeFileSync(CONFIG_FILE, content, { encoding: 'utf-8', mode: 0o600 });
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
    return this.config.endpoint || DEFAULT_ENDPOINT;
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

  // 清除所有配置，直接删除配置文件夹
  clearConfig(): void {
    this.config = {};
    this.loaded = false;
    if (fs.existsSync(CONFIG_DIR)) {
      fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
    }
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
