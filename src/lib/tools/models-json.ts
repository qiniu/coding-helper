import { isDeepStrictEqual } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { assertNotSymlink, ConfigParseError, readJsonSnapshot, readTextFile, formatJsonLike, safeWriteFile, writeJson, writeJsonOrRemove } from '../core/safe-write.js';
import { stateStore, type PriorValues, type ToolState } from '../core/state-store.js';

export const QINIU_VENDOR = 'Qiniu';
interface VendorModel { id: string; vendor?: string; }
const fields = ['models', 'availableModels'] as const;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isQiniu = (model: VendorModel): boolean => model.vendor === QINIU_VENDOR;

// WorkBuddy 桌面端使用数组；内部统一为对象，复用合并、冲突检测和恢复日志。
function parseWorkBuddyDocument(file: string, content: string | undefined): { value: Record<string, unknown>; array: boolean } {
  if (content === undefined) return { value: {}, array: true };
  let parsed: unknown;
  try { parsed = JSON.parse(content); }
  catch (err) { throw new ConfigParseError(file, err); }
  if (!Array.isArray(parsed) && !record(parsed)) {
    throw new ConfigParseError(file, new Error('top-level value is not an object or model array'));
  }
  const value = Array.isArray(parsed) ? { models: parsed } : parsed;
  validate(value);
  return { value, array: Array.isArray(parsed) };
}

function readModelsSnapshot(tool: string, file: string): { content: string | undefined; value: Record<string, unknown>; array: boolean } {
  if (tool !== 'workbuddy') return { ...readJsonSnapshot(file), array: false };
  const content = readTextFile(file);
  return { content, ...parseWorkBuddyDocument(file, content) };
}

export function readModelsJson(tool: string, file: string): Record<string, unknown> {
  return readModelsSnapshot(tool, file).value;
}

// 数组没有 availableModels；允许桌面端把旧对象转存为数组，但仍逐项检查模型内容。
function snapshotForFormat(snapshot: PriorValues, array: boolean): PriorValues {
  return array ? { models: snapshot.models ?? [] } : snapshot;
}

function canonicalFile(file: string): string {
  const parent = (dir: string): string => {
    try { return fs.realpathSync(dir); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || path.dirname(dir) === dir) throw error;
      return path.join(parent(path.dirname(dir)), path.basename(dir));
    }
  };
  return path.join(parent(path.dirname(path.resolve(file))), path.basename(file));
}

function jsonSnapshot(value: unknown): unknown { return JSON.parse(JSON.stringify(value)); }

// 不猜测损坏字段的含义；拒绝覆盖，交由用户修复后重试
function validate(config: Record<string, unknown>): void {
  if (Object.hasOwn(config, 'models') && (!Array.isArray(config.models) ||
      !config.models.every(m => record(m) && typeof m.id === 'string' && m.id.length > 0))) {
    throw new Error('Invalid models.json models: expected an array of objects with nonempty IDs.');
  }
  if (Object.hasOwn(config, 'availableModels') && (!Array.isArray(config.availableModels) ||
      !config.availableModels.every(id => typeof id === 'string'))) {
    throw new Error('Invalid models.json availableModels: expected a string array.');
  }
}

export function captureModelsJsonPriors(config: Record<string, unknown>): PriorValues {
  validate(config);
  const result: PriorValues = {};
  for (const key of fields) if (Object.hasOwn(config, key)) result[key] = jsonSnapshot(config[key]);
  return result;
}

// 只替换七牛模型，保留其他供应商条目（包括顺序和重复项）
export function applyModelsJson(config: Record<string, unknown>, qiniuModels: VendorModel[]): Record<string, unknown> {
  validate(config);
  validate({ models: qiniuModels });
  if (!qiniuModels.length || qiniuModels.some(m => !isQiniu(m))) throw new Error('Expected nonempty Qiniu models.');
  const previous = (config.models ?? []) as VendorModel[];
  const others = previous.filter(m => !isQiniu(m));
  const foreignIds = new Set(others.map(m => m.id));
  const selected = new Map<string, VendorModel>();
  for (const model of qiniuModels) {
    if (foreignIds.has(model.id)) throw new Error('Model ID belongs to another vendor: ' + model.id);
    if (!selected.has(model.id)) selected.set(model.id, model);
  }
  const oldIds = new Set(previous.filter(isQiniu).map(m => m.id));
  const next = structuredClone(config);
  next.models = structuredClone([...others, ...selected.values()]);
  const available = Array.isArray(config.availableModels)
    ? (config.availableModels as string[]).filter(id => !oldIds.has(id) || foreignIds.has(id))
    : others.map(m => m.id);
  next.availableModels = [...available, ...[...selected.keys()].filter(id => !available.includes(id))];
  return next;
}

// 数组内的后续编辑无法可靠判断所有权，明确报错而不是丢弃用户修改
export function revertModelsJson(config: Record<string, unknown>, priors: PriorValues, applied: PriorValues): Record<string, unknown> {
  if (!isDeepStrictEqual(captureModelsJsonPriors(config), applied)) {
    throw new Error('models.json managed fields changed since loading. Restore those fields from backup before retrying.');
  }
  validate(priors);
  const next = structuredClone(config);
  for (const key of fields) {
    if (Object.hasOwn(priors, key)) next[key] = structuredClone(priors[key]);
    else delete next[key];
  }
  return next;
}

