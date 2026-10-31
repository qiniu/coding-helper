import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import type { ModelConfig } from '../config.js';
import { isQiniuBaseUrl } from '../endpoints.js';
import { assertNotSymlink, readTextFile, readJsonSnapshot, readJsonObjectStrict, formatJsonLike, safeWriteFile, writeJson, writeJsonOrRemove } from '../core/safe-write.js';
import { stateStore, type PriorValues, type ToolState } from '../core/state-store.js';
import {
  OpenAICompatTool,
  type ModelLimits,
  fetchModelLimits,
  effectiveContextLimit,
  effectiveOutputLimit,
  getPath,
  isRecord,
  openAIBaseUrl,
} from './openai-compat-tool.js';

const PROVIDER_ID = 'qiniu';

// 选中模型的路由不能悄悄指向旧别名或另一 SDK；保留配置并要求先解决冲突。
function validateSelectedModel(selected: unknown, model: string): void {
  if (selected === undefined) return;
  if (!isRecord(selected)) throw new Error('Invalid OpenCode selected model object.');
  if (selected.status === 'deprecated') throw new Error('OpenCode selected model is deprecated: ' + model);
  if (selected.status === 'alpha' && !['1', 'true'].includes(process.env.OPENCODE_ENABLE_EXPERIMENTAL_MODELS ?? '')) throw new Error('OpenCode alpha model requires experimental models to be enabled.');
  rejectAuthHeaders(selected.headers);
  if (selected.id !== undefined && selected.id !== model) throw new Error('OpenCode selected model has a conflicting wire-model id: ' + model);
  if (selected.provider !== undefined && (!isRecord(selected.provider) ||
      selected.provider.npm !== undefined && selected.provider.npm !== '@ai-sdk/openai-compatible')) {
    throw new Error('OpenCode selected model has a conflicting provider SDK: ' + model);
  }
}

function rejectAuthHeaders(headers: unknown): void {
  if (isRecord(headers) && Object.keys(headers).some(key => ['authorization', 'x-api-key', 'api-key'].includes(key.toLowerCase()))) {
    throw new Error('OpenCode custom authentication headers conflict with the configured API key. Remove them before loading.');
  }
}

function mergeConfig(base: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base };
  for (const [key, value] of Object.entries(next)) {
    Object.defineProperty(result, key, { value: isRecord(value) && isRecord(base[key]) ? mergeConfig(base[key], value) : value,
      enumerable: true, writable: true, configurable: true });
  }
  return result;
}

