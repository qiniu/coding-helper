import { findCommand, commandVersion } from '../../utils/find-command.js';
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import type { ITool } from './base-tool.js';
import { configManager, type ModelConfig, type ClaudeCodeConfig } from '../config.js';
import { isQiniuBaseUrl } from '../endpoints.js';
import { t } from '../i18n.js';
import { assertNotSymlink, readTextFile, readJsonSnapshot, readJsonObjectStrict, safeWriteFile, writeJsonOrRemove, formatJsonLike } from '../core/safe-write.js';
import { stateStore, type ToolState, type PriorValues } from '../core/state-store.js';
import { runModelSelectionFlow } from '../wizard/flows/model-selection-flow.js';
import { uiRenderer } from '../wizard/ui/ui-renderer.js';

// API 超时时间：50 分钟，适配长时间推理请求
const API_TIMEOUT = '3000000';

// Claude Code 的环境变量 key 列表
const CLAUDE_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_FABLE_MODEL_DESCRIPTION',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'API_TIMEOUT_MS',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'CLAUDE_CODE_ATTRIBUTION_HEADER',
];


const CLAUDE_SLOT_ALIAS_KEYS = ['ANTHROPIC_DEFAULT_FABLE_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION', 'ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION', 'ANTHROPIC_DEFAULT_FABLE_MODEL_DESCRIPTION'];
const CLAUDE_LEGACY_ENV_KEYS = CLAUDE_ENV_KEYS.filter(key => !CLAUDE_SLOT_ALIAS_KEYS.includes(key));

// Claude Code 配置文件路径
const CLAUDE_SETTINGS_DIR = path.join(os.homedir(), '.claude');
const CLAUDE_SETTINGS_FILE = path.join(CLAUDE_SETTINGS_DIR, 'settings.json');
const CLAUDE_JSON_FILE = path.join(os.homedir(), '.claude.json');

// Claude Code 工具实现
export class ClaudeCodeTool implements ITool {
  supportsPreview = true;
  name = 'claude-code';
  displayName = 'Claude Code';
  command = 'claude';
  searchPaths = [path.join(os.homedir(), '.claude', 'local', 'claude'), path.join(os.homedir(), '.claude', 'local', 'node_modules', '.bin', 'claude')];
  installCommand = 'npm install -g @anthropic-ai/claude-code';
  updateCommand = 'claude update';
  npmPackageName = '@anthropic-ai/claude-code';
  aliases = ['claude'];

  // 获取已安装的 Claude Code 版本
  getVersion(): string | null { const file = findCommand(this.command, this.searchPaths); return file ? commandVersion(file) : null; }

  // 检查 claude 命令是否可用
  isInstalled(): boolean { return !!findCommand(this.command, this.searchPaths); }

  // 读取当前 Claude Code settings.json
  getConfig(): Record<string, unknown> {
    try {
      return readJsonObjectStrict(CLAUDE_SETTINGS_FILE);
    } catch {
      // 文件不存在或解析失败
    }
    return {};
  }

  // 读取实际路由，不能将 helper 保存过 Key 等同于客户端已接入。
  isConfigured(): boolean {
    const env = readJsonObjectStrict(CLAUDE_SETTINGS_FILE).env;
    return isRecord(env) && isQiniuBaseUrl(env.ANTHROPIC_BASE_URL);
  }

  // 卸载只处理本工具记录过的字段，保留之后的用户编辑
  clearModelConfig(): void {
    stateStore.withLock(() => {
      const targets = [CLAUDE_SETTINGS_FILE, CLAUDE_JSON_FILE];
      const unrecorded = targets.filter(file => !stateStore.getState(this.name, file));
      const exists = unrecorded.some(file => {
        try { fs.lstatSync(file); return true; }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
      });
      if (exists) throw new Error('No restoration record for existing Claude configuration. Configuration is unchanged; remove legacy credentials manually or recover a known backup.');
      const plans: ConfigPlan[] = [];
      for (const file of targets) {
        if (!stateStore.getState(this.name, file)) continue;
        assertNotSymlink(file);
        const current = readJsonSnapshot(file);
        const saved = checkedState(recoverPending(this.name, file, current.content), file === CLAUDE_SETTINGS_FILE);
        if (!saved) continue;
        const original = originalConfig(saved);
        const manageModel = saved.priors!.manageModel === true;
        const next = restoreConfig(current.value, saved.priors!.snapshot as PriorValues, saved.applied!, file === CLAUDE_SETTINGS_FILE, manageModel);
        const content = current.content === undefined ? undefined
          : isDeepStrictEqual(next, original.value) ? original.content
          : formatJsonLike(current.content, next);
        plans.push({ file, before: current.content, after: content, previous: saved });
      }
      commitConfigs(this.name, plans);
    });
  }

