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
import { runCodeBuddyWorkBuddyModelSelectionFlow } from '../wizard/flows/codebuddy-workbuddy-model-selection-flow.js';
import { uiRenderer } from '../wizard/ui/ui-renderer.js';
import { promptHelper } from '../wizard/ui/prompt-helper.js';

const CODEBUDDY_DIR = path.join(os.homedir(), '.codebuddy');
const CODEBUDDY_MODELS_FILE = path.join(CODEBUDDY_DIR, 'models.json');

const QINIU_VENDOR = 'Qiniu';
const DEFAULT_TEMPERATURE = 0.7;

export interface CodeBuddyWorkBuddyModel {
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

export interface CodeBuddyWorkBuddyConfig {
  models: CodeBuddyWorkBuddyModel[];
  availableModels: string[];
}

export class CodeBuddyWorkBuddyTool implements ITool {
  name = 'codebuddy';
  displayName = 'CodeBuddy/WorkBuddy';
  command = 'codebuddy';
  installCommand = 'npm install -g @tencent-ai/codebuddy-code';
  npmPackageName = '@tencent-ai/codebuddy-code';
  aliases = ['workbuddy'];

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

  // 移除七牛模型，保留其他供应商配置
  clearModelConfig(): void {
    const config = this.getConfig() as Partial<CodeBuddyWorkBuddyConfig>;
    if (!config.models || !Array.isArray(config.models)) {
      return;
    }
    const nonQiniuModels = config.models.filter(m => m.vendor !== QINIU_VENDOR);
    this.writeConfig({
      models: nonQiniuModels,
      availableModels: nonQiniuModels.map(m => m.id),
    });
  }

  // 根据 models.codeBuddyModels 中的 ID 列表，从市场获取详情后写入
  async loadConfig(apiKey: string, baseUrl: string, models: ModelConfig): Promise<void> {
    const modelIds = models.codeBuddyModels;
    if (!modelIds || modelIds.length === 0) {
      throw new Error(t('codebuddy_models_not_configured'));
    }

    const allModels = await marketModelService.fetchModels(baseUrl, apiKey);
    const selectedModels = allModels.filter(m => modelIds.includes(m.id));

    const existingConfig = this.getConfig() as Partial<CodeBuddyWorkBuddyConfig>;
    const nonQiniuModels = existingConfig.models?.filter(m => m.vendor !== QINIU_VENDOR) || [];

    const qiniuModels = selectedModels.map(m => this.toCodeBuddyModel(m, apiKey, baseUrl));
    const allCombined = this.deduplicateModels([...nonQiniuModels, ...qiniuModels]);

    this.writeConfig({
      models: allCombined,
      availableModels: allCombined.map(m => m.id),
    });
  }

  async unloadConfig(): Promise<void> {
    this.clearModelConfig();
  }

  // 多选要配置的市场模型，结果存入 configManager.codeBuddyModels
  async runModelConfigFlow(): Promise<void> {
    const selected = await runCodeBuddyWorkBuddyModelSelectionFlow(true);
    if (!selected || selected.length === 0) {
      return;
    }
    configManager.setModels({ codeBuddyModels: selected });
    uiRenderer.renderHeader();
    uiRenderer.renderSuccess(
      t('codebuddy_config_success', { count: selected.length.toString() }),
    );
    await promptHelper.pressEnter();
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
  ): CodeBuddyWorkBuddyModel {
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

  private writeConfig(config: CodeBuddyWorkBuddyConfig): void {
    // mkdirSync 配合 recursive: true 是幂等的，不需要预检查
    fs.mkdirSync(CODEBUDDY_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      CODEBUDDY_MODELS_FILE,
      JSON.stringify(config, null, 2) + '\n',
      { encoding: 'utf-8', mode: 0o600 },
    );
  }

  private deduplicateModels(models: CodeBuddyWorkBuddyModel[]): CodeBuddyWorkBuddyModel[] {
    const seen = new Set<string>();
    return models.filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  }
}
