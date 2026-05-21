import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import type { ITool } from './base-tool.js';
import { configManager, type ModelConfig } from '../config.js';
import {
  marketModelService,
  getModelCapabilities,
  type MarketModelInfo,
} from '../market-model-service.js';
import { t } from '../i18n.js';
import { runCodeBuddyModelSelectionFlow } from '../wizard/flows/codebuddy-model-selection-flow.js';
import { uiRenderer } from '../wizard/ui/ui-renderer.js';
import { promptHelper } from '../wizard/ui/prompt-helper.js';

const CODEBUDDY_DIR = path.join(os.homedir(), '.codebuddy');
const CODEBUDDY_MODELS_FILE = path.join(CODEBUDDY_DIR, 'models.json');

const QINIU_VENDOR = 'Qiniu';
const DEFAULT_TEMPERATURE = 0.7;

// 由本工具管理的顶层字段，写回时这些字段会被覆盖；其他字段保留原值
const MANAGED_TOP_LEVEL_KEYS = new Set(['models', 'availableModels']);

export interface CodeBuddyModel {
  id: string;
  name: string;
  vendor: string;
  url: string;
  apiKey: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  temperature: number;
  supportsToolCall: boolean;
  supportsImages: boolean;
}

export class CodeBuddyTool implements ITool {
  name = 'codebuddy';
  displayName = 'CodeBuddy';
  command = 'codebuddy';
  installCommand = 'npm install -g @tencent-ai/codebuddy-code';
  npmPackageName = '@tencent-ai/codebuddy-code';

  getVersion(): string | null {
    try {
      const output = execSync('codebuddy --version', { stdio: 'pipe', encoding: 'utf-8' }).trim();
      const match = output.match(/(\d+\.\d+\.\d+)/);
      return match ? match[1] : output;
    } catch {
      return null;
    }
  }

  isInstalled(): boolean {
    try {
      const command = process.platform === 'win32' ? 'where codebuddy' : 'which codebuddy';
      execSync(command, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  getConfig(): Record<string, unknown> {
    try {
      if (fs.existsSync(CODEBUDDY_MODELS_FILE)) {
        const content = fs.readFileSync(CODEBUDDY_MODELS_FILE, 'utf-8');
        return JSON.parse(content) as Record<string, unknown>;
      }
    } catch {
      // 文件不存在或解析失败
    }
    return {};
  }

  // 移除七牛模型，保留其他供应商配置及用户其他自定义字段
  clearModelConfig(): void {
    const existing = this.getConfig();
    const models = existing.models;
    if (!Array.isArray(models)) {
      return;
    }
    const nonQiniuModels = (models as CodeBuddyModel[]).filter(
      m => m.vendor !== QINIU_VENDOR,
    );
    this.writeConfig(existing, nonQiniuModels);
  }

  // 根据 models.codeBuddyModels 中的 ID 列表，从市场获取详情后写入
  async loadConfig(apiKey: string, baseUrl: string, models: ModelConfig): Promise<void> {
    const modelIds = models.codeBuddyModels;
    if (!modelIds || modelIds.length === 0) {
      throw new Error(t('codebuddy_models_not_configured'));
    }

    const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
    const allModels = await marketModelService.fetchModels(normalizedBaseUrl, apiKey);
    const selectedModels = allModels.filter(m => modelIds.includes(m.id));

    // 全部已配置模型都从市场消失：fail fast，避免把"七牛模型清空"伪装成 reload 成功
    if (selectedModels.length === 0) {
      throw new Error(
        t('codebuddy_all_models_unavailable', { models: modelIds.join(', ') }),
      );
    }

    // 部分缺失：渲染警告但继续写入仍然存在的模型
    const foundIds = new Set(selectedModels.map(m => m.id));
    const missingIds = modelIds.filter(id => !foundIds.has(id));
    if (missingIds.length > 0) {
      uiRenderer.renderWarning(
        t('codebuddy_models_unavailable', { models: missingIds.join(', ') }),
      );
    }

    const existing = this.getConfig();
    const existingModels = Array.isArray(existing.models)
      ? (existing.models as CodeBuddyModel[])
      : [];
    const nonQiniuModels = existingModels.filter(m => m.vendor !== QINIU_VENDOR);

    const qiniuModels = selectedModels.map(m => this.toCodeBuddyModel(m, apiKey, normalizedBaseUrl));
    const allCombined = this.deduplicateModels([...nonQiniuModels, ...qiniuModels]);

    this.writeConfig(existing, allCombined);
  }

  async unloadConfig(): Promise<void> {
    this.clearModelConfig();
  }

  // 多选要配置的市场模型，结果存入 configManager.codeBuddyModels
  // 用户取消、未选或前置条件不满足时返回 false，让调用方跳过后续 loadConfig
  async runModelConfigFlow(): Promise<boolean> {
    const selected = await runCodeBuddyModelSelectionFlow();
    if (!selected || selected.length === 0) {
      return false;
    }
    configManager.setModels({ codeBuddyModels: selected });
    uiRenderer.renderHeader();
    uiRenderer.renderSuccess(
      t('codebuddy_config_success', { count: selected.length.toString() }),
    );
    await promptHelper.pressEnter();
    return true;
  }

  renderModelConfigSummary(): void {
    const ids = configManager.getModels().codeBuddyModels;
    const value = ids && ids.length > 0 ? ids.join(', ') : undefined;
    uiRenderer.renderModelConfigItem(t('config_view_codebuddy_models'), value);
  }

  private toCodeBuddyModel(
    market: MarketModelInfo,
    apiKey: string,
    baseUrl: string,
  ): CodeBuddyModel {
    const caps = getModelCapabilities(market);
    return {
      id: market.id,
      name: market.name,
      vendor: QINIU_VENDOR,
      url: `${baseUrl}/v1/chat/completions`,
      apiKey,
      maxInputTokens: caps.maxInputTokens,
      maxOutputTokens: caps.maxOutputTokens,
      temperature: DEFAULT_TEMPERATURE,
      supportsToolCall: caps.toolCall,
      supportsImages: caps.images,
    };
  }

  // 合并写入：保留用户在 models.json 里手动添加的其他顶层字段，仅覆盖 models / availableModels
  private writeConfig(existing: Record<string, unknown>, models: CodeBuddyModel[]): void {
    const merged: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(existing)) {
      if (!MANAGED_TOP_LEVEL_KEYS.has(key)) {
        merged[key] = value;
      }
    }
    merged.models = models;
    merged.availableModels = models.map(m => m.id);

    // mkdirSync 配合 recursive: true 是幂等的，不需要预检查
    fs.mkdirSync(CODEBUDDY_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      CODEBUDDY_MODELS_FILE,
      JSON.stringify(merged, null, 2) + '\n',
      { encoding: 'utf-8', mode: 0o600 },
    );
  }

  private deduplicateModels(models: CodeBuddyModel[]): CodeBuddyModel[] {
    const seen = new Set<string>();
    return models.filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  }
}