  // 两个文件先全部解析和校验；任何写入失败时还原本轮已提交的文件及状态
  async loadConfig(apiKey: string, baseUrl: string, models: ModelConfig): Promise<void> {
    stateStore.withLock(() => {
      if (stateStore.getState(this.name)) throw new Error('Legacy Claude restoration state requires recovery from backup.');
      const selected = { ...models.claudeCode, ...(models.slotModels?.[this.name]?.fallback ? { haikuModel: models.slotModels[this.name].fallback } : {}), ...(models.slotModels?.[this.name]?.subagent ? { subagentModel: models.slotModels[this.name].subagent } : {}) };
      const clearSelection = !selected.useDefaultModels &&
        [selected.haikuModel, selected.sonnetModel, selected.opusModel, selected.subagentModel].some(Boolean);
      const plans: ConfigPlan[] = [];
      for (const file of [CLAUDE_SETTINGS_FILE, CLAUDE_JSON_FILE]) {
        assertNotSymlink(file);
        const current = readJsonSnapshot(file);
        const settingsFile = file === CLAUDE_SETTINGS_FILE;
        const previous = checkedState(recoverPending(this.name, file, current.content), file === CLAUDE_SETTINGS_FILE);
        const env = current.value.env;
        if (settingsFile && !previous && isRecord(env) && isQiniuBaseUrl(env.ANTHROPIC_BASE_URL) &&
            typeof env.ANTHROPIC_AUTH_TOKEN === 'string' && env.ANTHROPIC_AUTH_TOKEN) {
          throw new Error('Legacy Claude credentials have no restoration record. Configuration is unchanged; remove legacy credentials manually or recover a known backup before loading.');
        }
        const managedBefore = previous?.priors?.manageModel === true;
        const beforeSnapshot = snapshot(current.value, settingsFile, managedBefore);
        if (previous) {
          const expected = structuredClone(previous.applied!);
          // 显式切换允许清掉客户端模型覆盖，其他字段及原恢复快照仍受保护。
          if (clearSelection && settingsFile) {
            delete beforeSnapshot.model; delete expected.model;
            if (isRecord(beforeSnapshot.env)) delete beforeSnapshot.env.ANTHROPIC_MODEL;
            if (isRecord(expected.env)) delete expected.env.ANTHROPIC_MODEL;
          }
          if (!isDeepStrictEqual(beforeSnapshot, expected)) throw new Error('Claude managed fields changed since loading. Unload before reloading.');
        }
        const manageModel = settingsFile && (managedBefore || clearSelection);
        const next = structuredClone(current.value);
        if (settingsFile) {
          const env: Record<string, unknown> = { ...(isRecord(next.env) ? next.env : {}) };
          for (const key of CLAUDE_ENV_KEYS) if (key !== 'ANTHROPIC_MODEL' || clearSelection) delete env[key];
          Object.assign(env, {
            ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_AUTH_TOKEN: apiKey, API_TIMEOUT_MS: API_TIMEOUT,
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_ATTRIBUTION_HEADER: '0',
          });
          if (selected.haikuModel) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = selected.haikuModel;
          if (selected.sonnetModel) env.ANTHROPIC_DEFAULT_SONNET_MODEL = selected.sonnetModel;
          if (selected.opusModel) env.ANTHROPIC_DEFAULT_OPUS_MODEL = selected.opusModel;
          if (selected.subagentModel) env.CLAUDE_CODE_SUBAGENT_MODEL = selected.subagentModel;
          applyClaudeSlotAliases(env, selected);
          next.env = env;
          if (clearSelection) delete next.model;
          next.companyAnnouncements = [t('company_announcement')];
          next.attribution = { commit: '', pr: '' };
        } else next.hasCompletedOnboarding = true;
        const original = previous ? originalConfig(previous) : current;
        const priors = { content: original.content ?? null, snapshot: snapshot(original.value, settingsFile, manageModel), manageModel };
        plans.push({ file, before: current.content, after: formatJsonLike(current.content, next), previous,
          next: { priors, applied: snapshot(next, settingsFile, manageModel) } });
      }
      commitConfigs(this.name, plans);
    });
  }