function checkedState(tool: string, file: string, saved: ToolState | undefined): ToolState | undefined {
  if (saved && (!record(saved.priors?.snapshot) || !record(saved.applied) ||
      !(saved.priors.content === null || typeof saved.priors.content === 'string'))) {
    throw new Error('models.json restoration state is incomplete. Restore from backup before retrying.');
  }
  if (saved) {
    const content = saved.priors!.content;
    const original: unknown = tool === 'workbuddy'
      ? parseWorkBuddyDocument(file, content === null ? undefined : content as string).value
      : content === null ? {} : JSON.parse(content as string);
    if (!record(original) || !isDeepStrictEqual(captureModelsJsonPriors(original), saved.priors!.snapshot)) {
      throw new Error('models.json restoration snapshot does not match the original content.');
    }
    validate(saved.applied!);
  }
  return saved;
}

// 桌面端可能在日志提交前把对象转存成数组；只认可模型内容完全相同的转换。
function matchesPendingContent(tool: string, file: string, content: string | undefined, expected: string | null): boolean {
  if ((content ?? null) === expected) return true;
  if (tool !== 'workbuddy' || content === undefined || expected === null) return false;
  const current = parseWorkBuddyDocument(file, content);
  if (!current.array) return false;
  const previous = parseWorkBuddyDocument(file, expected);
  return isDeepStrictEqual(current.value.models, previous.value.models);
}

// 使用已提交快照前先协调上次中断的写入。
function recoverPending(tool: string, file: string, content: string | undefined): ToolState | undefined {
  const saved = stateStore.getState(tool, file);
  if (!saved?.pending) return saved;
  let recovered: ToolState | undefined;
  if (matchesPendingContent(tool, file, content, saved.pending.after)) recovered = { priors: saved.priors, applied: saved.pending.applied };
  else if (matchesPendingContent(tool, file, content, saved.pending.before)) recovered = saved.applied ? { priors: saved.priors, applied: saved.applied } : undefined;
  else throw new Error('models.json changed during an interrupted write; restoration journal retained.');
  stateStore.setState(tool, recovered, file);
  return recovered;
}

// 同步事务：调用方在获取市场元数据后调用，读取和写入共用锁及同一内容快照
export function loadModelsJson(tool: string, file: string, models: VendorModel[]): void {
  file = canonicalFile(file);
  stateStore.withLock(() => {
    assertNotSymlink(file);
    const { value: config, content, array } = readModelsSnapshot(tool, file);
    const previous = checkedState(tool, file, recoverPending(tool, file, content));
    if (!previous && stateStore.getState(tool)) throw new Error('Legacy restoration state requires recovery from backup.');
    const snapshot = captureModelsJsonPriors(config);
    if (previous && !isDeepStrictEqual(snapshotForFormat(snapshot, array), snapshotForFormat(previous.applied!, array))) {
      throw new Error('models.json managed fields changed since loading. Restore those fields from backup before retrying.');
    }
    const next = applyModelsJson(config, models);
    const priors = previous?.priors ?? { snapshot, content: content ?? null };
    const applied = snapshotForFormat(captureModelsJsonPriors(next), array);
    const after = formatJsonLike(content, array ? next.models : next);
    stateStore.setState(tool, { priors, applied: previous?.applied, pending: { before: content ?? null, after, applied } }, file);
    try { safeWriteFile(file, after, 0o600, { content }); }
    catch (err) {
      // 仅确认仍是写入前版本才撤销日志；无法读取或出现第三种内容时保留原值。
      try { if (readTextFile(file) === content) stateStore.setState(tool, previous, file); } catch { /* 保留待恢复日志 */ }
      throw err;
    }
    stateStore.setState(tool, { priors, applied }, file);
  });
}

export function unloadModelsJson(tool: string, file: string): void {
  file = canonicalFile(file);
  stateStore.withLock(() => {
    if (!stateStore.getState(tool, file)) {
      if (readTextFile(file) !== undefined) throw new Error('No restoration record for models.json. Configuration is unchanged; remove legacy credentials manually or recover a known backup.');
      return;
    }
    assertNotSymlink(file);
    const { value: config, content, array } = readModelsSnapshot(tool, file);
    const saved = checkedState(tool, file, recoverPending(tool, file, content));
    if (!saved) return;
    if (content === undefined && saved.priors!.content !== null) throw new Error('models.json changed since loading: original file was deleted; restoration journal retained.');
    if (content !== undefined) {
      const snapshot = snapshotForFormat(captureModelsJsonPriors(config), array);
      const next = isDeepStrictEqual(snapshot, snapshotForFormat(saved.priors!.snapshot as PriorValues, array))
        ? config : revertModelsJson(config, saved.priors!.snapshot as PriorValues, snapshotForFormat(saved.applied!, array));
      const original = saved.priors!.content as string | null;
      // 未发生额外编辑时逐字节还原，包括 CRLF、空格、字段顺序和末尾换行
      // 数组内全部是受管字段，核验通过后直接恢复原始文本及其原来的顶层格式。
      if (original !== null && (array || isDeepStrictEqual(jsonSnapshot(next), jsonSnapshot(JSON.parse(original))))) {
        safeWriteFile(file, original, 0o600, { content });
      } else if (original !== null) writeJson(file, next, { content });
      else writeJsonOrRemove(file, array ? {} : next, { content });
    }
    stateStore.markRemoved(tool, file);
  });
}
