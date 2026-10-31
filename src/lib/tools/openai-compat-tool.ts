import fs from 'node:fs';
import { restoreConfigEdits } from '../core/config-transaction.js';
import { findCommand, commandVersion } from '../../utils/find-command.js';
import type { ITool } from './base-tool.js';
import { configManager, type ModelConfig } from '../config.js';
import { marketModelService } from '../market-model-service.js';
import { getModelCapabilities } from '../market-model-service.js';
import { t } from '../i18n.js';
import { uiRenderer } from '../wizard/ui/ui-renderer.js';
import { promptHelper } from '../wizard/ui/prompt-helper.js';
import { runGenericModelSelectionFlow } from '../wizard/flows/generic-model-selection-flow.js';

// 七牛 OpenAI 兼容接口地址
export function openAIBaseUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/v1`;
}

export interface ModelLimits {
  // false 表示离线回退，不能覆盖已知限额。
  verified?: boolean;
  contextOverride?: boolean;
  contextWindow: number;
  maxOutputTokens: number;
  reasoning?: boolean;
  modalities?: { input: string[]; output: string[] };
}

const FALLBACK_LIMITS: ModelLimits = { contextWindow: 128000, maxOutputTokens: 8192, verified: false };

// 尽力从模型市场获取上下文与输出上限，失败时使用保守的默认值
export function capContextWindow(modelMax: number, toolName?: string, override = configManager.getContextWindow(toolName)): number {
  return override === undefined ? modelMax : Math.min(modelMax, override);
}

// 离线时沿用客户端已经验证过的限额；用户上限只能继续收窄。
export function effectiveContextLimit(limits: ModelLimits, known: unknown): number {
  const inherited = limits.verified === false && typeof known === 'number' && Number.isFinite(known) && known > 0 ? known : limits.contextWindow;
  return limits.contextOverride ? Math.min(inherited, limits.contextWindow) : inherited;
}
export function effectiveOutputLimit(limits: ModelLimits, known: unknown, context: number): number {
  const inherited = limits.verified === false && typeof known === 'number' && Number.isFinite(known) && known > 0 ? known : limits.maxOutputTokens;
  return limits.contextOverride ? Math.min(inherited, Math.floor(context / 2)) : inherited;
}

export async function fetchModelLimits(baseUrl: string, apiKey: string, model: string, toolName?: string): Promise<ModelLimits> {
  const limits = await fetchUncappedModelLimits(baseUrl, apiKey, model);
  const cap = configManager.getContextWindow(toolName);
  if (cap === undefined) return limits;
  const contextWindow = capContextWindow(limits.contextWindow, toolName, cap);
  return { ...limits, contextWindow, maxOutputTokens: Math.min(limits.maxOutputTokens, Math.floor(contextWindow / 2)), contextOverride: true };
}

async function fetchUncappedModelLimits(baseUrl: string, apiKey: string, model: string): Promise<ModelLimits> {
  try {
    const models = await marketModelService.fetchModels(baseUrl.replace(/\/+$/, ''), apiKey);
    const info = models.find((m) => m.id === model);
    if (!info) return FALLBACK_LIMITS;
    const caps = getModelCapabilities(info);
    const supported = new Set(['text', 'image', 'audio', 'video', 'pdf']);
    const modalities = (values: unknown): string[] => {
      const filtered = Array.isArray(values) ? values.filter((v): v is string => typeof v === 'string' && supported.has(v)) : [];
      return filtered.length ? [...new Set(filtered)] : ['text'];
    };
    return {
      contextWindow: caps.maxInputTokens,
      maxOutputTokens: caps.maxOutputTokens,
      reasoning: caps.reasoning,
      modalities: {
        input: modalities(info.architecture?.input_modalities),
        output: modalities(info.architecture?.output_modalities),
      },
    };
  } catch {
    return FALLBACK_LIMITS;
  }
}

// 通用 OpenAI 兼容客户端的公共部分：命令检测、模型选择与展示
export abstract class OpenAICompatTool implements ITool {
  requiresModelSelection = true;
  supportsPreview = false;
  abstract name: string;
  abstract displayName: string;
  abstract command: string;
  abstract installCommand: string;
  aliases?: string[];
  searchPaths?: string[];
  updateCommand?: string;
  npmPackageName?: string;

  isInstalled(): boolean { return !!findCommand(this.command, this.searchPaths); }

  getVersion(): string | null { const file = findCommand(this.command, this.searchPaths); return file ? commandVersion(file) : null; }

  // 本工具使用的模型：单独选择过的优先，否则用通用默认模型
  protected resolveModel(models: ModelConfig): string {
    const model = models.toolModels?.[this.name] ?? models.defaultModel;
    if (!model) throw new Error(t('generic_model_not_configured', { tool: this.displayName }));
    return model;
  }

  async runModelConfigFlow(): Promise<boolean> {
    const selected = await runGenericModelSelectionFlow(this.name, this.displayName);
    if (!selected) return false;
    uiRenderer.renderHeader();
    uiRenderer.renderSuccess(t('generic_config_success', { tool: this.displayName, model: selected }));
    await promptHelper.pressEnter();
    return true;
  }

  renderModelConfigSummary(): void {
    const models = configManager.getModels();
    uiRenderer.renderModelConfigItem(t('config_view_model'), models.toolModels?.[this.name] ?? models.defaultModel);
  }

  async clearModelConfig(): Promise<void> {
    await this.unloadConfig();
  }

  // 无恢复记录时保留旧配置，同时阻止菜单误报凭据已移除。
  protected restoreManagedConfig(files: string[]): void {
    if (restoreConfigEdits(this.name, files)) return;
    const exists = files.some(file => {
      try { fs.lstatSync(file); return true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
    });
    if (exists) throw new Error('No restoration record for ' + this.displayName + '. Configuration is unchanged; remove legacy credentials manually or recover a known backup.');
  }

  abstract getConfig(): Record<string, unknown>;
  abstract isConfigured(): boolean;
  abstract loadConfig(apiKey: string, baseUrl: string, models: ModelConfig): Promise<void>;
  abstract unloadConfig(): void | Promise<void>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// 按点分路径读取嵌套值
function pathKeys(keyPath: string): string[] {
  const keys = keyPath.split('.');
  if (keys.some(key => !key || ['__proto__', 'prototype', 'constructor'].includes(key))) {
    throw new Error('Unsafe configuration path: ' + keyPath);
  }
  return keys;
}

export function getPath(target: Record<string, unknown>, keyPath: string): unknown {
  let current: unknown = target;
  for (const key of pathKeys(keyPath)) {
    if (!isRecord(current)) return undefined;
    const property = Object.getOwnPropertyDescriptor(current, key);
    if (!property || !('value' in property)) return undefined;
    current = property.value;
  }
  return current;
}

// 按点分路径写入嵌套值，中间对象不存在时创建
export function setPath(target: Record<string, unknown>, keyPath: string, value: unknown): void {
  const keys = pathKeys(keyPath);
  let current = target;
  for (const key of keys.slice(0, -1)) {
    const property = Object.getOwnPropertyDescriptor(current, key);
    if (!property || !('value' in property) || !isRecord(property.value)) {
      Object.defineProperty(current, key, { value: {}, writable: true, configurable: true, enumerable: true });
    }
    current = current[key] as Record<string, unknown>;
  }
  Object.defineProperty(current, keys[keys.length - 1], { value, writable: true, configurable: true, enumerable: true });
}

// 按原值还原：null/undefined 时删除，并清理因此变空的中间对象
export function restorePath(target: Record<string, unknown>, keyPath: string, prior: unknown): void {
  const keys = pathKeys(keyPath);
  if (prior !== null && prior !== undefined) {
    setPath(target, keyPath, prior);
    return;
  }
  const chain: Record<string, unknown>[] = [target];
  for (const key of keys.slice(0, -1)) {
    const property = Object.getOwnPropertyDescriptor(chain[chain.length - 1], key);
    if (!property || !('value' in property)) return;
    const next = property.value;
    if (!isRecord(next)) return;
    chain.push(next);
  }
  delete chain[chain.length - 1][keys[keys.length - 1]];
  for (let i = chain.length - 1; i > 0; i--) {
    if (Object.keys(chain[i]).length > 0) break;
    delete chain[i - 1][keys[i - 1]];
  }
}