  // 启动器沿用相同环境配置，清掉父进程可能遗留的模型覆盖
  getLaunchEnv(apiKey: string, baseUrl: string, models: ModelConfig): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = Object.fromEntries(CLAUDE_ENV_KEYS.map(key => [key, undefined]));
    for (const key of ['CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY','CLAUDE_CODE_USE_ANTHROPIC_AWS','CLAUDE_CODE_USE_MANTLE','ANTHROPIC_API_KEY']) env[key] = undefined;
    Object.assign(env, { ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_AUTH_TOKEN: apiKey, API_TIMEOUT_MS: API_TIMEOUT,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_ATTRIBUTION_HEADER: '0' });
    const selected = { ...models.claudeCode, ...(models.slotModels?.[this.name]?.fallback ? { haikuModel: models.slotModels[this.name].fallback } : {}), ...(models.slotModels?.[this.name]?.subagent ? { subagentModel: models.slotModels[this.name].subagent } : {}) };
    if (selected.haikuModel) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = selected.haikuModel;
    if (selected.sonnetModel) env.ANTHROPIC_DEFAULT_SONNET_MODEL = selected.sonnetModel;
    if (selected.opusModel) env.ANTHROPIC_DEFAULT_OPUS_MODEL = selected.opusModel;
    if (selected.subagentModel) env.CLAUDE_CODE_SUBAGENT_MODEL = selected.subagentModel;
    applyClaudeSlotAliases(env, selected);
    return env;
  }

  getLaunchSettings(apiKey: string, baseUrl: string, models: ModelConfig): Record<string, unknown> {
    const env = Object.fromEntries(Object.entries(this.getLaunchEnv(apiKey, baseUrl, models)).map(([key,value]) => [key,value ?? '']));
    return { env };
  }

  // 从 Claude Code 移除配置
  unloadConfig(): void {
    this.clearModelConfig();
  }

  async runModelConfigFlow(): Promise<boolean> {
    return runModelSelectionFlow();
  }

  renderModelConfigSummary(): void {
    const claudeCode = configManager.getModels().claudeCode || {};
    uiRenderer.renderModelConfigItem(t('config_view_haiku'), claudeCode.haikuModel);
    uiRenderer.renderModelConfigItem(t('config_view_sonnet'), claudeCode.sonnetModel);
    uiRenderer.renderModelConfigItem(t('config_view_opus'), claudeCode.opusModel);
    uiRenderer.renderModelConfigItem(t('config_view_subagent'), claudeCode.subagentModel);
  }

}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// 缺失字段不存入快照，从而与显式 null 区分
function snapshot(config: Record<string, unknown>, settings: boolean, model: boolean, keys = CLAUDE_ENV_KEYS): PriorValues {
  const result: PriorValues = {};
  if (settings && Object.hasOwn(config, 'env')) {
    if (!isRecord(config.env)) throw new Error('Invalid Claude env: expected an object.');
    result.env = Object.fromEntries(keys.filter(key => Object.hasOwn(config.env!, key)).map(key => [key, (config.env as PriorValues)[key]]));
  }
  for (const key of settings ? ['companyAnnouncements', 'attribution', ...(model ? ['model'] : [])] : ['hasCompletedOnboarding']) {
    if (Object.hasOwn(config, key)) result[key] = structuredClone(config[key]);
  }
  return result;
}

