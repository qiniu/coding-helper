import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { ModelConfig } from '../config.js';
import JSON5 from 'json5';
import { isQiniuBaseUrl } from '../endpoints.js';
import { readTextFile, ConfigParseError, formatJsonLike } from '../core/safe-write.js';
import { applyConfigEdits } from '../core/config-transaction.js';
import { stateStore } from '../core/state-store.js';
import { OpenAICompatTool, fetchModelLimits, effectiveContextLimit, effectiveOutputLimit, getPath, isRecord, openAIBaseUrl, setPath, type ModelLimits } from './openai-compat-tool.js';
const PROVIDER_ID = 'qiniu';
const PRIMARY_PATH = 'agents.defaults.model.primary';

function assertConfigWritable(): void {
  const flag = ['OPENCLAW_CONFIG_READONLY', 'OPENCLAW_NIX_MODE'].find(key => process.env[key] === '1');
  if (flag) throw new Error(flag + '=1: OpenClaw configuration is externally managed and read-only. Update the external configuration source; configuration and restoration records are unchanged.');
}

export function getOpenClawConfigFile(): string {
  const userHome = os.homedir();
  const expand = (value: string, home: string): string => path.resolve(value === '~' ? home : value.startsWith('~/') || value.startsWith('~\\') ? path.join(home, value.slice(2)) : value);
  const home = expand(process.env.OPENCLAW_HOME?.trim() || userHome, userHome);
  const resolve = (value: string): string => expand(value, home);
  const explicit = process.env.OPENCLAW_CONFIG_PATH?.trim();
  if (explicit) return resolve(explicit);
  const state = process.env.OPENCLAW_STATE_DIR?.trim();
  if (state) return path.join(resolve(state), 'openclaw.json');
  if (process.env.OPENCLAW_PROFILE?.trim() && process.env.OPENCLAW_PROFILE.trim().toLowerCase() !== 'default') throw new Error('Set OPENCLAW_CONFIG_PATH or OPENCLAW_STATE_DIR for a named OpenClaw profile.');
  return path.join(resolve(home), '.openclaw', 'openclaw.json');
}

function assertNoIncludes(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  if (Object.hasOwn(value, '$include')) throw new Error('OpenClaw included configuration requires manual resolution before loading. Configuration is unchanged.');
  for (const child of Object.values(value)) assertNoIncludes(child);
}

