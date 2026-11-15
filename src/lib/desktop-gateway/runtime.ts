import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listenDesktopGateway, type DesktopGatewayOptions } from './server.js';

export interface DesktopGatewayRuntimeConfig extends DesktopGatewayOptions { port: number; }

// 密钥仅从用户私有文件读取，不通过命令行参数或进程环境传递。
export function readRuntimeConfig(file: string): DesktopGatewayRuntimeConfig {
  if (!path.isAbsolute(file)) throw new Error('Gateway config path must be absolute.');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Gateway config must be a regular file.');
  if (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && stat.uid !== process.getuid()))) throw new Error('Gateway config must be owned by the current user and inaccessible to other users.');
  const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid gateway config.');
  const config = value as DesktopGatewayRuntimeConfig;
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535 || typeof config.upstream !== 'string' || typeof config.apiKey !== 'string' || typeof config.localToken !== 'string' || !config.routes || typeof config.routes !== 'object' || Array.isArray(config.routes)) throw new Error('Invalid gateway config.');
  return config;
}

export async function runDesktopGateway(file: string): Promise<void> {
  const config = readRuntimeConfig(file);
  const server = await listenDesktopGateway(config, config.port);
  const stop = (): void => { server.close(); server.closeIdleConnections?.(); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDesktopGateway(process.argv[2] ?? '').catch(() => { console.error('Failed to start Claude Desktop gateway.'); process.exitCode = 1; });
}
