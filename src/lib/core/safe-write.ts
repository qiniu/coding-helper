import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

// coding-helper 自身目录（惰性计算，便于测试时替换 HOME）
export function helperDir(): string {
  return path.join(os.homedir(), '.coding-helper');
}

export function backupsRoot(): string {
  return path.join(helperDir(), 'backups');
}

// 读取文本文件，不存在时返回 undefined
export function readTextFile(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

// 用户配置文件解析失败时抛出，避免把损坏的文件当作空配置覆盖掉
export class ConfigParseError extends Error {
  constructor(public readonly file: string, cause: unknown) {
    super(`Cannot parse ${file}: ${cause instanceof Error ? cause.message : String(cause)}. Fix or move the file, then retry.`);
    this.name = 'ConfigParseError';
  }
}

// 严格读取 JSON 对象：文件不存在返回 {}，内容损坏抛出 ConfigParseError
export function readJsonObjectStrict(file: string): Record<string, unknown> {
  return readJsonSnapshot(file).value;
}

// 解析对象与冲突检测必须使用同一次读取的文本，避免两次读取之间的编辑被覆盖
export function readJsonSnapshot(file: string): { content: string | undefined; value: Record<string, unknown> } {
  const content = readTextFile(file);
  if (content === undefined) return { content, value: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new ConfigParseError(file, err);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConfigParseError(file, new Error('top-level value is not an object'));
  }
  return { content, value: parsed as Record<string, unknown> };
}

// 明确拒绝符号链接，避免原子替换破坏 dotfiles 工具管理的链接
export function assertNotSymlink(file: string): void {
  try {
    if (fs.lstatSync(file).isSymbolicLink()) {
      throw new Error('Refusing to modify symbolic link: ' + file);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

// 原子写入：同目录写临时文件后 rename，避免中途失败留下半个文件
export function atomicWriteFile(file: string, content: string, mode = 0o600, beforeCommit?: () => void): void {
  assertNotSymlink(file);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, '.' + path.basename(file) + '.tmp-' + randomUUID());
  try {
    fs.writeFileSync(tmp, content, { encoding: 'utf-8', mode, flag: 'wx' });
    if (process.platform !== 'win32') fs.chmodSync(tmp, mode);
    assertNotSymlink(file);
    renameWithRetry(tmp, file, () => {
      assertNotSymlink(file);
      beforeCommit?.();
    });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// Windows 上目标文件被占用时 rename 会短暂失败，重试几次
function renameWithRetry(from: string, to: string, beforeCommit: () => void): void {
  for (let attempt = 0; ; attempt++) {
    beforeCommit();
    try {
      fs.renameSync(from, to);
      return;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 3 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err;
      const until = Date.now() + 50 * (attempt + 1);
      while (Date.now() < until) { /* 短暂等待 */ }
    }
  }
}

interface BackupEntry {
  source: string;
  backup: string;
}

// 每次进程运行共用一个备份目录：~/.coding-helper/backups/<时间戳>/
let sessionDir: string | null = null;
const backedUp = new Map<string, string>();

function timestamp(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function ensureSessionDir(): string {
  const root = backupsRoot();
  if (sessionDir && path.dirname(sessionDir) === root && fs.existsSync(sessionDir)) return sessionDir;
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  // mkdtemp 的独占创建避免同时运行的进程共用目录并覆盖清单
  sessionDir = fs.mkdtempSync(path.join(root, timestamp(new Date()) + '-'));
  return sessionDir;
}

// 写入前备份原文件；同一次运行内同一文件只备份一次。文件不存在时返回 undefined
export function backupFile(file: string): string | undefined {
  const resolved = path.resolve(file);
  const existing = backedUp.get(resolved);
  if (existing && fs.existsSync(existing)) return existing;
  if (!fs.existsSync(resolved)) return undefined;

  const dir = ensureSessionDir();
  // 使用完整源路径摘要，避免 a/b.json 与 a__b.json 等路径扁平化后碰撞
  const name = createHash('sha256').update(resolved).digest('hex');
  const target = path.join(dir, name + '-' + randomUUID());
  try {
    fs.copyFileSync(resolved, target, fs.constants.COPYFILE_EXCL);
    if (process.platform !== 'win32') fs.chmodSync(target, 0o600);
    const entries: BackupEntry[] = [...backedUp.entries()]
      .filter(([source, backup]) => source !== resolved && path.dirname(backup) === dir)
      .map(([source, backup]) => ({ source, backup }));
    entries.push({ source: resolved, backup: target });
    atomicWriteFile(path.join(dir, 'manifest.json'), JSON.stringify({ files: entries }, null, 2) + '\n');
    // 备份及其索引都落盘后才能缓存成功，失败重试不能跳过保护
    backedUp.set(resolved, target);
  } catch (err) {
    fs.rmSync(target, { force: true });
    throw err;
  }
  return target;
}

export interface FileExpectation { content: string | undefined; }

// 与读取时的快照比较；在真正替换前再次检查，拒绝覆盖中途的编辑
function assertExpected(file: string, expected?: FileExpectation): void {
  if (expected && readTextFile(file) !== expected.content) {
    throw new Error('Configuration changed before writing: ' + file + '. Retry.');
  }
}

// 备份后原子写入
export function safeWriteFile(file: string, content: string, mode = 0o600, expected?: FileExpectation): void {
  assertExpected(file, expected);
  assertNotSymlink(file);
  const current = readTextFile(file);
  if (current === content) return;
  // 文件原本不存在且没有内容要写：不凭空创建空文件
  if (current === undefined && !content.trim()) return;
  backupFile(file);
  atomicWriteFile(file, content, mode, () => assertExpected(file, expected));
}

// 按原文件的风格序列化 JSON：单行保持单行，缩进沿用原文件，末尾换行与原文件一致
export function formatJsonLike(original: string | undefined, data: unknown): string {
  if (original === undefined || !original.trim()) return JSON.stringify(data, null, 2) + '\n';
  const trailing = original.endsWith('\n') ? '\n' : '';
  if (!original.trim().includes('\n')) return JSON.stringify(data) + trailing;
  const indent = original.split('\n').find((line) => /^\s+\S/.test(line))?.match(/^\s+/)?.[0] ?? '  ';
  return JSON.stringify(data, null, indent) + trailing;
}

// 写入 JSON，保持原文件风格
export function writeJson(file: string, data: unknown, expected?: FileExpectation): void {
  safeWriteFile(file, formatJsonLike(readTextFile(file), data), 0o600, expected);
}

// 只删除文件：没有目录所有权记录，不能删除用户目录或目录链接的目标
function removeFile(file: string, expected?: FileExpectation): void {
  assertExpected(file, expected);
  assertNotSymlink(file);
  if (!fs.existsSync(file)) return;
  backupFile(file);
  assertNotSymlink(file);
  assertExpected(file, expected);
  fs.rmSync(file, { force: true });
}

// 写回 JSON 对象；还原后为空对象时删除文件（文件本就是我们创建的，或原本为空）
export function writeJsonOrRemove(file: string, data: Record<string, unknown>, expected?: FileExpectation): void {
  if (Object.keys(data).length > 0) writeJson(file, data, expected);
  else removeFile(file, expected);
}
