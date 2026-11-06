import os from 'node:os';
import path from 'node:path';
import type { ModelConfig } from '../config.js';
import { isQiniuBaseUrl } from '../endpoints.js';
import { readTextFile, formatJsonLike } from '../core/safe-write.js';
import { applyConfigEdits, parseConfigObject } from '../core/config-transaction.js';
import { stateStore } from '../core/state-store.js';
import { OpenAICompatTool, fetchModelLimits, getPath, isRecord, openAIBaseUrl, setPath } from './openai-compat-tool.js';
import { setDotenvValue, readDotenvValue } from '../core/dotenv-edit.js';
// Key 只写进 ~/.qwen/.env，settings.json 里用 envKey 引用，不存明文
export const QWEN_ENV_KEY = 'QINIU_API_KEY';
const AUTH_TYPE = 'openai';
const MANAGED_PATHS = ['security.auth.selectedType', 'model.name'] as const;

function qwenDir(): string {
  let override = process.env.QWEN_HOME;
  // 用户 .qwen/.env 优先于 ~/.env；显式 shell 环境即使为空也不被文件覆盖。
  if (!Object.hasOwn(process.env, 'QWEN_HOME')) {
    for (const file of [path.join(os.homedir(), '.qwen', '.env'), path.join(os.homedir(), '.env')]) {
      const value = readDotenvValue(readTextFile(file) ?? '', 'QWEN_HOME');
      if (value) { override = value; break; }
    }
  }
  if (override) return path.resolve(override === '~' ? os.homedir() : override.startsWith('~/') || override.startsWith('~\\') ? path.join(os.homedir(), ...override.slice(2).split(/[\\/]+/)) : override);
  return path.join(os.homedir(), '.qwen');
}

// 与 Qwen 一样允许 JSON 注释；事务另行保存完整原文供卸载还原。
export function parseQwenSettings(content: string | undefined): Record<string, unknown> {
  if (content === undefined) return {};
  const input = content.replace(/^\uFEFF/, '');
  let output = '';
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      output += char;
      if (char === '\\') output += input[++i] ?? '';
      else if (char === '"') quoted = false;
    } else if (char === '"') { quoted = true; output += char; }
    else if (char === '/' && input[i + 1] === '/') {
      while (i < input.length && input[i] !== '\n' && input[i] !== '\r') { output += ' '; i++; }
      if (i < input.length) output += input[i];
    } else if (char === '/' && input[i + 1] === '*') {
      const end = input.indexOf('*/', i + 2);
      if (end < 0) throw new Error('Unterminated Qwen settings comment.');
      output += input.slice(i, end + 2).replace(/[^\r\n]/g, ' ');
      i = end + 1;
    } else output += char;
  }
  return parseConfigObject(output);
}

interface QwenModelEntry {
  id?: string;
  baseUrl?: string;
  envKey?: string;
  [key: string]: unknown;
}

function isQiniuEntry(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  return entry.envKey === QWEN_ENV_KEY || isQiniuBaseUrl(entry.baseUrl);
}