// OpenCode 后加载 JSONC；优先操作生效的文件（含注释时拒绝覆盖）
function getOpenCodeConfigFiles(home = os.homedir()): [string, string] {
  const dir = canonicalDirectory(path.resolve(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode'));
  return [path.join(dir, 'opencode.json'), path.join(dir, 'opencode.jsonc')];
}

export function getOpenCodeConfigFile(home = os.homedir()): string {
  const [json, jsonc] = getOpenCodeConfigFiles(home);
  try { fs.lstatSync(jsonc); return jsonc; }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return json;
  }
}

// 只解析父目录：目录别名使用同一状态身份，文件本身的符号链接仍明确拒绝
function canonicalDirectory(dir: string): string {
  try { return fs.realpathSync(dir); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT' || path.dirname(dir) === dir) throw err;
    return path.join(canonicalDirectory(path.dirname(dir)), path.basename(dir));
  }
}

function validateConfig(config: Record<string, unknown>): void {
  if (Object.hasOwn(config, 'providers')) throw new Error('OpenCode v2 configuration is not supported by the OpenCode 1.x adapter. Configuration is unchanged.');
  for (const key of ['enabled_providers', 'disabled_providers']) {
    if (Object.hasOwn(config, key) && (!Array.isArray(config[key]) || !(config[key] as unknown[]).every((value) => typeof value === 'string'))) {
      throw new Error('Invalid OpenCode ' + key + ': expected a string array.');
    }
  }
  if (Object.hasOwn(config, 'provider') && !isRecord(config.provider)) throw new Error('Invalid OpenCode provider object.');
  const provider = getPath(config, 'provider.qiniu');
  if (provider !== undefined && !isRecord(provider)) throw new Error('Invalid OpenCode qiniu provider object.');
  if (isRecord(provider)) {
    for (const key of ['whitelist', 'blacklist']) {
      if (Object.hasOwn(provider, key) && (!Array.isArray(provider[key]) || !(provider[key] as unknown[]).every((value) => typeof value === 'string'))) {
        throw new Error('Invalid OpenCode qiniu ' + key + ': expected a string array.');
      }
    }
    for (const key of ['options', 'models']) {
      if (Object.hasOwn(provider, key) && !isRecord(provider[key])) throw new Error('Invalid OpenCode qiniu ' + key + ' object.');
    }
  }
}

// 写入七牛 provider 并设为默认模型，其他 provider 与设置原样保留
export function applyOpenCodeConfig(
  config: Record<string, unknown>,
  baseUrl: string,
  apiKey: string,
  model: string,
  limits?: ModelLimits,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...config };
  if (!next.$schema) next.$schema = 'https://opencode.ai/config.json';
  const providers = isRecord(next.provider) ? { ...next.provider } : {};
  const previous = isRecord(providers[PROVIDER_ID]) ? providers[PROVIDER_ID] : {};
  rejectAuthHeaders(isRecord(previous.options) ? previous.options.headers : undefined);
  const existingModels = isRecord(previous.models) ? previous.models : {};
  const selected = existingModels[model];
  validateSelectedModel(selected, model);
  if (selected !== undefined && !isRecord(selected)) throw new Error('Invalid OpenCode selected model object.');
  const existingModel = isRecord(selected) ? selected : {};
  if (existingModel.limit !== undefined && !isRecord(existingModel.limit)) throw new Error('Invalid OpenCode model limit object.');
  providers[PROVIDER_ID] = {
    ...previous,
    npm: '@ai-sdk/openai-compatible',
    name: 'Qiniu',
    options: { ...(isRecord(previous.options) ? previous.options : {}), baseURL: openAIBaseUrl(baseUrl), apiKey },
    models: {
      ...(isRecord(previous.models) ? previous.models : {}),
      [model]: {
        ...existingModel,
        name: model,
        ...(limits?.reasoning !== undefined ? { reasoning: limits.reasoning } : {}),
        ...(limits?.modalities ? { modalities: limits.modalities } : {}),
        ...(limits ? { limit: { ...(isRecord(existingModel.limit) ? existingModel.limit : {}),
          context: effectiveContextLimit(limits, isRecord(existingModel.limit) ? existingModel.limit.context : undefined),
          output: effectiveOutputLimit(limits, isRecord(existingModel.limit) ? existingModel.limit.output : undefined, effectiveContextLimit(limits, isRecord(existingModel.limit) ? existingModel.limit.context : undefined)) } } : {}),
      },
    },
  };
  next.provider = providers;
  next.model = `${PROVIDER_ID}/${model}`;
  return next;
}

// 只记录实际管理的字段，缺失与 null 区分，避免删除用户原有空值
function snapshot(config: Record<string, unknown>): PriorValues {
  const result: PriorValues = {};
  for (const key of ['model', '$schema']) {
    if (Object.hasOwn(config, key)) result[key] = config[key];
  }
  if (isRecord(config.provider) && Object.hasOwn(config.provider, PROVIDER_ID)) {
    result.provider = config.provider[PROVIDER_ID];
  }
  return result;
}

// 三方还原：只撤销仍与本工具最后写入值相同的字段，保留之后的用户修改
function restoreValue(current: unknown, prior: unknown, applied: unknown): unknown {
  if (isDeepStrictEqual(current, applied)) return prior;
  if (!isRecord(current) || !isRecord(applied) || (prior !== undefined && !isRecord(prior))) return current;
  const original = isRecord(prior) ? prior : {};
  const next = { ...current };
  for (const key of new Set([...Object.keys(original), ...Object.keys(applied)])) {
    const own = (value: Record<string, unknown>): unknown => Object.hasOwn(value, key) ? value[key] : undefined;
    const restored = restoreValue(own(current), own(original), own(applied));
    if (restored === undefined) delete next[key];
    else Object.defineProperty(next, key, { value: restored, enumerable: true, writable: true, configurable: true });
  }
  return prior === undefined && Object.keys(next).length === 0 ? undefined : next;
}

