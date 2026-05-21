import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ITool } from './base-tool.js';
import { configManager, type ModelConfig } from '../config.js';
import {
  marketModelService,
  getModelCapabilities,
  type MarketModelInfo,
} from '../market-model-service.js';
import { t } from '../i18n.js';
import { runWorkBuddyModelSelectionFlow } from '../wizard/flows/workbuddy-model-selection-flow.js';
import { uiRenderer } from '../wizard/ui/ui-renderer.js';
import { promptHelper } from '../wizard/ui/prompt-helper.js';

const WORKBUDDY_DIR = path.join(os.homedir(), '.workbuddy');
const WORKBUDDY_MODELS_FILE = path.join(WORKBUDDY_DIR, 'models.json');

const QINIU_VENDOR = 'Qiniu';
const DEFAULT_TEMPERATURE = 0.7;

// 由本工具管理的顶层字段，写回时这些字段会被覆盖；其他字段保留原值
const MANAGED_TOP_LEVEL_KEYS = new Set(['models', 'availableModels']);

export interface WorkBuddyModel {
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

export class WorkBuddyTool implements ITool {
  name = 'workbuddy';
  displayName = 'WorkBuddy';
  command = 'workbuddy';
  // WorkBuddy 是桌面端应用，不是 npm 包
  installCommand = '';
  npmPackageName = ''; // WorkBuddy 不是 npm 包

  getVersion(): string | null {
    // 桌面应用无版本号，返回 null
    return null;
  }

  isInstalled(): boolean | null {
    // WorkBuddy 是桌面端应用，无法通过命令行检测安装状态
    // 返回 null 表示"无法检测"
    return null;
  }

  getConfig(): Record<string, unknown> {
    try {
      if (fs.existsSync(WORKBUDDY_MODELS_FILE)) {
        const content = fs.readFileSync(WORKBUDDY_MODELS_FILE, 'utf-8');
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
    const nonQiniuModels = (models as WorkBuddyModel[]).filter(
      m => m.vendor !== QINIU_VENDOR,
    );
    this.writeConfig(existing, nonQiniuModels);
  }

  // 根据 models.workbuddyModels 中的 ID 列表，从市场获取详情后写入
  async loadConfig(apiKey: string, baseUrl: string, models: ModelConfig): Promise<void> {
    const modelIds = models.workbuddyModels;
    if (!modelIds || modelIds.length === 0) {
      throw new Error(t('workbuddy_models_not_configured'));
    }

    const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
    const allModels = await marketModelService.fetchModels(normalizedBaseUrl, apiKey);
    const selectedModels = allModels.filter(m => modelIds.includes(m.id));

    // 全部已配置模型都从市场消失：fail fast，避免把"七牛模型清空"伪装成 reload 成功
    if (selectedModels.length === 0) {
      throw new Error(
        t('workbuddy_all_models_unavailable', { models: modelIds.join(', ') }),
      );
    }

    // 部分缺失：渲染警告但继续写入仍然存在的模型
    const foundIds = new Set(selectedModels.map(m => m.id));
    const missingIds = modelIds.filter(id => !foundIds.has(id));
    if (missingIds.length > 0) {
      uiRenderer.renderWarning(
        t('workbuddy_models_unavailable', { models: missingIds.join(', ') }),
      );
    }

    const existing = this.getConfig();
    const existingModels = Array.isArray(existing.models)
      ? (existing.models as WorkBuddyModel[])
      : [];
    const nonQiniuModels = existingModels.filter(m => m.vendor !== QINIU_VENDOR);

    const qiniuModels = selectedModels.map(m => this.toWorkBuddyModel(m, apiKey, normalizedBaseUrl));
    const allCombined = this.deduplicateModels([...nonQiniuModels, ...qiniuModels]);

    this.writeConfig(existing, allCombined);
  }

  async unloadConfig(): Promise<void> {
    this.clearModelConfig();
  }

  // 多选要配置的市场模型，结果存入 configManager.workbuddyModels
  // 用户取消、未选或前置条件不满足时返回 false，让调用方跳过后续 loadConfig
  async runModelConfigFlow(): Promise<boolean> {
    const selected = await runWorkBuddyModelSelectionFlow();
    if (!selected || selected.length === 0) {
      return false;
    }
    configManager.setModels({ workbuddyModels: selected });
    uiRenderer.renderHeader();
    uiRenderer.renderSuccess(
      t('workbuddy_config_success', { count: selected.length.toString() }),
    );
    await promptHelper.pressEnter();
    return true;
  }

  renderModelConfigSummary(): void {
    const ids = configManager.getModels().workbuddyModels;
    const value = ids && ids.length > 0 ? ids.join(', ') : undefined;
    uiRenderer.renderModelConfigItem(t('config_view_workbuddy_models'), value);
  }

  private toWorkBuddyModel(
    market: MarketModelInfo,
    apiKey: string,
    baseUrl: string,
  ): WorkBuddyModel {
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
  private writeConfig(existing: Record<string, unknown>, models: WorkBuddyModel[]): void {
    const merged: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(existing)) {
      if (!MANAGED_TOP_LEVEL_KEYS.has(key)) {
        merged[key] = value;
      }
    }
    merged.models = models;
    merged.availableModels = models.map(m => m.id);

    // mkdirSync 配合 recursive: true 是幂等的，不需要预检查
    fs.mkdirSync(WORKBUDDY_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      WORKBUDDY_MODELS_FILE,
      JSON.stringify(merged, null, 2) + '\n',
      { encoding: 'utf-8', mode: 0o600 },
    );
  }

  private deduplicateModels(models: WorkBuddyModel[]): WorkBuddyModel[] {
    const seen = new Set<string>();
    return models.filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  }
}
