import type { IPty } from 'node-pty';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { LauncherShutdown } from './launcher-shutdown.js';

// npm 包中的 macOS 预编译 helper 可能未携带执行位；只处理所选原生模块旁的文件。
export function preparePtyHelper(packageRoot: string): void {
  if (process.platform === 'win32') return;
  for (const relative of ['build/Release', 'build/Debug', `prebuilds/${process.platform}-${process.arch}`]) {
    const directory = path.join(packageRoot, relative);
    if (!fs.existsSync(path.join(directory, 'pty.node'))) continue;
    const helper = path.join(directory, 'spawn-helper');
    if (!fs.existsSync(helper)) continue;
    const mode = fs.statSync(helper).mode;
    if ((mode & 0o111) === 0) {
      try { fs.chmodSync(helper, (mode & 0o777) | 0o100); }
      catch { throw new Error('PTY spawn helper is not executable. Reinstall node-pty with executable permissions before launching an interactive client.'); }
    }
  }
}

// 交互式 POSIX 客户端使用独立的控制终端，避免后台进程失去 /dev/tty。
export async function launchPty(file: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const require = createRequire(import.meta.url);
  preparePtyHelper(path.dirname(require.resolve('node-pty/package.json')));
  const pty = await import('node-pty');
  const child: IPty = pty.spawn(file, args, {
    name: process.env.TERM || 'xterm-256color', cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24, cwd: process.cwd(), env, encoding: null,
  });
  const wasRaw = process.stdin.isRaw;
  const wasFlowing = process.stdin.readableFlowing;
  let shutdown: NodeJS.Signals | undefined;
  const input = (data: Buffer | string): void => child.write(data);
  const resize = (): void => child.resize(process.stdout.columns || 80, process.stdout.rows || 24);
  const signal = (value: NodeJS.Signals): void => { shutdown = value; child.kill(value); };
  const interrupt = (): void => signal('SIGINT');
  const terminate = (): void => signal('SIGTERM');
  const data = child.onData(text => { if (!process.stdout.write(text)) child.pause(); });
  const drain = (): void => child.resume();
  let exitSubscription: {dispose():void} | undefined;
  let exited = false;
  const completion = new Promise<void>(resolve => {
    exitSubscription = child.onExit(event => { exited = true; process.exitCode = event.signal ? 128 + event.signal : event.exitCode; resolve(); });
  });
  try {
    process.stdin.setRawMode(true); process.stdin.resume();
    process.stdin.on('data', input); process.stdout.on('resize', resize);
    process.stdout.on('drain', drain);
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    await completion;
  } finally {
    if (!exited) { try { child.kill(); } catch { /* 已退出或启动失败 */ } }
    data.dispose(); exitSubscription?.dispose();
    process.stdin.off('data', input); process.stdout.off('resize', resize);
    process.stdout.off('drain', drain);
    process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
    process.stdin.setRawMode(wasRaw ?? false);
    // 初始尚未读取时 isPaused() 也为 false，必须停止本次启动器开启的读取。
    if (wasFlowing !== true) process.stdin.pause();
  }
  if (shutdown) { const error = new LauncherShutdown(shutdown); process.exitCode = error.exitCode; throw error; }
}
