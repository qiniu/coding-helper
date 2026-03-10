import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import type { ITool } from './base-tool.js';
import type { ModelConfig } from '../config.js';
import { t } from '../i18n.js';

// API 超时时间：50 分钟，适配长时间推理请求
const API_TIMEOUT = '3000000';

// Claude Code 的环境变量 key 列表
const CLAUDE_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'API_TIMEOUT_MS',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
];

// Claude Code 配置文件路径
const CLAUDE_SETTINGS_DIR = path.join(os.homedir(), '.claude');
const CLAUDE_SETTINGS_FILE = path.join(CLAUDE_SETTINGS_DIR, 'settings.json');
const CLAUDE_JSON_FILE = path.join(os.homedir(), '.claude.json');

// Claude Code 工具实现
export class ClaudeCodeTool implements ITool {
  name = 'claude-code';
  displayName = 'Claude Code';
  command = 'claude';
  installCommand = 'npm install -g @anthropic-ai/claude-code';
  updateCommand = 'claude update';
  npmPackageName = '@anthropic-ai/claude-code';

  // 获取已安装的 Claude Code 版本
  getVersion(): string | null {
    try {
      const output = execSync('claude --version', { stdio: 'pipe', encoding: 'utf-8' }).trim();
      // 提取语义化版本号（兼容 "1.0.23" 或 "claude v1.0.23" 等格式）
      const match = output.match(/(\d+\.\d+\.\d+)/);
      return match ? match[1] : output;
    } catch {
      return null;
    }
  }

  // 检查 claude 命令是否可用
  isInstalled(): boolean {
    try {
      execSync('which claude', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  // 读取当前 Claude Code settings.json
  getConfig(): Record<string, unknown> {
    try {
      if (fs.existsSync(CLAUDE_SETTINGS_FILE)) {
        const content = fs.readFileSync(CLAUDE_SETTINGS_FILE, 'utf-8');
        return JSON.parse(content) as Record<string, unknown>;
      }
    } catch {
      // 文件不存在或解析失败
    }
    return {};
  }

  // 保存模型配置到 Claude Code settings.json
  async saveModelConfig(config: ModelConfig): Promise<void> {
    const settings = this.getConfig();
    const env = (settings.env as Record<string, string>) || {};

    if (config.haikuModel) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = config.haikuModel;
    if (config.sonnetModel) env.ANTHROPIC_DEFAULT_SONNET_MODEL = config.sonnetModel;
    if (config.opusModel) env.ANTHROPIC_DEFAULT_OPUS_MODEL = config.opusModel;
    if (config.subagentModel) env.CLAUDE_CODE_SUBAGENT_MODEL = config.subagentModel;

    settings.env = env;
    this.writeSettings(settings);
  }

  // 获取当前模型配置
  getModelConfig(): ModelConfig | null {
    const settings = this.getConfig();
    const env = settings.env as Record<string, string> | undefined;
    if (!env) return null;

    return {
      haikuModel: env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
      sonnetModel: env.ANTHROPIC_DEFAULT_SONNET_MODEL,
      opusModel: env.ANTHROPIC_DEFAULT_OPUS_MODEL,
      subagentModel: env.CLAUDE_CODE_SUBAGENT_MODEL,
    };
  }

  // 清除所有七牛相关环境变量
  clearModelConfig(): void {
    const settings = this.getConfig();
    const env = (settings.env as Record<string, string>) || {};

    for (const key of CLAUDE_ENV_KEYS) {
      delete env[key];
    }

    settings.env = env;
    delete settings.companyAnnouncements;
    delete settings.attribution;
    this.writeSettings(settings);
  }

  // 将完整配置写入 Claude Code
  async loadConfig(apiKey: string, baseUrl: string, models: ModelConfig): Promise<void> {
    // 确保目录存在
    if (!fs.existsSync(CLAUDE_SETTINGS_DIR)) {
      fs.mkdirSync(CLAUDE_SETTINGS_DIR, { recursive: true, mode: 0o700 });
    }

    // 读取现有配置，保留其他字段
    const settings = this.getConfig();
    const env = (settings.env as Record<string, string>) || {};

    // 写入七牛配置
    env.ANTHROPIC_BASE_URL = baseUrl;
    env.ANTHROPIC_AUTH_TOKEN = apiKey;
    env.API_TIMEOUT_MS = API_TIMEOUT;
    // 禁用非必要流量，第三方端点不需要 Anthropic 遥测
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';

    // 写入模型配置
    if (models.haikuModel) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = models.haikuModel;
    if (models.sonnetModel) env.ANTHROPIC_DEFAULT_SONNET_MODEL = models.sonnetModel;
    if (models.opusModel) env.ANTHROPIC_DEFAULT_OPUS_MODEL = models.opusModel;
    if (models.subagentModel) env.CLAUDE_CODE_SUBAGENT_MODEL = models.subagentModel;

    settings.env = env;

    // 写入公司公告（使用当前语言）
    settings.companyAnnouncements = [
      t('company_announcement'),
    ];

    // 禁用归属标注，通过代理端点运行时标注信息不准确
    settings.attribution = {
      commit: '',
      pr: '',
    };

    this.writeSettings(settings);

    // 写入 ~/.claude.json，设置 onboarding 完成标记
    this.writeClaudeJson();
  }

  // 从 Claude Code 移除配置
  unloadConfig(): void {
    this.clearModelConfig();
  }

  // 写入 settings.json
  private writeSettings(settings: Record<string, unknown>): void {
    if (!fs.existsSync(CLAUDE_SETTINGS_DIR)) {
      fs.mkdirSync(CLAUDE_SETTINGS_DIR, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(CLAUDE_SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
  }

  // 写入 ~/.claude.json
  private writeClaudeJson(): void {
    let data: Record<string, unknown> = {};
    try {
      if (fs.existsSync(CLAUDE_JSON_FILE)) {
        const content = fs.readFileSync(CLAUDE_JSON_FILE, 'utf-8');
        data = JSON.parse(content) as Record<string, unknown>;
      }
    } catch {
      // 文件不存在或解析失败
    }

    data.hasCompletedOnboarding = true;
    fs.writeFileSync(CLAUDE_JSON_FILE, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
  }
}
