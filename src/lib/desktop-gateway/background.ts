import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { helperDir } from '../core/safe-write.js';
import { gatewayFingerprint, readRuntimeConfig, type DesktopGatewayRuntimeConfig } from './server.js';

// 默认端口避开 CC Switch（15721）与 Magpie（3425），被占用时顺延。
export const DEFAULT_GATEWAY_PORT = 15880;
const PORT_ATTEMPTS = 30;

// 可用 CODING_HELPER_DESKTOP_GATEWAY_PORT 指定起始端口，例如默认端口段被企业软件占用时。
export function preferredPort(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.CODING_HELPER_DESKTOP_GATEWAY_PORT);
  return Number.isInteger(value) && value >= 1024 && value <= 65535 ? value : DEFAULT_GATEWAY_PORT;
}

// 常驻文件放在助手目录，不依赖 npx 缓存中的安装位置；npx 清理缓存后自启动仍可用。
export function gatewayDir(): string { return path.join(helperDir(), 'claude-desktop'); }
export function gatewayScriptPath(): string { return path.join(gatewayDir(), 'gateway.mjs'); }
export function gatewayConfigPath(): string { return path.join(gatewayDir(), 'gateway.json'); }
export function gatewayLogPath(): string { return path.join(gatewayDir(), 'gateway.log'); }
// 编译后的 server.js 只依赖 Node 内置模块，可直接复制为独立入口。
export function bundledGatewayScript(): string { return fileURLToPath(new URL('./server.js', import.meta.url)); }

interface ControlResponse { status: number; ok: boolean; json(): Promise<unknown>; }

// 控制请求不走 fetch 的连接池：停止后复用旧保活连接会被旧进程应答，误判端口状态。
function request(config: Pick<DesktopGatewayRuntimeConfig, 'port' | 'localToken'>, endpoint: string, method = 'GET'): Promise<ControlResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: config.port, path: `/_coding_helper/${endpoint}`, method, agent: false, timeout: 1500,
      headers: { authorization: `Bearer ${config.localToken}`, connection: 'close' } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status, ok: status >= 200 && status < 300, json: async () => JSON.parse(text) as unknown });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Gateway control request timed out.')));
    req.on('error', reject);
    req.end();
  });
}

export type GatewayProbe = 'current' | 'stale' | 'free' | 'occupied';

// current = 当前配置的网关；stale = 本工具旧配置的网关（令牌相同、配置不同）；occupied = 其他程序。
export async function probeGateway(config: DesktopGatewayRuntimeConfig): Promise<GatewayProbe> {
  try {
    const res = await request(config, 'health');
    if (!res.ok) return 'occupied';
    const body = await res.json() as { fingerprint?: unknown };
    return body.fingerprint === gatewayFingerprint(config) ? 'current' : 'stale';
  } catch {
    return await isPortFree(config.port) ? 'free' : 'occupied';
  }
}

export async function isDesktopGatewayRunning(config: DesktopGatewayRuntimeConfig): Promise<boolean> {
  return await probeGateway(config) === 'current';
}

export function isPortFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

// 已有配置的端口优先沿用（Desktop profile 已指向它）；仍被本工具旧网关占用也可沿用，启动前会先停止旧进程。
export async function choosePort(previous?: DesktopGatewayRuntimeConfig): Promise<number> {
  if (previous) {
    const state = await probeGateway(previous);
    if (state !== 'occupied') return previous.port;
  }
  const first = preferredPort();
  for (let port = first; port < first + PORT_ATTEMPTS && port <= 65535; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error('No free local port is available for the Claude Desktop gateway.');
}

export function readGatewayConfig(file = gatewayConfigPath()): DesktopGatewayRuntimeConfig | undefined {
  try { return readRuntimeConfig(file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

// 调用方须先以事务写入入口脚本、配置和 Desktop profile。只结束本次启动的子进程，绝不按端口或 PID 终止其他程序。
export async function startDesktopGateway(scriptPath = gatewayScriptPath(), configPath = gatewayConfigPath()): Promise<void> {
  const config = readRuntimeConfig(configPath);
  const state = await probeGateway(config);
  if (state === 'current') return;
  if (state === 'stale') await stopDesktopGateway(config);
  else if (state === 'occupied') throw new Error(`Port ${config.port} is used by another program. Reload the Claude Desktop configuration to choose a new port.`);
  const child = spawn(process.execPath, [scriptPath, configPath], { detached: true, stdio: 'ignore', windowsHide: true });
  let failure: Error | undefined;
  let exited = false;
  child.once('error', error => { failure = error; });
  child.once('exit', () => { exited = true; });
  for (let i = 0; i < 100; i++) {
    if (await isDesktopGatewayRunning(config)) { child.unref(); return; }
    if (failure || exited) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!exited && child.pid) child.kill('SIGTERM');
  throw new Error(`Claude Desktop gateway failed to start. See ${gatewayLogPath()}.`);
}

// 通过带令牌的本地接口请求退出，并等待端口释放，便于随后以新配置启动。
export async function stopDesktopGateway(config: Pick<DesktopGatewayRuntimeConfig, 'port' | 'localToken'>): Promise<boolean> {
  let res: ControlResponse;
  try { res = await request(config, 'stop', 'POST'); }
  catch { return false; }
  if (res.status === 401 || res.status === 404) return false;
  if (!res.ok) throw new Error('Claude Desktop gateway failed to stop.');
  for (let i = 0; i < 60; i++) {
    if (await isPortFree(config.port)) return true;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Claude Desktop gateway did not release its port.');
}
