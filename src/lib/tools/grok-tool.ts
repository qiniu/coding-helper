import { slotModel } from '../core/model-slots.js';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';
import { isQiniuBaseUrl } from '../endpoints.js';
import type { ModelConfig } from '../config.js';
import { readTextFile } from '../core/safe-write.js';
import { applyConfigEdits } from '../core/config-transaction.js';
import { OpenAICompatTool, fetchModelLimits, effectiveContextLimit, openAIBaseUrl, isRecord } from './openai-compat-tool.js';
import { escapeTomlString, normalizeToml, removeTomlTable, upsertTomlTableKey, validateToml } from '../core/toml-edit.js';
const MODEL_ID = 'qiniu';
const MODEL_TABLE = `model.${MODEL_ID}`;

export function getGrokConfigFile(): string {
  return path.join(process.env.GROK_HOME || path.join(os.homedir(), '.grok'), 'config.toml');
}

export function hasManagedGrokConfig(content: string): boolean {
  try { const config = parse(content); return isRecord(config.model) && isRecord(config.model.qiniu); }
  catch { return false; }
}

export function getGrokInstallCommand(platform = process.platform): string {
  if (platform === 'win32') return 'powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = \'Stop\'; try { Invoke-RestMethod https://x.ai/cli/install.ps1 | Invoke-Expression } catch { Write-Error $_; exit 1 }"';
  return "bash -o pipefail -c 'curl -fsSL https://x.ai/cli/install.sh | bash'";
}


function modelTable(table: string, model: string, baseUrl: string, apiKey: string, contextWindow: number): string {
  return [
    `[${table}]`,
    `model = "${escapeTomlString(model)}"`,
    `name = "Qiniu: ${escapeTomlString(model)}"`,
    `base_url = "${escapeTomlString(openAIBaseUrl(baseUrl))}"`,
    `api_key = "${escapeTomlString(apiKey)}"`,
    'api_backend = "chat_completions"',
    `context_window = ${contextWindow}`,
    '',
  ].join('\n');
}

// 写入 [model.qiniu] 自带模型（BYOK），并把 [models] default 指向它；
export function applyGrokConfig(
  existing: string,
  baseUrl: string,
  apiKey: string,
  model: string,
  contextWindow = 128000,
  summary?: { model: string; contextWindow?: number },
): string {
  const newline = existing.includes('\r\n') ? '\r\n' : '\n';
  let content = removeTomlTable(existing, MODEL_TABLE);
  content = upsertTomlTableKey(content, 'models', 'default', '"qiniu"');
  if (summary) {
    content = removeTomlTable(content, 'model.qiniu-summary');
    content = upsertTomlTableKey(content, 'models', 'session_summary', JSON.stringify(summary.model === model ? MODEL_ID : 'qiniu-summary'));
  }
  const extra = summary && summary.model !== model ? modelTable('model.qiniu-summary', summary.model, baseUrl, apiKey, summary.contextWindow ?? contextWindow).replace(/\n/g, newline) : '';
  const next = normalizeToml(content.trimEnd() + newline + newline + modelTable(MODEL_TABLE, model, baseUrl, apiKey, contextWindow).replace(/\n/g, newline) + extra);
  validateToml(next); return next;
}

export class GrokTool extends OpenAICompatTool {
  supportsPreview = true;
  name = 'grok';
  displayName = 'Grok CLI';
  command = 'grok';
  installCommand = getGrokInstallCommand();

  getConfig(): Record<string, unknown> {
    return { configPath: getGrokConfigFile(), configured: this.isConfigured() };
  }

  isConfigured(): boolean {
    const config = parse(readTextFile(getGrokConfigFile()) ?? '');
    return isRecord(config.model) && isRecord(config.model.qiniu) && isQiniuBaseUrl(config.model.qiniu.base_url);
  }

  async loadConfig(apiKey: string, baseUrl: string, models: ModelConfig): Promise<void> {
    const model = this.resolveModel(models);
    const limits = await fetchModelLimits(baseUrl, apiKey, model, this.name);
    const summary = slotModel(this.name, 'summary', model, models);
    const summaryLimits = summary === model ? limits : await fetchModelLimits(baseUrl, apiKey, summary, this.name);
    applyConfigEdits(this.name, [{ file: getGrokConfigFile(), build: content => {
      const config = parse(content ?? '');
      const entries: unknown[] = isRecord(config.model) ? [config.model.qiniu, config.model['qiniu-summary']] : [];
      const knownLimit = (id: string): number | undefined => {
        const limits = entries.filter(isRecord).filter(entry => entry.model === id && entry.base_url === openAIBaseUrl(baseUrl))
          .map(entry => entry.context_window).filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
        return limits.length ? Math.min(...limits) : undefined;
      };
      const known = knownLimit(model), summaryKnown = knownLimit(summary);
      return applyGrokConfig(content ?? '', baseUrl, apiKey, model, effectiveContextLimit(limits, known), { model: summary, contextWindow: effectiveContextLimit(summaryLimits, summaryKnown) });
    } }]);
  }
  unloadConfig(): void { this.restoreManagedConfig([getGrokConfigFile()]); }
}
