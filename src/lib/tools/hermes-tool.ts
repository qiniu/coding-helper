import { stateStore } from '../core/state-store.js';
import { isQiniuBaseUrl } from '../endpoints.js';
import { applyConfigEdits, restoreConfigEdits } from '../core/config-transaction.js';
import { parseYamlDocument, setYamlValue, stringifyYamlDocument, deleteYamlValue } from '../core/yaml-edit.js';
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
    if (!restoreConfigEdits(this.name, [HERMES_CONFIG_FILE]) && fs.existsSync(HERMES_CONFIG_FILE)) {
      throw new Error('No restoration record for Hermes. Configuration is unchanged; remove legacy credentials manually or recover a known backup.');
    }
  }

  async loadConfig(apiKey: string, baseUrl: string, models: ModelConfig): Promise<void> {
    if (!models.hermesModel) throw new Error(t('hermes_model_not_configured'));
    stateStore.withLock(() => {
      const canonical = fs.existsSync(HERMES_DIR) ? path.join(fs.realpathSync(HERMES_DIR), 'config.yaml') : HERMES_CONFIG_FILE;
      applyConfigEdits(this.name, [{ file: HERMES_CONFIG_FILE,
        build: (current) => {
          // 校验与事务记录使用同一份快照，避免预读与正式读取之间的竞态。
          const existing = parseYamlDocument(current ?? '').toJS() as unknown;
          const model = isRecord(existing) && isRecord(existing.model) ? existing.model : undefined;
          if (!stateStore.getState(this.name, canonical) && model && isQiniuBaseUrl(model.base_url) && typeof model.api_key === 'string' && model.api_key) {
            throw new Error('Legacy Hermes credentials have no restoration record. Configuration is unchanged; remove legacy credentials manually or recover a known backup before loading.');
          }
          return buildHermesConfig(current ?? '', baseUrl, apiKey, models.hermesModel!);
        } }]);
    });
    applyHermesConfigPermissions(HERMES_DIR, HERMES_CONFIG_FILE);
  }

  async unloadConfig(): Promise<void> { this.clearModelConfig(); }

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

export function buildHermesConfig(existing: string, baseUrl: string, apiKey: string, model: string): string {
  const doc = parseYamlDocument(existing);
  for (const [key, value] of Object.entries({ provider: 'custom', default: model, base_url: baseUrl.replace(/\/+$/, '') + '/v1', api_key: apiKey })) {
    setYamlValue(doc, ['model', key], value);
  }
  return stringifyYamlDocument(doc);
}

// 仅作为纯转换函数保留兼容；实际卸载通过有记录的事务还原
export function removeManagedHermesConfig(existing: string): string {
  const doc = parseYamlDocument(existing);
  for (const key of ['provider', 'default', 'base_url', 'api_key']) deleteYamlValue(doc, ['model', key]);
  return stringifyYamlDocument(doc);
}

function readHermesConfig(): string {
  try { return fs.readFileSync(HERMES_CONFIG_FILE, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error; }
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
