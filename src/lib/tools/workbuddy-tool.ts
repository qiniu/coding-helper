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
import { readJsonObjectStrict } from '../core/safe-write.js';
import { QINIU_VENDOR, loadModelsJson, unloadModelsJson } from './models-json.js';
import { isQiniuBaseUrl } from '../endpoints.js';
import { runWorkBuddyModelSelectionFlow } from '../wizard/flows/workbuddy-model-selection-flow.js';
import { uiRenderer } from '../wizard/ui/ui-renderer.js';
import { promptHelper } from '../wizard/ui/prompt-helper.js';

const WORKBUDDY_DIR = path.join(os.homedir(), '.workbuddy');
const WORKBUDDY_MODELS_FILE = path.join(WORKBUDDY_DIR, 'models.json');

const DEFAULT_TEMPERATURE = 0.7;

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
      return readJsonObjectStrict(WORKBUDDY_MODELS_FILE);
    } catch {
      // 文件不存在或解析失败
    }
    return {};
  }

  // 桌面端也只读取 models.json，不要求应用正在运行。
  isConfigured(): boolean {
    const models = readJsonObjectStrict(WORKBUDDY_MODELS_FILE).models;
    return Array.isArray(models) && models.some(model => model && typeof model === 'object' &&
      model.vendor === QINIU_VENDOR && isQiniuBaseUrl(model.url));
  }

  // 共用写入层只撤销本工具记录的改动
  clearModelConfig(): void {
    unloadModelsJson(this.name, WORKBUDDY_MODELS_FILE);
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

    const qiniuModels = selectedModels.map(m => this.toWorkBuddyModel(m, apiKey, normalizedBaseUrl));
    loadModelsJson(this.name, WORKBUDDY_MODELS_FILE, qiniuModels);
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

}
