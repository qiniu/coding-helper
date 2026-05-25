import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import { execSync } from 'node:child_process';
import type { ITool } from './base-tool.js';
import { configManager, type ModelConfig } from '../config.js';
import { t } from '../i18n.js';
import { runHermesModelSelectionFlow } from '../wizard/flows/hermes-model-selection-flow.js';
import { uiRenderer } from '../wizard/ui/ui-renderer.js';
import { promptHelper } from '../wizard/ui/prompt-helper.js';

const HERMES_DIR = path.join(os.homedir(), '.hermes');
const HERMES_CONFIG_FILE = path.join(HERMES_DIR, 'config.yaml');
const MANAGED_MODEL_KEYS = ['provider', 'default', 'base_url', 'api_key'] as const;

// Hermes Agent 工具实现
export class HermesTool implements ITool {
  name = 'hermes';
  displayName = 'Hermes Agent';
  command = 'hermes';
  installCommand = 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash';
  updateCommand = 'hermes update';

  getVersion(): string | null {
    try {
      const output = execSync('hermes --version', { stdio: 'pipe', encoding: 'utf-8' }).trim();
      const match = output.match(/(\d+\.\d+\.\d+)/);
      return match ? match[1] : output;
    } catch {
      return null;
    }
  }

  isInstalled(): boolean {
    try {
      const command = process.platform === 'win32' ? 'where hermes' : 'which hermes';
      execSync(command, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  getConfig(): Record<string, unknown> {
    return parseYamlObject(readHermesConfig());
  }

  clearModelConfig(): void {
    writeHermesConfig(removeManagedHermesConfig(readHermesConfig()));
  }

  async loadConfig(apiKey: string, baseUrl: string, models: ModelConfig): Promise<void> {
    if (!models.hermesModel) {
      throw new Error(t('hermes_model_not_configured'));
    }
    writeHermesConfig(buildHermesConfig(readHermesConfig(), baseUrl, apiKey, models.hermesModel));
  }

  async unloadConfig(): Promise<void> {
    this.clearModelConfig();
  }

  async runModelConfigFlow(): Promise<boolean> {
    const selected = await runHermesModelSelectionFlow();
    if (!selected) {
      return false;
    }
    configManager.setModels({ hermesModel: selected });
    uiRenderer.renderHeader();
    uiRenderer.renderSuccess(t('hermes_config_success', { model: selected }));
    await promptHelper.pressEnter();
    return true;
  }

  renderModelConfigSummary(): void {
    uiRenderer.renderModelConfigItem(t('config_view_hermes_model'), configManager.getModels().hermesModel);
  }
}

export function buildHermesConfig(
  existing: string,
  baseUrl: string,
  apiKey: string,
  model: string,
): string {
  const config = parseYamlObject(existing);
  const existingModel = isRecord(config.model) ? config.model : {};
  const preservedModel = { ...existingModel };
  for (const key of MANAGED_MODEL_KEYS) {
    delete preservedModel[key];
  }

  config.model = {
    provider: 'custom',
    default: model,
    base_url: `${baseUrl.replace(/\/+$/, '')}/v1`,
    api_key: apiKey,
    ...preservedModel,
  };

  return dumpYaml(config);
}

export function removeManagedHermesConfig(existing: string): string {
  const config = parseYamlObject(existing);
  if (!isRecord(config.model)) {
    return dumpYaml(config);
  }

  const modelConfig = { ...config.model };
  for (const key of MANAGED_MODEL_KEYS) {
    delete modelConfig[key];
  }

  if (Object.keys(modelConfig).length > 0) {
    config.model = modelConfig;
  } else {
    delete config.model;
  }

  return dumpYaml(config);
}

function readHermesConfig(): string {
  try {
    if (fs.existsSync(HERMES_CONFIG_FILE)) {
      return fs.readFileSync(HERMES_CONFIG_FILE, 'utf-8');
    }
  } catch {
    // 文件不存在或读取失败时按空配置处理
  }
  return '';
}

function writeHermesConfig(content: string): void {
  fs.mkdirSync(HERMES_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(HERMES_CONFIG_FILE, content, { encoding: 'utf-8', mode: 0o600 });
  applyHermesConfigPermissions(HERMES_DIR, HERMES_CONFIG_FILE);
}

export function applyHermesConfigPermissions(configDir: string, configFile: string): void {
  if (process.platform === 'win32') {
    return;
  }
  fs.chmodSync(configDir, 0o700);
  fs.chmodSync(configFile, 0o600);
}

function parseYamlObject(content: string): Record<string, unknown> {
  if (!content.trim()) return {};
  try {
    const parsed = yaml.load(content);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function dumpYaml(config: Record<string, unknown>): string {
  if (Object.keys(config).length === 0) return '';
  return yaml.dump(config, { lineWidth: -1, noRefs: true });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
