import fs from 'node:fs';
import path from 'node:path';
import { stateStore, type ToolState } from './state-store.js';
import { atomicWriteFile, assertNotSymlink, readTextFile, safeWriteFile, writeJsonOrRemove } from './safe-write.js';

export interface ConfigEdit { file: string; build: (content: string | undefined) => string; }
interface Entry { file: string; original: string | null; applied: string; before?: string | null; }
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

// 父目录解析别名，文件自身的链接仍拒绝；同一配置只有一份还原记录
function canonical(file: string): string {
  const dir = (value: string): string => {
    try { return fs.realpathSync(value); }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT' || path.dirname(value) === value) throw err;
      return path.join(dir(path.dirname(value)), path.basename(value));
    }
  };
  return path.join(dir(path.dirname(path.resolve(file))), path.basename(file));
}

function entries(saved: ToolState | undefined, files: string[]): Entry[] | undefined {
  if (!saved) return undefined;
  const values = saved.priors?.files;
  if (!Array.isArray(values) || values.length !== files.length || values.some((entry, i) =>
    !record(entry) || !files.includes(entry.file as string) || !(entry.original === null || typeof entry.original === 'string') || typeof entry.applied !== 'string' || (Object.hasOwn(entry, 'before') && entry.before !== null && typeof entry.before !== 'string'))) {
    throw new Error('Invalid configuration transaction state. Restore from backup before retrying.');
  }
  if (new Set(values.map(entry => entry.file)).size !== files.length) throw new Error('Invalid configuration transaction targets.');
  return files.map(file => (values as Entry[]).find(entry => entry.file === file)!);
}
function transaction(tool: string, files: string[]): { key: string; saved: ToolState | undefined } {
  const overlapping = stateStore.getFileStates(tool).filter(({ file, state }) => files.includes(file) ||
    (Array.isArray(state.priors?.files) && state.priors.files.some(entry => record(entry) && files.includes(entry.file as string))));
  if (overlapping.length > 1) throw new Error('Overlapping configuration transactions require recovery before retrying.');
  return { key: overlapping[0]?.file ?? [...files].sort()[0], saved: overlapping[0]?.state };
}
function write(file: string, value: string | undefined, expected: string | undefined): void {
  if (value === undefined) writeJsonOrRemove(file, {}, { content: expected });
  else if (!value.trim() && readTextFile(file) === undefined) {
    // Unlike generic safeWriteFile, a transaction must materialize its recorded bytes.
    assertNotSymlink(file);
    atomicWriteFile(file, value, 0o600, () => {
      if (readTextFile(file) !== expected) throw new Error('Configuration changed before writing: ' + file);
    });
  } else safeWriteFile(file, value, 0o600, { content: expected });
}

// 整组文件校验完成后才写入。文本修改无法可靠推断所有权时停止，绝不覆盖外部编辑。
export function applyConfigEdits(tool: string, edits: ConfigEdit[]): void {
  stateStore.withLock(() => {
    if (!edits.length) throw new Error('Configuration transaction requires files.');
    const files = edits.map(edit => canonical(edit.file));
    if (new Set(files).size !== files.length) throw new Error('Duplicate configuration target.');
    files.forEach(assertNotSymlink);
    const { key, saved: previous } = transaction(tool, files);
    const old = entries(previous, files);
    if (!previous && stateStore.getState(tool)) throw new Error('Legacy state requires recovery before configuration.');
    const before = files.map(readTextFile);
    if (old?.some((entry, i) => before[i] !== entry.applied && !(Object.hasOwn(entry, 'before') && (before[i] ?? null) === entry.before))) throw new Error('Configuration changed since loading. Restore from backup before retrying.');
    const after = edits.map((edit, i) => edit.build(before[i]));
    const next: Entry[] = files.map((file, i) => ({ file, original: old ? old[i].original : before[i] ?? null, applied: after[i], before: before[i] ?? null }));
    // 日志先落盘，异常退出仍保留原值；普通写入失败回滚本轮
    stateStore.setState(tool, { priors: { files: next } }, key);
    let completed = 0;
    try {
      for (let i = 0; i < files.length; i++) { write(files[i], after[i], before[i]); completed++; }
    } catch (error) {
      // rename may have succeeded before a wrapper/cleanup reported failure.
      const failures: unknown[] = [];
      if (completed < files.length) {
        try {
          const current = readTextFile(files[completed]);
          if (current === after[completed]) completed++;
          else if (current !== before[completed]) failures.push(new Error('Failed target changed; restoration journal retained.'));
        } catch (err) { failures.push(err); }
      }
      for (let i = completed - 1; i >= 0; i--) {
        try { write(files[i], before[i], after[i]); } catch (err) { failures.push(err); }
      }
      if (!failures.length) stateStore.setState(tool, previous, key);
      if (failures.length) throw new AggregateError([error, ...failures], 'Configuration rollback failed; recover from recorded originals/backups.');
      throw error;
    }
    // Only discard the before images after every client write succeeds.
    stateStore.setState(tool, { priors: { files: next.map(({ before: _before, ...entry }) => entry) } }, key);
  });
}

export function restoreConfigEdits(tool: string, targets: string[]): boolean {
  return stateStore.withLock(() => {
    if (!targets.length) return false;
    const files = targets.map(canonical);
    const { key, saved } = transaction(tool, files);
    const old = entries(saved, files);
    if (!old) return false;
    files.forEach(assertNotSymlink);
    const before = files.map(readTextFile);
    // 允许卸载中断后重试；原有文件被外部删除时保留唯一还原记录。
    if (old.some((entry, i) => (before[i] === undefined && entry.original !== null) || before[i] !== entry.applied && before[i] !== (entry.original ?? undefined) && !(Object.hasOwn(entry, 'before') && (before[i] ?? null) === entry.before))) {
      throw new Error('Configuration changed since loading. Restore from backup before retrying.');
    }
    for (let i = 0; i < files.length; i++) {
      if (before[i] !== undefined) write(files[i], old[i].original ?? undefined, before[i]);
    }
    stateStore.markRemoved(tool, key);
    return true;
  });
}

// 严格 JSON 对象解析供事务内复用，空文件不当成丢失文件
export function parseConfigObject(content: string | undefined): Record<string, unknown> {
  if (content === undefined) return {};
  const parsed: unknown = JSON.parse(content);
  if (!record(parsed)) throw new Error('Configuration must contain a JSON object.');
  return parsed;
}