function originalConfig(saved: ToolState): { content: string | undefined; value: Record<string, unknown> } {
  const content = saved.priors!.content as string | null;
  const value: unknown = content === null ? {} : JSON.parse(content);
  if (!isRecord(value)) throw new Error('Invalid Claude restoration content.');
  return { content: content ?? undefined, value };
}

function recoverPending(tool: string, file: string, content: string | undefined): ToolState | undefined {
  const saved = stateStore.getState(tool, file);
  if (!saved?.pending) return saved;
  let recovered: ToolState | undefined;
  if (content === saved.pending.after) recovered = { priors: saved.priors, applied: saved.pending.applied };
  else if ((content ?? null) === saved.pending.before) recovered = saved.applied ? { priors: saved.priors, applied: saved.applied } : undefined;
  else throw new Error('Claude configuration changed during an interrupted write; restoration journal retained.');
  stateStore.setState(tool, recovered, file);
  return recovered;
}

function checkedState(saved: ToolState | undefined, settings: boolean): ToolState | undefined {
  if (saved && (!isRecord(saved.priors?.snapshot) || !isRecord(saved.applied) ||
      !(saved.priors.content === null || typeof saved.priors.content === 'string') ||
      typeof saved.priors.manageModel !== 'boolean')) {
    throw new Error('Claude restoration state is incomplete. Restore from backup before retrying.');
  }
  if (saved) {
    const original = originalConfig(saved);
    const model = saved.priors!.manageModel === true;
    const expected = snapshot(original.value, settings, model);
    if (!isDeepStrictEqual(expected, saved.priors!.snapshot)) {
      // 旧版本尚未管理别名字段：只接受与旧键集合完全一致的快照，并从原文件补齐原值。
      if (!settings || !isDeepStrictEqual(snapshot(original.value, settings, model, CLAUDE_LEGACY_ENV_KEYS), saved.priors!.snapshot) ||
          !isDeepStrictEqual(snapshot(saved.applied!, settings, model, CLAUDE_LEGACY_ENV_KEYS), saved.applied)) {
        throw new Error('Claude restoration snapshot is inconsistent. Restore from backup before retrying.');
      }
      saved = structuredClone(saved);
      saved.priors!.snapshot = expected;
      const originalEnv = isRecord(original.value.env) ? original.value.env : {};
      const appliedEnv = isRecord(saved.applied!.env) ? saved.applied!.env : {};
      for (const key of CLAUDE_SLOT_ALIAS_KEYS) if (Object.hasOwn(originalEnv, key)) appliedEnv[key] = structuredClone(originalEnv[key]);
      if (Object.hasOwn(original.value, 'env') || Object.hasOwn(saved.applied!, 'env')) saved.applied!.env = appliedEnv;
    }
    if (!isDeepStrictEqual(snapshot(saved.applied!, settings, model), saved.applied)) {
      throw new Error('Claude restoration snapshot is inconsistent. Restore from backup before retrying.');
    }
  }
  return saved;
}

// 三方还原仅撤销仍等于上次写入值的键，后续手动编辑保留
function restoreConfig(config: Record<string, unknown>, prior: PriorValues, applied: PriorValues, settings: boolean, model: boolean): Record<string, unknown> {
  if (settings) {
    const env = isRecord(config.env) ? config.env : {};
    const previous = isRecord(prior.env) ? prior.env : {};
    const written = isRecord(applied.env) ? applied.env : {};
    const keys = ['ANTHROPIC_BASE_URL','ANTHROPIC_AUTH_TOKEN'];
    const equals = (target: PriorValues) => keys.every(key => isDeepStrictEqual(env[key],target[key]));
    if (!equals(written) && !equals(previous)) throw new Error('Claude endpoint and credential changed; restore both together before unloading. Configuration is unchanged.');
  }
  const next = structuredClone(config);
  const current = snapshot(config, settings, model);
  const restore = (target: PriorValues, key: string, original: PriorValues, written: PriorValues): void => {
    const own = (object: PriorValues) => Object.hasOwn(object, key) ? object[key] : undefined;
    if (!isDeepStrictEqual(own(target), own(written))) return;
    if (Object.hasOwn(original, key)) target[key] = structuredClone(original[key]);
    else delete target[key];
  };
  for (const key of new Set([...Object.keys(prior), ...Object.keys(applied)])) {
    if (key === 'env' && isRecord(next.env)) {
      for (const envKey of CLAUDE_ENV_KEYS) restore(next.env, envKey, isRecord(prior.env) ? prior.env : {}, isRecord(applied.env) ? applied.env : {});
      if (!Object.keys(next.env).length && !Object.hasOwn(prior, 'env')) delete next.env;
    } else if (key !== 'env') {
      restore(current, key, prior, applied);
      if (Object.hasOwn(current, key)) next[key] = current[key];
      else delete next[key];
    }
  }
  return next;
}