export function revertOpenCodeConfig(config: Record<string, unknown>, priors: PriorValues, applied: PriorValues): Record<string, unknown> {
  const next = { ...config };
  const current = snapshot(config);
  for (const key of ['model', '$schema', 'provider']) {
    const original = Object.hasOwn(priors, key) ? priors[key] : undefined;
    const written = Object.hasOwn(applied, key) ? applied[key] : undefined;
    const value = restoreValue(current[key], original, written);
    if (key === 'provider') {
      if (!isRecord(config.provider)) continue;
      const providers = { ...config.provider };
      if (value === undefined) delete providers[PROVIDER_ID];
      else providers[PROVIDER_ID] = value;
      if (Object.keys(providers).length) next.provider = providers;
      else delete next.provider;
    } else if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next;
}

// 恢复未完成的状态提交。无法确定文件对应哪一侧时保留日志并拒绝修改。
function recoverPending(file: string, saved: ToolState | undefined, content: string | undefined): ToolState | undefined {
  if (!saved?.pending) return saved;
  const pending = saved.pending;
  let recovered: ToolState | undefined;
  if (content === pending.after) recovered = { priors: saved.priors, applied: pending.applied };
  else if ((content ?? null) === pending.before) {
    recovered = saved.applied ? { priors: saved.priors, applied: saved.applied } : undefined;
  } else {
    throw new Error('OpenCode configuration changed during an interrupted write. Restoration journal retained; restore the recorded before/after file from backup before retrying.');
  }
  stateStore.setState('opencode', recovered, file);
  return recovered;
}

export class OpenCodeTool extends OpenAICompatTool {
  supportsPreview = true;
  name = 'opencode';
  displayName = 'OpenCode 1.x';
  command = 'opencode';
  installCommand = 'npm install -g opencode-ai@1';
  updateCommand = 'npm install -g opencode-ai@1';
  npmPackageName = 'opencode-ai';
  npmVersionMajor = 1;

  private assertSupportedVersion(): void {
    const version = this.getVersion();
    if (version && !/^v?1\./.test(version.trim())) throw new Error('This adapter supports OpenCode 1.x only. Configuration is unchanged; use a compatible client.');
  }
  validateUpdate(): void { this.assertSupportedVersion(); }

  getConfig(): Record<string, unknown> {
    try {
      return readJsonObjectStrict(getOpenCodeConfigFile());
    } catch {
      return {};
    }
  }

  isConfigured(): boolean {
    return isQiniuBaseUrl(getPath(readJsonObjectStrict(getOpenCodeConfigFile()), `provider.${PROVIDER_ID}.options.baseURL`));
  }

  async loadConfig(apiKey: string, baseUrl: string, models: ModelConfig): Promise<void> {
    this.assertSupportedVersion();
    const model = this.resolveModel(models);
    const file = getOpenCodeConfigFile();
    assertNotSymlink(file);
    const { content: before } = readJsonSnapshot(file);
    // 全局顺序：config.json → opencode.json → opencode.jsonc；后者逐字段覆盖。
    const files = [path.join(path.dirname(file), 'config.json'), ...getOpenCodeConfigFiles()];
    const lowerFiles = files.slice(0, files.indexOf(file));
    const lower = lowerFiles.map((file) => ({ file, ...readJsonSnapshot(file) }));
    const limits = await fetchModelLimits(baseUrl, apiKey, model, this.name);
    assertNotSymlink(file);
    const { value: config, content: current } = readJsonSnapshot(file);
    const unchanged = (): boolean => getOpenCodeConfigFile() === file && readTextFile(file) === before &&
      lower.every((entry) => readTextFile(entry.file) === entry.content);
    if (current !== before || !unchanged()) {
      throw new Error('OpenCode configuration changed while fetching model metadata. Retry with the current configuration.');
    }
    const layers = [...lower.map((entry) => entry.value), config];
    let effective: Record<string, unknown> = {};
    let effectiveProvider: Record<string, unknown> = {};
    for (const layer of layers) {
      validateConfig(layer);
      effective = { ...effective, ...layer };
      const provider = getPath(layer, 'provider.qiniu');
      if (isRecord(provider)) effectiveProvider = mergeConfig(effectiveProvider, provider);
    }
    if ((Array.isArray(effective.enabled_providers) && !effective.enabled_providers.includes(PROVIDER_ID)) ||
        (Array.isArray(effective.disabled_providers) && effective.disabled_providers.includes(PROVIDER_ID))) {
      throw new Error('OpenCode provider filters exclude qiniu. Update enabled_providers/disabled_providers before loading.');
    }
    if ((Array.isArray(effectiveProvider.whitelist) && !effectiveProvider.whitelist.includes(model)) ||
        (Array.isArray(effectiveProvider.blacklist) && effectiveProvider.blacklist.includes(model))) {
      throw new Error('OpenCode model filters exclude ' + model + '. Update qiniu whitelist/blacklist before loading.');
    }
    validateSelectedModel(isRecord(effectiveProvider.models) ? effectiveProvider.models[model] : undefined, model);
    rejectAuthHeaders(isRecord(effectiveProvider.options) ? effectiveProvider.options.headers : undefined);
    stateStore.withLock(() => {
      // JSON/JSONC 优先级切换不能留下两个独立的托管配置，先还原原文件
      const otherManaged = getOpenCodeConfigFiles().find((candidate) => candidate !== file && stateStore.getState(this.name, candidate));
      if (otherManaged) throw new Error('Unload the existing managed configuration before switching files: ' + otherManaged);
      const previous = recoverPending(file, stateStore.getState(this.name, file), before);
      if (previous && (!isRecord(previous.priors?.snapshot) || !isRecord(previous.applied))) {
        throw new Error('OpenCode restoration state lacks a managed snapshot. Restore from backup before reconfiguring.');
      }
      if (previous?.applied && !isDeepStrictEqual(snapshot(config), previous.applied)) {
        throw new Error('OpenCode managed fields changed since loading. Unload first to preserve your changes, then reload.');
      }
      if (!unchanged()) throw new Error('OpenCode configuration changed before writing. Retry.');
      const next = applyOpenCodeConfig(config, baseUrl, apiKey, model, limits);
      if (limits.verified === false) {
        // 下层继承的已知限额不能被回退值遮蔽。
        const selectedModel = isRecord(effectiveProvider.models) ? effectiveProvider.models[model] : undefined;
        const effectiveLimit = isRecord(selectedModel) && isRecord(selectedModel.limit) ? selectedModel.limit : undefined;
        const target = getPath(next, 'provider.qiniu');
        const targetModel = isRecord(target) && isRecord(target.models) ? target.models[model] : undefined;
        if (isRecord(effectiveLimit) && isRecord(targetModel) && isRecord(targetModel.limit)) {
          targetModel.limit.context = effectiveContextLimit(limits, effectiveLimit.context);
          targetModel.limit.output = effectiveOutputLimit(limits, effectiveLimit.output, targetModel.limit.context as number);
        }
      }
      const priors = previous?.priors ?? { snapshot: snapshot(config), fileExisted: before !== undefined, providerExisted: Object.hasOwn(config, 'provider') };
      const applied = snapshot(next);
      const after = formatJsonLike(before, next);
      stateStore.setState(this.name, { priors, applied: previous?.applied,
        pending: { before: before ?? null, after, applied } }, file);
      try {
        safeWriteFile(file, after, 0o600, { content: before });
      } catch (err) {
        // rename 已完成但后续清理报错时仍保留日志，不能丢失已写入的快照。
        // 无法读取当前文件时也保留日志，交由下次操作确认。
        try { if (readTextFile(file) === before) stateStore.setState(this.name, previous, file); } catch { /* 保留待恢复日志 */ }
        throw err;
      }
      // 最后提交失败时保留 pending，下一次操作可识别已经写入的客户端内容。
      stateStore.setState(this.name, { priors, applied }, file);
    });
  }

  unloadConfig(): void {
    stateStore.withLock(() => {
      // 按已记录的装载目标卸载，后来新增 JSONC 不应让旧 JSON 的凭据遗留
      const managed = getOpenCodeConfigFiles().filter((candidate) => stateStore.getState(this.name, candidate));
      if (managed.length > 1) throw new Error('Multiple managed OpenCode configurations found. Restore them from backup before unloading.');
      const file = managed[0] ?? getOpenCodeConfigFile();
      const recorded = stateStore.getState(this.name, file);
      assertNotSymlink(file);
      const { value: config, content: before } = readJsonSnapshot(file);
      const saved = recoverPending(file, recorded, before);
      // 已确认初次写入未发生的 pending 可以正常结束；无记录的既有配置必须明确提示。
      if (!saved) {
        if (recorded?.pending) return;
        const candidates = [path.join(path.dirname(file), 'config.json'), ...getOpenCodeConfigFiles()];
        const exists = candidates.some(candidate => {
          try { fs.lstatSync(candidate); return true; }
          catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
        });
        if (exists) throw new Error('No restoration record for OpenCode. Configuration is unchanged; remove legacy credentials manually or recover a known backup.');
        return;
      }
      if (!isRecord(saved.priors?.snapshot) || !isRecord(saved.applied)) {
        throw new Error('OpenCode restoration state lacks a managed snapshot. Restore from backup before unloading.');
      }
      const next = revertOpenCodeConfig(config, saved.priors.snapshot, saved.applied);
      if (saved.priors.providerExisted && isRecord(config.provider) && !Object.hasOwn(next, 'provider')) next.provider = {};
      // 已有的空文件对象保留，只有本工具新建且还原为空的文件才移除
      if (before !== undefined) {
        if (saved.priors.fileExisted) writeJson(file, next, { content: before });
        else writeJsonOrRemove(file, next, { content: before });
      }
      stateStore.markRemoved(this.name, file);
    });
  }
}
