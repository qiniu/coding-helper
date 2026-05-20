import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import type { ITool } from './base-tool.js';
import type { ModelConfig } from '../config.js';

const OPENCLAW_DIR = path.join(os.homedir(), '.openclaw');
const OPENCLAW_CONFIG_FILE = path.join(OPENCLAW_DIR, 'openclaw.json');
const PROVIDER_NAME = 'qnaigc';
const API_KEY_ENV_NAME = 'QINIU_API_KEY';
const PROVIDER_ALIAS = 'Qiniu';

type OpenClawOperation = string[];

// OpenClaw 工具实现
export class OpenClawTool implements ITool {
  name = 'openclaw';
  displayName = 'OpenClaw';
  command = 'openclaw';
  installCommand = 'npm install -g openclaw@latest';
  updateCommand = 'npm install -g openclaw@latest';
  npmPackageName = 'openclaw';

  getVersion(): string | null {
    try {
      const output = execFileSync('openclaw', ['--version'], { stdio: 'pipe', encoding: 'utf-8' }).trim();
      const match = output.match(/(\d+\.\d+\.\d+)/);
      return match ? match[1] : output;
    } catch {
      return null;
    }
  }

  isInstalled(): boolean {
    try {
      const command = process.platform === 'win32' ? 'where' : 'which';
      execFileSync(command, ['openclaw'], { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  getConfig(): Record<string, unknown> {
    return {
      configPath: getOpenClawConfigPath(),
      configured: this.getModelConfig()?.sonnetModel?.startsWith(`${PROVIDER_NAME}/`) || hasOpenClawConfigFile(),
      modelConfig: this.getModelConfig(),
    };
  }

  async saveModelConfig(config: ModelConfig): Promise<void> {
    const model = getOpenClawModel(config);
    if (!model) return;
    runOpenClawOperations([
      ['config', 'set', 'agents.defaults.model.primary', JSON.stringify(buildOpenClawModelRef(model)), '--strict-json'],
      ['config', 'set', buildOpenClawModelAliasPath(buildOpenClawModelRef(model)), JSON.stringify({ alias: PROVIDER_ALIAS }), '--strict-json'],
    ]);
  }

  getModelConfig(): ModelConfig | null {
    const primary = getOpenClawConfigValue('agents.defaults.model.primary');
    if (!primary?.startsWith(`${PROVIDER_NAME}/`)) return null;
    return { sonnetModel: primary.slice(`${PROVIDER_NAME}/`.length) };
  }

  clearModelConfig(): void {
    runOpenClawOperations(buildOpenClawUnloadOperations(getOpenClawConfigValue('agents.defaults.model.primary')));
  }

  async loadConfig(apiKey: string, baseUrl: string, models: ModelConfig): Promise<void> {
    const model = getOpenClawModel(models);
    if (!model) return;
    runOpenClawOperations(buildOpenClawLoadOperations(apiKey, baseUrl, model));
  }

  unloadConfig(): void {
    this.clearModelConfig();
  }
}

export function buildOpenClawProviderConfig(baseUrl: string, model: string): Record<string, unknown> {
  return {
    baseUrl: `${baseUrl.replace(/\/+$/, '')}/v1`,
    apiKey: `\${${API_KEY_ENV_NAME}}`,
    api: 'openai-completions',
    models: [
      {
        id: model,
        name: model,
      },
    ],
  };
}

export function buildOpenClawModelRef(model: string): string {
  return `${PROVIDER_NAME}/${model}`;
}

export function buildOpenClawLoadOperations(apiKey: string, baseUrl: string, model: string): OpenClawOperation[] {
  const modelRef = buildOpenClawModelRef(model);
  return [
    ['config', 'set', `env.${API_KEY_ENV_NAME}`, JSON.stringify(apiKey), '--strict-json'],
    ['config', 'set', 'models.mode', JSON.stringify('merge'), '--strict-json'],
    ['config', 'set', `models.providers.${PROVIDER_NAME}`, JSON.stringify(buildOpenClawProviderConfig(baseUrl, model)), '--strict-json'],
    ['config', 'set', 'agents.defaults.model.primary', JSON.stringify(modelRef), '--strict-json'],
    ['config', 'set', buildOpenClawModelAliasPath(modelRef), JSON.stringify({ alias: PROVIDER_ALIAS }), '--strict-json'],
  ];
}

export function buildOpenClawUnloadOperations(currentModelRef?: string | null): OpenClawOperation[] {
  const operations = [
    ['config', 'unset', `env.${API_KEY_ENV_NAME}`],
    ['config', 'unset', `models.providers.${PROVIDER_NAME}`],
  ];

  if (currentModelRef?.startsWith(`${PROVIDER_NAME}/`)) {
    operations.push(
      ['config', 'unset', 'agents.defaults.model.primary'],
      ['config', 'unset', buildOpenClawModelAliasPath(currentModelRef)],
    );
  }

  return operations;
}

function buildOpenClawModelAliasPath(modelRef: string): string {
  return `agents.defaults.models[${JSON.stringify(modelRef)}]`;
}

function getOpenClawModel(models: ModelConfig): string | undefined {
  return models.sonnetModel || models.opusModel || models.haikuModel || models.subagentModel;
}

function getOpenClawConfigValue(pathName: string): string | null {
  try {
    const output = execFileSync('openclaw', ['config', 'get', pathName], { stdio: 'pipe', encoding: 'utf-8' }).trim();
    return parseOpenClawConfigValue(output);
  } catch {
    return null;
  }
}

function parseOpenClawConfigValue(value: string): string {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'string' ? parsed : value;
  } catch {
    return value;
  }
}

function runOpenClawOperations(operations: OpenClawOperation[]): void {
  for (const args of operations) {
    execFileSync('openclaw', args, { stdio: 'pipe' });
  }
}

function getOpenClawConfigPath(): string {
  return process.env.OPENCLAW_CONFIG_PATH || OPENCLAW_CONFIG_FILE;
}

function hasOpenClawConfigFile(): boolean {
  try {
    return fs.existsSync(getOpenClawConfigPath());
  } catch {
    return false;
  }
}