// 在 modelProviders.openai 中加入七牛模型并设为当前模型，其他条目原样保留
export function applyQwenSettings(
  settings: Record<string, unknown>,
  baseUrl: string,
  model: string,
  contextWindow?: number,
): Record<string, unknown> {
  for (const key of ['modelProviders', 'security', 'model']) {
    if (Object.hasOwn(settings, key) && !isRecord(settings[key])) throw new Error('Invalid Qwen configuration object: ' + key);
  }
  if (isRecord(settings.security) && Object.hasOwn(settings.security, 'auth') && !isRecord(settings.security.auth)) throw new Error('Invalid Qwen auth object.');
  if (isRecord(settings.modelProviders) && Object.hasOwn(settings.modelProviders, AUTH_TYPE) && !Array.isArray(settings.modelProviders[AUTH_TYPE])) throw new Error('Invalid Qwen providers array.');
  const next = structuredClone(settings);
  const providers = isRecord(next.modelProviders) ? next.modelProviders : {};
  const existing = Array.isArray(providers[AUTH_TYPE]) ? (providers[AUTH_TYPE] as QwenModelEntry[]) : [];
  if (existing.some(entry => !isRecord(entry))) throw new Error('Invalid Qwen provider entry.');
  // Qwen 使用 id + baseUrl 区分路由，同名但端点不同的非托管模型可以共存。
  if (existing.some(entry => !isQiniuEntry(entry) && entry.id === model && entry.baseUrl === openAIBaseUrl(baseUrl))) {
    throw new Error('Qwen model and endpoint already belong to another provider.');
  }
  const entry: QwenModelEntry = {
    id: model,
    name: `Qiniu: ${model}`,
    baseUrl: openAIBaseUrl(baseUrl),
    envKey: QWEN_ENV_KEY,
    ...(contextWindow ? { generationConfig: { contextWindowSize: contextWindow } } : {}),
  };
  providers[AUTH_TYPE] = [...existing.filter((e) => !isQiniuEntry(e)), entry];
  next.modelProviders = providers;
  setPath(next, 'security.auth.selectedType', AUTH_TYPE);
  setPath(next, 'model.name', model);
  setPath(next, 'model.baseUrl', openAIBaseUrl(baseUrl));
  return next;
}

export class QwenCodeTool extends OpenAICompatTool {
  name = 'qwen-code';
  displayName = 'Qwen Code';
  command = 'qwen';
  installCommand = 'npm install -g @qwen-code/qwen-code';
  updateCommand = 'npm install -g @qwen-code/qwen-code@latest';
  npmPackageName = '@qwen-code/qwen-code';
  aliases = ['qwen'];

  private settingsFile(): string {
    return path.join(qwenDir(), 'settings.json');
  }

  private configFiles(): [string, string] {
    const dir = qwenDir();
    return [path.join(dir, 'settings.json'), path.join(dir, '.env')];
  }

  // 在同一状态锁内确认旧事务仍属于当前目录，防止遗留凭据后误报卸载成功。
  private assertRecordedDirectory(files: string[]): void {
    const recorded = stateStore.getFileStates(this.name);
    const matching = files.filter(file => stateStore.getState(this.name, file) !== undefined);
    if (recorded.length !== matching.length) {
      throw new Error('Qwen configuration directory changed. Configuration is unchanged; restore QWEN_HOME and its user dotenv setting to the previously loaded directory, then unload before switching directories.');
    }
  }

  getConfig(): Record<string, unknown> {
    try {
      return parseQwenSettings(readTextFile(this.settingsFile()));
    } catch {
      return {};
    }
  }

  isConfigured(): boolean {
    const entries = getPath(parseQwenSettings(readTextFile(this.settingsFile())), `modelProviders.${AUTH_TYPE}`);
    return Array.isArray(entries) && entries.some(entry => isRecord(entry) && isQiniuBaseUrl(entry.baseUrl));
  }

  async loadConfig(apiKey: string, baseUrl: string, models: ModelConfig): Promise<void> {
    const model = this.resolveModel(models);
    const limits = await fetchModelLimits(baseUrl, apiKey, model);
    stateStore.withLock(() => {
      const files = this.configFiles();
      this.assertRecordedDirectory(files);
      applyConfigEdits(this.name, [
        { file: files[0], build: content => formatJsonLike(content?.replace(/^\uFEFF/, ''), applyQwenSettings(parseQwenSettings(content), baseUrl, model, limits.contextWindow)) },
        { file: files[1], build: content => setDotenvValue(content ?? '', QWEN_ENV_KEY, apiKey) },
      ]);
    });
  }
  unloadConfig(): void {
    stateStore.withLock(() => {
      const files = this.configFiles();
      this.assertRecordedDirectory(files);
      this.restoreManagedConfig(files);
    });
  }
}