// 缓存 provider 的真实原值不可推断，拒绝静默沿用旧凭据或删除用户配置。
function assertNoCachedQiniu(config: Record<string, unknown>, rootFile: string): void {
  assertNoIncludes(config);
  const expand = (value: string, home = os.homedir()): string => path.resolve(value === '~' ? home : /^[~][\\/]/.test(value) ? path.join(home, ...value.slice(2).split(/[\\/]+/)) : value);
  const home = expand(process.env.OPENCLAW_HOME?.trim() || os.homedir());
  const profile = process.env.OPENCLAW_PROFILE?.trim().toLowerCase();
  const suffix = profile && profile !== 'default' ? '-' + profile : '';
  if (suffix && !/^[a-z0-9_-]+$/.test(profile!)) throw new Error('Invalid OpenClaw profile name.');
  const state = process.env.OPENCLAW_STATE_DIR ? expand(process.env.OPENCLAW_STATE_DIR, home) : path.join(home, '.openclaw' + suffix);
  const dirs = new Set<string>([path.join(state, 'agents', 'main', 'agent')]);
  for (const base of new Set([state, path.dirname(rootFile)])) {
    const agents = path.join(base, 'agents');
    try { for (const name of fs.readdirSync(agents)) dirs.add(path.join(agents, name, 'agent')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const entries = getPath(config, 'agents.entries');
  const current = Array.isArray(entries) ? entries : isRecord(entries) ? Object.values(entries) : [];
  const list = getPath(config, 'agents.list');
  for (const agent of [...current, ...(Array.isArray(list) ? list : [])]) {
    if (isRecord(agent) && typeof agent.agentDir === 'string') dirs.add(expand(agent.agentDir, home));
  }
  for (const dir of dirs) {
    const file = path.join(dir, 'models.json');
    const content = readTextFile(file);
    if (content === undefined) continue;
    const cached = parseOpenClawConfig(content, file);
    if (isRecord(cached.providers) && Object.hasOwn(cached.providers, PROVIDER_ID)) {
      throw new Error('OpenClaw agent models.json contains a persisted Qiniu provider: ' + file + '. Stop OpenClaw, back up this file, remove the cached qiniu provider, then retry. Configuration and restoration records are unchanged.');
    }
  }
}

function parseOpenClawConfig(content: string | undefined, file: string): Record<string, unknown> {
  if (content === undefined) return {};
  try {
    const value: unknown = JSON5.parse(content);
    if (!isRecord(value)) throw new Error('top-level value is not an object');
    return value;
  } catch (error) { throw new ConfigParseError(file, error); }
}

function formatOpenClawConfig(content: string | undefined, config: Record<string, unknown>): string {
  // Keep ordinary JSON output for JSON input; JSON5 input can contain non-finite numbers.
  if (content === undefined) return formatJsonLike(content, config);
  try { JSON.parse(content); return formatJsonLike(content, config); } catch { /* JSON5 input */ }
  return JSON5.stringify(config, { space: 2, quote: '"' }) + (content.endsWith('\n') ? '\n' : '');
}

// 写入 models.providers.qiniu 并设为主模型；已有模型白名单时把七牛模型加入白名单
export function applyOpenClawConfig(
  config: Record<string, unknown>,
  baseUrl: string,
  apiKey: string,
  model: string,
  limits?: ModelLimits,
): Record<string, unknown> {
  assertNoIncludes(config);
  for (const key of ['models', 'models.providers', 'agents', 'agents.defaults', 'agents.defaults.models', 'agents.defaults.modelPolicy']) {
    const value = getPath(config, key);
    if (value !== undefined && !isRecord(value)) throw new Error('Invalid OpenClaw object: ' + key);
  }
  const priorModel = getPath(config, 'agents.defaults.model');
  if (priorModel !== undefined && typeof priorModel !== 'string' && !isRecord(priorModel)) {
    throw new Error('Invalid OpenClaw model: expected a string or object.');
  }
  const policy = getPath(config, 'agents.defaults.modelPolicy.allow');
  if (policy !== undefined && (!Array.isArray(policy) || policy.some(entry => typeof entry !== 'string'))) {
    throw new Error('Invalid OpenClaw modelPolicy.allow: expected an array of strings.');
  }
  const next = structuredClone(config);
  if (typeof priorModel === 'string') setPath(next, 'agents.defaults.model', {});
  const ref = `${PROVIDER_ID}/${model}`;
  const previous = getPath(next, `models.providers.${PROVIDER_ID}`);
  if (previous !== undefined && !isRecord(previous)) throw new Error('Invalid OpenClaw qiniu provider.');
  const previousModels = isRecord(previous) && previous.models !== undefined ? previous.models : [];
  if (!Array.isArray(previousModels) || previousModels.some(row => !isRecord(row) || typeof row.id !== 'string')) throw new Error('Invalid OpenClaw qiniu models.');
  const selected = previousModels.find(row => row.id === model) ?? {};
  setPath(next, `models.providers.${PROVIDER_ID}`, {
    ...(isRecord(previous) ? previous : {}),
    baseUrl: openAIBaseUrl(baseUrl),
    apiKey,
    auth: 'api-key',
    api: 'openai-completions',
    models: [...previousModels.filter(row => row.id !== model), {
      ...selected,
      id: model,
      name: `Qiniu: ${model}`,
      ...(limits ? {
        contextWindow: effectiveContextLimit(limits, selected.contextWindow),
        maxTokens: effectiveOutputLimit(limits, selected.maxTokens, effectiveContextLimit(limits, selected.contextWindow)),
      } : {}),
      ...(limits?.reasoning !== undefined ? { reasoning: limits.reasoning } : {}),
      ...(limits?.modalities ? { input: limits.modalities.input.filter(value => ['text','image'].includes(value)) } : {}),
    }],
  });
  setPath(next, PRIMARY_PATH, ref);
  const allow = getPath(next, 'agents.defaults.models');
  if (isRecord(allow) && Object.keys(allow).length) {
    if (!Object.hasOwn(allow, ref)) allow[ref] = {};
  }
  if (Array.isArray(policy) && policy.length && !policy.some(entry =>
    entry === ref || (entry.endsWith('*') && ref.startsWith(entry.slice(0, -1))))) {
    setPath(next, 'agents.defaults.modelPolicy.allow', [...policy, ref]);
  }
  return next;
}

export class OpenClawTool extends OpenAICompatTool {
  supportsPreview = true;
  name = 'openclaw';
  displayName = 'OpenClaw';
  command = 'openclaw';
  installCommand = 'npm install -g openclaw';
  updateCommand = 'openclaw update';
  npmPackageName = 'openclaw';

  getConfig(): Record<string, unknown> {
    try {
      const file = getOpenClawConfigFile();
      return parseOpenClawConfig(readTextFile(file), file);
    } catch {
      return {};
    }
  }

  isConfigured(): boolean {
    const file = getOpenClawConfigFile();
    return isQiniuBaseUrl(getPath(parseOpenClawConfig(readTextFile(file), file), `models.providers.${PROVIDER_ID}.baseUrl`));
  }

  // 同一状态锁内核对已装载目标，路径变化时保留旧凭据及还原记录并提示恢复。
  private assertRecordedPath(file: string): boolean {
    const records = stateStore.getFileStates(this.name);
    const matched = stateStore.getState(this.name, file) !== undefined;
    if (records.length !== (matched ? 1 : 0)) {
      throw new Error('OpenClaw configuration path changed. Configuration is unchanged; restore OPENCLAW_CONFIG_PATH, OPENCLAW_STATE_DIR and OPENCLAW_HOME to the previously loaded target, then unload before switching paths.');
    }
    return matched;
  }

  async loadConfig(apiKey: string, baseUrl: string, models: ModelConfig): Promise<void> {
    assertConfigWritable();
    const model = this.resolveModel(models); const limits = await fetchModelLimits(baseUrl, apiKey, model, this.name);
    stateStore.withLock(() => {
      assertConfigWritable();
      const file = getOpenClawConfigFile();
      this.assertRecordedPath(file);
      applyConfigEdits(this.name, [{ file, build: content => {
        const config = parseOpenClawConfig(content, file);
        assertNoIncludes(config); assertNoCachedQiniu(config, file);
        return formatOpenClawConfig(content, applyOpenClawConfig(config, baseUrl, apiKey, model, limits));
      } }]);
    });
  }
  unloadConfig(): void {
    stateStore.withLock(() => {
      assertConfigWritable(); const file = getOpenClawConfigFile();
      const recorded = this.assertRecordedPath(file);
      assertNoCachedQiniu(recorded ? parseOpenClawConfig(readTextFile(file), file) : {}, file);
      this.restoreManagedConfig([file]);
    });
  }
}
