import fs from 'node:fs';
import path from 'node:path';
import type { ITool } from '../tools/base-tool.js';
import { stateStore, type ToolState } from './state-store.js';
import { atomicWriteFile, backupsRoot, isPreview, readTextFile } from './safe-write.js';

// 还原记录涉及的文件：记录键本身，以及多文件事务里列出的全部目标
function recordFiles(states: { file: string; state: ToolState }[]): string[] {
  const files = new Set<string>();
  for (const { file, state } of states) {
    files.add(file);
    const listed = state.priors?.files;
    if (Array.isArray(listed)) for (const entry of listed) {
      if (entry && typeof entry === 'object' && typeof (entry as { file?: unknown }).file === 'string') files.add((entry as { file: string }).file);
    }
  }
  return [...files];
}

// 是否有还原记录（文件记录或旧版按工具名的记录）
export function hasRestoreRecord(tool: Pick<ITool, 'name'>): boolean {
  try { return stateStore.getRecordedTools().includes(tool.name); } catch { return false; }
}

// 递归收集值里的 URL（字段记录是对象，多文件事务记录是整个文件文本）
function urls(value: unknown, found = new Set<string>()): Set<string> {
  if (typeof value === 'string') for (const match of value.match(/https?:\/\/[^\s"'`,;)}\]]+/g) ?? []) found.add(match.replace(/\/+$/, ''));
  else if (Array.isArray(value)) for (const item of value) urls(item, found);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) urls(item, found);
  return found;
}

// 某条记录里由助手写入的地址（写入后的值里有、原值里没有的 URL）当前是否还在文件里：
// 'ours' = 仍在（配置仍是助手写的，可能只是线路识别变了或在另一个目录），'gone' = 都不在了（外部改过），'unknown' = 无从判断
function recordStatus(tool: ITool, file: string, state: ToolState): 'ours' | 'gone' | 'unknown' {
  const evidence: { written: Set<string>; content: string | undefined }[] = [];
  const entries = state.priors?.files;
  if (Array.isArray(entries)) {
    // 适配器能识别当前实际路由时，残留的 provider、注释和模型目录不参与判断。
    if (tool.hasSwitchedProvider) {
      if (!entries.length || entries.some(entry => !entry || typeof entry !== 'object' || typeof entry.file !== 'string' || typeof entry.applied !== 'string')) return 'unknown';
      return tool.hasSwitchedProvider(entries as { file: string; applied: string }[]) ? 'gone' : 'ours';
    }
    for (const entry of entries as { file?: unknown; original?: unknown; applied?: unknown }[]) {
      if (!entry || typeof entry.file !== 'string') continue;
      const original = urls(entry.original);
      evidence.push({ written: new Set([...urls(entry.applied)].filter(url => !original.has(url))), content: readTextFile(entry.file) });
    }
  } else {
    const original = urls(state.priors);
    evidence.push({ written: new Set([...urls(state.applied)].filter(url => !original.has(url))), content: readTextFile(file) });
  }
  let gone = false;
  for (const { written, content } of evidence) {
    if (!written.size) continue;
    if ([...written].some(url => content?.includes(url))) return 'ours';
    gone = true;
  }
  return gone ? 'gone' : 'unknown';
}

// 写入中断留下的日志：字段记录的 pending，或多文件事务里未清除的 before
function hasUnfinishedWrite(state: ToolState | undefined): boolean {
  if (!state) return false;
  if (state.pending) return true;
  const entries = state.priors?.files;
  return Array.isArray(entries) && entries.some(entry => !!entry && typeof entry === 'object' && Object.hasOwn(entry, 'before'));
}

// 外部已切到其他服务：优先由适配器比较实际路由；其他工具仍使用写入地址消失的证据。
// 目录不匹配、无法确定路由或有中断写入时，仍保留恢复记录。
export function isExternallyModified(tool: ITool): boolean {
  if (tool.launchOnly || !hasRestoreRecord(tool)) return false;
  try {
    if (tool.isConfigured?.() !== false) return false;
    const states = stateStore.getFileStates(tool.name);
    const legacy = stateStore.getState(tool.name);
    if (hasUnfinishedWrite(legacy) || states.some(entry => hasUnfinishedWrite(entry.state))) return false;
    // 旧版按工具名的记录没有写入快照和文件路径可核对；适配器迁移又要求当前仍是七牛，外部切换后只能以当前配置为基线（记录归档在清单里）
    if (!states.length) return !!legacy;
    if (legacy) return false;
    const statuses = states.map(({ file, state }) => recordStatus(tool, file, state));
    return statuses.includes('gone') && (tool.hasSwitchedProvider ? statuses.every(status => status === 'gone') : !statuses.includes('ours'));
  } catch { return false; }
}

export interface RebaselineResult { backupDir?: string; files: string[]; }

// 先归档旧记录和当前文件，再以当前内容建立事务基线，保留配置档等已托管文件的归属。
// 字段式记录由下次装载重新捕获；预演只更新内存视图。
export function rebaselineTool(tool: ITool): RebaselineResult {
  return stateStore.withLock(() => {
    // 仍在使用七牛或有中断写入时，不能替换唯一的撤销依据。
    if (tool.isConfigured?.() === true) throw new Error('Current configuration still uses Qiniu. Restore it instead of rebaselining.');
    const states = stateStore.getFileStates(tool.name);
    const legacy = stateStore.getState(tool.name);
    if (!states.length && !legacy) return { files: [] };
    if (!isExternallyModified(tool)) throw new Error('The restore record still matches the helper-written configuration or a write was interrupted. Recover it instead of rebaselining.');
    const files = recordFiles(states);
    const snapshots = new Map(files.map(file => [file, readTextFile(file)]));
    const replacements = states.flatMap(({ file, state }) => {
      const entries = state.priors?.files;
      if (!Array.isArray(entries)) return [];
      const baseline = entries.flatMap(entry => {
        if (!entry || typeof entry !== 'object' || typeof entry.file !== 'string' || typeof entry.applied !== 'string' || !(entry.original === null || typeof entry.original === 'string')) throw new Error('Invalid configuration transaction state.');
        const current = snapshots.get(entry.file);
        return current === undefined ? [] : [{ file: entry.file, original: current, applied: current }];
      });
      return baseline.length ? [{ file, state: { priors: { files: baseline } } }] : [];
    });
    let backupDir: string | undefined;
    if (!isPreview()) {
      const root = backupsRoot();
      fs.mkdirSync(root, { recursive: true, mode: 0o700 });
      backupDir = fs.mkdtempSync(path.join(root, `rebaseline-${tool.name}-`));
      const copies: { source: string; backup: string | null }[] = [];
      files.forEach((file, index) => {
        const content = snapshots.get(file);
        const backup = content === undefined ? null : path.join(backupDir!, `${index}-${path.basename(file)}`);
        if (backup) atomicWriteFile(backup, content!);
        copies.push({ source: file, backup });
      });
      const records = Object.fromEntries([...states.map(({ file, state }) => [file, state]), ...(legacy ? [[tool.name, legacy]] : [])]);
      // 清单先落盘，删除记录失败时仍可从归档恢复
      atomicWriteFile(path.join(backupDir, 'manifest.json'), JSON.stringify({ tool: tool.name, createdAt: new Date().toISOString(), files: copies, records }, null, 2) + '\n');
    }
    if (files.some(file => readTextFile(file) !== snapshots.get(file))) throw new Error('Configuration changed while establishing the restore baseline. Retry.');
    stateStore.replaceToolRecords(tool.name, replacements);
    return { backupDir, files };
  });
}