interface ConfigPlan { file: string; before: string | undefined; after: string | undefined; previous?: ToolState; next?: ToolState; }

function commitConfigs(tool: string, plans: ConfigPlan[]): void {
  const saved: ConfigPlan[] = [];
  const written: ConfigPlan[] = [];
  const uncertain = new Set<ConfigPlan>();
  const write = (file: string, content: string | undefined, expected: string | undefined): void => {
    if (content === undefined) writeJsonOrRemove(file, {}, { content: expected });
    else safeWriteFile(file, content, 0o600, { content: expected });
  };
  try {
    // 先保存装载快照，卸载记录只在两份文件都成功后清除
    for (const plan of plans) if (plan.next) {
      saved.push(plan);
      stateStore.setState(tool, { priors: plan.next.priors, applied: plan.previous?.applied,
        pending: { before: plan.before ?? null, after: plan.after!, applied: plan.next.applied! } }, plan.file);
    }
    for (const plan of plans) {
      try { write(plan.file, plan.after, plan.before); }
      catch (error) {
        try {
          const current = readTextFile(plan.file);
          if (current === plan.after) written.push(plan);
          else if (current !== plan.before) uncertain.add(plan);
        } catch { uncertain.add(plan); }
        throw error;
      }
      written.push(plan);
    }
    for (const plan of plans) {
      if (plan.next) stateStore.setState(tool, plan.next, plan.file);
    }
    const removals = plans.filter(plan => !plan.next);
    if (removals.length) { saved.push(...removals); stateStore.markRemovedMany(tool, removals.map(plan => plan.file)); }
  } catch (error) {
    const failures: unknown[] = [];
    const restored = new Set<ConfigPlan>();
    for (const plan of [...written].reverse()) {
      try { write(plan.file, plan.before, plan.after); restored.add(plan); }
      catch (err) {
        try { if (readTextFile(plan.file) === plan.before) restored.add(plan); else failures.push(err); }
        catch { failures.push(err); }
      }
    }
    // 回滚文件失败时保留恢复记录，避免失去唯一原值
    for (const plan of [...saved].reverse()) {
      // An unload may already have deleted a record before a later cleanup fails.
      // Restore those records even if rolling client files back also failed.
      if (!uncertain.has(plan) && (!plan.next || !written.includes(plan) || restored.has(plan))) {
        try { stateStore.setState(tool, plan.previous, plan.file); } catch (err) { failures.push(err); }
      }
    }
    if (failures.length) throw new AggregateError([error, ...failures], 'Claude configuration recovery failed. Restore from backup before retrying.');
    throw error;
  }
}

// 同步旧快速模型入口与 /model 列表别名，卸载时仍按事务快照逐字段还原。
function applyClaudeSlotAliases(env: Record<string, unknown>, selected: ClaudeCodeConfig): void {
  if (selected.haikuModel) {
    env.ANTHROPIC_SMALL_FAST_MODEL = selected.haikuModel;
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION = t('claude_slot_desc_haiku');
  }
  if (selected.sonnetModel) env.ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION = t('claude_slot_desc_sonnet');
  if (selected.opusModel) {
    env.ANTHROPIC_DEFAULT_FABLE_MODEL = selected.opusModel;
    env.ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION = t('claude_slot_desc_opus');
    env.ANTHROPIC_DEFAULT_FABLE_MODEL_DESCRIPTION = t('claude_slot_desc_fable');
  }
}
