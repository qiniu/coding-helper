import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { atomicWriteFile, ConfigParseError, helperDir, readTextFile } from './safe-write.js';

// 被七牛覆盖前的原值；null 表示原本不存在
export type PriorValues = Record<string, unknown>;

export interface ToolState {
  // 首次写入前记录的原值，卸载时按此还原
  priors?: PriorValues;
  // 最近一次实际写入的字段，用于检测装载后的外部编辑
  applied?: PriorValues;
  // 客户端写入与状态提交之间的日志；applied 保留上次已提交快照
  pending?: { before: string | null; after: string; applied: PriorValues };
}

interface StateFile {
  version: 1;
  tools: Record<string, ToolState>;
}

// 记录客户端被覆盖前的原值（~/.coding-helper/state.json）
class StateStore {
  private lockDepth = 0;
  private file(): string {
    return path.join(helperDir(), 'state.json');
  }

  private read(): StateFile {
    const file = this.file();
    const content = readTextFile(file);
    if (content === undefined) return { version: 1, tools: {} };
    try {
      const parsed: unknown = JSON.parse(content);
      const record = (value: unknown): value is Record<string, unknown> =>
        value !== null && typeof value === 'object' && !Array.isArray(value);
      if (!record(parsed) || parsed.version !== 1 || !record(parsed.tools) ||
          Object.values(parsed.tools).some((entry) => !record(entry) ||
            (entry.priors !== undefined && !record(entry.priors)) ||
            (entry.applied !== undefined && !record(entry.applied)) ||
            (entry.pending !== undefined && (!record(entry.pending) ||
              (entry.pending.before !== null && typeof entry.pending.before !== 'string') ||
              typeof entry.pending.after !== 'string' || !record(entry.pending.applied))))) {
        throw new Error('Invalid or unsupported restoration state');
      }
      // 读取时识别旧版路径别名；冲突记录不能任意选一个覆盖原值。
      const tools: Record<string, ToolState> = {};
      for (const [storedKey, value] of Object.entries(parsed.tools)) {
        let identity: unknown;
        try { identity = JSON.parse(storedKey); } catch { /* 兼容不带文件的工具记录 */ }
        const key = Array.isArray(identity) && identity.length === 2 && typeof identity[0] === 'string' && typeof identity[1] === 'string'
          ? this.key(identity[0], identity[1]) : storedKey;
        if (Object.hasOwn(tools, key) && !isDeepStrictEqual(tools[key], value)) throw new Error('Conflicting restoration records refer to the same file. Recover the original state before retrying.');
        Object.defineProperty(tools, key, {value,enumerable:true,writable:true,configurable:true});
      }
      return { version: 1, tools };
    } catch (err) {
      // 不能把损坏的还原记录当空状态，否则后续装载会覆盖唯一的原值
      throw new ConfigParseError(file, err);
    }
  }

  private write(state: StateFile): void {
    atomicWriteFile(this.file(), JSON.stringify(state, null, 2) + '\n');
  }

  // 文件路径参与身份，防止不同 XDG 配置目录共享还原记录
  private key(tool: string, file?: string): string {
    if (file === undefined) return tool;
    const parent = (dir: string): string => {
      try { return fs.realpathSync(dir); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || path.dirname(dir) === dir) throw error;
        return path.join(parent(path.dirname(dir)), path.basename(dir));
      }
    };
    const canonical = path.join(parent(path.dirname(path.resolve(file))), path.basename(file));
    return JSON.stringify([tool, canonical]);
  }

  // 跨进程串行化“读取原值—写入客户端—更新状态”；回调必须同步完成
  withLock<T>(operation: () => T): T {
    if (this.lockDepth > 0) return operation();
    fs.mkdirSync(helperDir(), { recursive: true, mode: 0o700 });
    const lock = path.join(helperDir(), 'state.lock');
    let descriptor: number;
    try {
      descriptor = fs.openSync(lock, 'wx', 0o600);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error('Another configuration operation holds ' + lock + '. Retry after it finishes; remove a stale lock only after confirming no helper is running.');
      }
      throw err;
    }
    this.lockDepth++;
    try { return operation(); }
    finally {
      this.lockDepth--;
      fs.closeSync(descriptor);
      fs.rmSync(lock, { force: true });
    }
  }

  getState(tool: string, file?: string): ToolState | undefined {
    const tools = this.read().tools;
    const key = this.key(tool, file);
    return Object.hasOwn(tools, key) ? tools[key] : undefined;
  }

  // 查找同一工具的文件记录，避免顺序和部分重叠绕过原值保护。
  getFileStates(tool: string): { file: string; state: ToolState }[] {
    return Object.entries(this.read().tools).flatMap(([key, state]) => {
      try {
        const identity: unknown = JSON.parse(key);
        return Array.isArray(identity) && identity.length === 2 && identity[0] === tool && typeof identity[1] === 'string'
          ? [{ file: identity[1], state }] : [];
      } catch { return []; }
    });
  }

  // 完整替换一条事务记录，用于装载成功后的快照及失败回滚
  setState(tool: string, value: ToolState | undefined, file?: string): void {
    this.withLock(() => {
      const state = this.read();
      const key = this.key(tool, file);
      if (value === undefined) delete state.tools[key];
      else Object.defineProperty(state.tools, key, { value, enumerable: true, configurable: true, writable: true });
      this.write(state);
    });
  }

  // 卸载后移除记录（连同原值），下次装载重新记录
  markRemoved(tool: string, file?: string): void {
    this.withLock(() => {
      if (this.getState(tool, file) !== undefined) this.setState(tool, undefined, file);
    });
  }

  getPriors(tool: string, file?: string): PriorValues | undefined {
    tool = this.key(tool, file);
    const tools = this.read().tools;
    return Object.hasOwn(tools, tool) ? tools[tool]?.priors : undefined;
  }

  // 只记录第一次看到的原值，重复装载时不会被七牛自己写入的值覆盖
  recordPriors(tool: string, priors: PriorValues, file?: string): void {
    this.withLock(() => {
      const current = this.getState(tool, file);
      this.setState(tool, { ...current, priors: { ...priors, ...current?.priors } }, file);
    });
  }

  clear(): void {
    this.withLock(() => fs.rmSync(this.file(), { force: true }));
  }
}

export const stateStore = new StateStore();
