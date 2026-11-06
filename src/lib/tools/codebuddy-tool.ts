import { capContextWindow } from './openai-compat-tool.js';
import { findCommand, commandVersion } from '../../utils/find-command.js';
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
import { runCodeBuddyModelSelectionFlow } from '../wizard/flows/codebuddy-model-selection-flow.js';
import { uiRenderer } from '../wizard/ui/ui-renderer.js';
import { promptHelper } from '../wizard/ui/prompt-helper.js';

const CODEBUDDY_DIR = path.join(os.homedir(), '.codebuddy');
const CODEBUDDY_MODELS_FILE = path.join(CODEBUDDY_DIR, 'models.json');

const DEFAULT_TEMPERATURE = 0.7;

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
  supportsPreview = true;
  requiresModelSelection = true;
  name = 'codebuddy';
  displayName = 'CodeBuddy';
  command = 'codebuddy';
  searchPaths?: string[];
  installCommand = 'npm install -g @tencent-ai/codebuddy-code';
  npmPackageName = '@tencent-ai/codebuddy-code';

  getVersion(): string | null { const file = findCommand(this.command, this.searchPaths); return file ? commandVersion(file) : null; }

  isInstalled(): boolean { return !!findCommand(this.command, this.searchPaths); }

  getConfig(): Record<string, unknown> {
    try {
      return readJsonObjectStrict(CODEBUDDY_MODELS_FILE);
    } catch {
      // 文件不存在或解析失败
    }
    return {};
  }

  // 同时检查厂商和地址，用户手动切换的条目不算七牛接入。
  isConfigured(): boolean {
    const models = readJsonObjectStrict(CODEBUDDY_MODELS_FILE).models;
    return Array.isArray(models) && models.some(model => model && typeof model === 'object' &&
      model.vendor === QINIU_VENDOR && isQiniuBaseUrl(model.url));
  }

  // 共用写入层只撤销本工具记录的改动
  clearModelConfig(): void {
    unloadModelsJson(this.name, CODEBUDDY_MODELS_FILE);
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

    const qiniuModels = selectedModels.map(m => this.toCodeBuddyModel(m, apiKey, normalizedBaseUrl));
    loadModelsJson(this.name, CODEBUDDY_MODELS_FILE, qiniuModels);
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
      maxInputTokens: capContextWindow(caps.maxInputTokens, this.name),
      maxOutputTokens: configManager.getContextWindow(this.name) === undefined ? caps.maxOutputTokens : Math.min(caps.maxOutputTokens, Math.floor(capContextWindow(caps.maxInputTokens, this.name) / 2)),
      temperature: DEFAULT_TEMPERATURE,
      supportsToolCall: caps.toolCall,
      supportsImages: caps.images,
    };
  }

}
