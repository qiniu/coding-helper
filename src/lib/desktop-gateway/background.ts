import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readRuntimeConfig, type DesktopGatewayRuntimeConfig } from './runtime.js';

function fingerprint(config: DesktopGatewayRuntimeConfig): string {
  return createHash('sha256').update(JSON.stringify([new URL(config.upstream).toString(), config.apiKey, config.localToken, Object.entries(config.routes!).sort()])).digest('hex');
}
async function request(config: DesktopGatewayRuntimeConfig, endpoint: string, method = 'GET'): Promise<Response> {
  return fetch(`http://127.0.0.1:${config.port}/_coding_helper/${endpoint}`, {
    method, headers: { authorization: `Bearer ${config.localToken}` }, signal: AbortSignal.timeout(1000),
  });
}
export async function isDesktopGatewayRunning(config: DesktopGatewayRuntimeConfig): Promise<boolean> {
  try {
    const res = await request(config, 'health');
    if (!res.ok) return false;
    const body = await res.json() as { fingerprint?: unknown };
    return body.fingerprint === fingerprint(config);
  } catch { return false; }
}

// 调用方必须先将配置、入口及 Desktop profile 作为一组安全事务写入。
export async function startDesktopGateway(configPath: string, runtimePath: string): Promise<void> {
  const config = readRuntimeConfig(configPath);
  if (await isDesktopGatewayRunning(config)) return;
  const child = spawn(process.execPath, [runtimePath, configPath], { detached: true, stdio: 'ignore' });
  let failure: Error | undefined;
  let exited = false;
  child.once('error', error => { failure = error; });
  child.once('exit', () => { exited = true; });
  for (let i = 0; i < 100; i++) {
    if (await isDesktopGatewayRunning(config)) { child.unref(); return; }
    if (failure || exited) break;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  // 仅结束本次启动的子进程，绝不按端口或历史 PID 终止其他程序。
  if (!exited && child.pid) child.kill('SIGTERM');
  throw new Error('Claude Desktop gateway failed to start or its port is in use.');
}

export async function stopDesktopGateway(config: DesktopGatewayRuntimeConfig): Promise<boolean> {
  if (!await isDesktopGatewayRunning(config)) return false;
  const res = await request(config, 'stop', 'POST');
  if (!res.ok) throw new Error('Claude Desktop gateway failed to stop.');
  return true;
}
