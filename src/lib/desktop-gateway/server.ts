// Claude Desktop 本地模型映射网关。
// 本文件会被原样复制到 ~/.coding-helper/claude-desktop/gateway.mjs 作为常驻进程入口，
// 因此只能依赖 Node 内置模块，不能导入项目内其他文件。
import fs from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// 桌面端只接受 claude-<角色>-* 模型名；网关把这些角色路由映射到实际的七牛模型。
// 选用 4.x 代名称：Desktop 会按旧模型组请求参数（扩展思考 + budget），第三方 Messages 兼容层普遍支持。
export const DESKTOP_ROUTES = { sonnet: 'claude-sonnet-4-6', opus: 'claude-opus-4-6', haiku: 'claude-haiku-4-5' } as const;
export type DesktopRole = keyof typeof DESKTOP_ROUTES;
export const DESKTOP_ROUTE = DESKTOP_ROUTES.sonnet;
export const GATEWAY_RUNTIME_VERSION = 1;
const ROUTE_IDS: readonly string[] = Object.values(DESKTOP_ROUTES);
// 与 Anthropic Messages API 的单次请求上限一致，图片和 PDF 以 base64 内联。
const MAX_BODY = 32 * 1024 * 1024;
const MAX_DESCRIPTION = 100;
const MAX_LOG = 1024 * 1024;
let logFile: string | undefined;

// 常驻进程没有终端，日志写到配置旁的 gateway.log；只记录事件类别，不写请求内容或凭据。
export function gatewayLog(message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`;
  if (!logFile) { process.stderr.write(line); return; }
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > MAX_LOG) fs.renameSync(logFile, `${logFile}.1`);
    fs.appendFileSync(logFile, line, { mode: 0o600 });
  } catch { /* 日志失败不影响转发 */ }
}

export interface DesktopGatewayOptions {
  upstream: string;
  apiKey: string;
  localToken: string;
  // 路由 ID → 上游模型；至少包含 Sonnet 主路由。
  routes: Record<string, string>;
  // 模型说明里展示的服务商名称。
  provider?: string;
}

export interface DesktopGatewayRuntimeConfig extends DesktopGatewayOptions { version: number; port: number; }

function secretMatches(actual: string | undefined, expected: string): boolean {
  if (!actual || !expected) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

// 错误体沿用 Anthropic 格式，Desktop 能直接展示原因。
function fail(res: ServerResponse, status: number, type: string, message: string): void {
  if (res.headersSent) { res.destroy(); return; }
  sendJson(res, status, { type: 'error', error: { type, message } });
}

function upstreamBase(value: string): URL {
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) {
    throw new Error('Gateway upstream must be HTTPS or an HTTP loopback address.');
  }
  return url;
}

function validRoutes(routes: unknown): routes is Record<string, string> {
  if (!routes || typeof routes !== 'object' || Array.isArray(routes)) return false;
  const entries = Object.entries(routes);
  return entries.length > 0 && Object.hasOwn(routes, DESKTOP_ROUTES.sonnet) &&
    entries.every(([route, model]) => ROUTE_IDS.includes(route) && typeof model === 'string' && !!model.trim());
}

// 后台进程与 CLI 用同一指纹确认正在运行的网关就是当前配置，而不是旧配置或其他程序。
export function gatewayFingerprint(options: DesktopGatewayOptions): string {
  const routes = Object.entries(options.routes).sort(([a], [b]) => a.localeCompare(b));
  return createHash('sha256').update(JSON.stringify([GATEWAY_RUNTIME_VERSION, upstreamBase(options.upstream).toString(), options.apiKey, options.localToken, routes, options.provider ?? ''])).digest('hex');
}

function roleOf(model: string): DesktopRole | undefined {
  if (model.includes('opus')) return 'opus';
  if (model.includes('haiku')) return 'haiku';
  // Fable 是更高档位，未单独配置时与官方降级方向一致，归到 Opus。
  if (model.includes('fable')) return 'opus';
  if (model.includes('sonnet')) return 'sonnet';
  return undefined;
}

// Desktop 内嵌的 Claude Code 可能请求带日期后缀、[1m] 标记或新版本号的名称；
// 按角色归类到已配置路由，未单独配置的角色跟随 Sonnet 主路由。非 Claude 名称一律拒绝。
export function resolveRouteModel(routes: Record<string, string>, requested: string): string | undefined {
  const id = requested.trim().replace(/\[1m\]$/i, '').trim();
  if (Object.hasOwn(routes, id)) return routes[id];
  const lower = id.toLowerCase();
  if (!/^(?:anthropic\/)?claude-[a-z0-9]/.test(lower)) return undefined;
  const role = roleOf(lower);
  const route = role ? DESKTOP_ROUTES[role] : DESKTOP_ROUTES.sonnet;
  return Object.hasOwn(routes, route) ? routes[route] : routes[DESKTOP_ROUTES.sonnet];
}

function modelEntry(id: string, model: string, provider: string): Record<string, unknown> {
  return { type: 'model', id, display_name: model, description: `${provider} · ${model}`.slice(0, MAX_DESCRIPTION), created_at: '2024-01-01T00:00:00Z' };
}

// 只转发明确允许的 Anthropic 端点；客户端凭据不会发往上游，上游 Key 也不会返回给客户端。
export function createDesktopGateway(options: DesktopGatewayOptions): http.Server {
  const base = upstreamBase(options.upstream);
  const routes = options.routes;
  if (!options.apiKey?.trim() || !options.localToken?.trim() || !validRoutes(routes)) throw new Error('Gateway credentials and model routes are required.');
  const provider = options.provider?.trim() || 'Qiniu';
  const fingerprint = gatewayFingerprint(options);
  let stopping = false;
  const server: http.Server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    // 停止后监听已关闭，但保活连接仍可能送来请求；拒绝并断开，避免旧配置继续服务。
    if (stopping) { res.setHeader('connection', 'close'); fail(res, 503, 'overloaded_error', 'Gateway is stopping.'); return; }
    const authorization = req.headers.authorization;
    const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : undefined;
    const apiKey = typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : undefined;
    if (!secretMatches(bearer ?? apiKey, options.localToken)) { fail(res, 401, 'authentication_error', 'Invalid local gateway token.'); return; }
    let url: URL;
    try { url = new URL(req.url ?? '/', 'http://127.0.0.1'); } catch { fail(res, 400, 'invalid_request_error', 'Invalid request path.'); return; }
    // SDK 会附加 ?beta=true 等查询参数，路由只按路径匹配。
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    if (pathname.startsWith('/_coding_helper/')) res.setHeader('connection', 'close');
    if (req.method === 'GET' && pathname === '/_coding_helper/health') {
      sendJson(res, 200, { fingerprint, pid: process.pid, version: GATEWAY_RUNTIME_VERSION }); return;
    }
    if (req.method === 'POST' && pathname === '/_coding_helper/stop') {
      stopping = true;
      sendJson(res, 200, {});
      server.close();
      server.closeIdleConnections?.();
      // 流式响应可能仍在进行，给它们短暂收尾时间后强制断开。
      setTimeout(() => server.closeAllConnections?.(), 1500).unref();
      return;
    }
    if (req.method === 'GET' && pathname === '/v1/models') {
      const data = Object.entries(routes).map(([id, model]) => modelEntry(id, model, provider));
      sendJson(res, 200, { data, has_more: false, first_id: data[0]?.id ?? null, last_id: data[data.length - 1]?.id ?? null });
      return;
    }
    if (req.method === 'GET' && pathname.startsWith('/v1/models/')) {
      const id = decodeURIComponent(pathname.slice('/v1/models/'.length));
      const model = resolveRouteModel(routes, id);
      if (model) sendJson(res, 200, modelEntry(id, model, provider));
      else fail(res, 404, 'not_found_error', 'Unknown model route.');
      return;
    }
    if (req.method !== 'POST' || !['/v1/messages', '/v1/messages/count_tokens'].includes(pathname)) { fail(res, 404, 'not_found_error', 'Not found.'); return; }
    const chunks: Buffer[] = [];
    let size = 0, tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) { tooLarge = true; chunks.length = 0; }
      else if (!tooLarge) chunks.push(chunk);
    });
    req.on('error', () => { if (!res.destroyed) fail(res, 400, 'invalid_request_error', 'Invalid request.'); });
    req.on('end', () => {
      if (tooLarge) { fail(res, 413, 'request_too_large', 'Request too large.'); return; }
      let body: Record<string, unknown>;
      try {
        const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
        body = value as Record<string, unknown>;
      } catch { fail(res, 400, 'invalid_request_error', 'Request body must be a JSON object.'); return; }
      const model = typeof body.model === 'string' ? resolveRouteModel(routes, body.model) : undefined;
      if (!model) { fail(res, 400, 'invalid_request_error', `Model route is not configured: ${String(body.model).slice(0, 80)}`); return; }
      body.model = model;
      const bytes = Buffer.from(JSON.stringify(body));
      const target = new URL(base.toString());
      target.pathname = `${target.pathname.replace(/\/+$/, '')}${pathname}`;
      target.search = url.search;
      const headers: Record<string, string> = { 'content-type': 'application/json', 'content-length': String(bytes.length), authorization: `Bearer ${options.apiKey}`, accept: req.headers.accept ?? 'application/json' };
      for (const name of ['anthropic-version', 'anthropic-beta']) {
        const value = req.headers[name];
        if (typeof value === 'string') headers[name] = value;
      }
      const forward = (target.protocol === 'https:' ? https : http).request(target, { method: 'POST', headers }, upstream => {
        // 上游响应原样流式转发，保留 SSE 事件、状态码与内容类型，不缓冲工具调用。
        const outHeaders: Record<string, string | string[]> = {};
        for (const name of ['content-type', 'cache-control', 'retry-after', 'request-id', 'x-request-id']) {
          const value = upstream.headers[name]; if (value !== undefined) outHeaders[name] = value;
        }
        res.writeHead(upstream.statusCode ?? 502, outHeaders);
        res.flushHeaders();
        upstream.on('error', () => res.destroy());
        upstream.pipe(res);
      });
      forward.on('error', error => {
        gatewayLog(`upstream request failed: ${(error as NodeJS.ErrnoException).code ?? error.name}`);
        if (!res.destroyed) fail(res, 502, 'api_error', 'Upstream request failed.');
      });
      // Desktop 中止生成时立即取消上游请求，避免继续计费。
      res.on('close', () => { if (!res.writableEnded) forward.destroy(); });
      forward.end(bytes);
    });
  });
  return server;
}

// 服务入口固定绑定 IPv4 回环地址，不允许暴露到局域网。
export async function listenDesktopGateway(options: DesktopGatewayOptions, port = 0): Promise<http.Server> {
  const server = createDesktopGateway(options);
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => { server.off('listening', onListening); reject(error); };
    const onListening = (): void => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
  return server;
}

// 密钥只从当前用户私有的配置文件读取，不经命令行参数或环境变量传递。
export function readRuntimeConfig(file: string): DesktopGatewayRuntimeConfig {
  if (!path.isAbsolute(file)) throw new Error('Gateway config path must be absolute.');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Gateway config must be a regular file.');
  if (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && stat.uid !== process.getuid()))) {
    throw new Error('Gateway config must be owned by the current user and inaccessible to other users.');
  }
  return parseRuntimeConfig(fs.readFileSync(file, 'utf8'));
}

export function parseRuntimeConfig(content: string): DesktopGatewayRuntimeConfig {
  const value: unknown = JSON.parse(content);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid gateway config.');
  const config = value as DesktopGatewayRuntimeConfig;
  if (config.version !== GATEWAY_RUNTIME_VERSION || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535 ||
      typeof config.upstream !== 'string' || typeof config.apiKey !== 'string' || typeof config.localToken !== 'string' ||
      (config.provider !== undefined && typeof config.provider !== 'string') || !validRoutes(config.routes)) {
    throw new Error('Invalid gateway config.');
  }
  upstreamBase(config.upstream);
  return config;
}

export async function runDesktopGateway(file: string): Promise<http.Server> {
  const config = readRuntimeConfig(file);
  const server = await listenDesktopGateway(config, config.port);
  gatewayLog(`listening on 127.0.0.1:${config.port} (pid ${process.pid})`);
  server.once('close', () => gatewayLog(`stopped (pid ${process.pid})`));
  const stop = (): void => {
    server.close();
    server.closeIdleConnections?.();
    setTimeout(() => server.closeAllConnections?.(), 1500).unref();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  return server;
}

function isMain(): boolean {
  if (!process.argv[1]) return false;
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}

if (isMain()) {
  const file = path.resolve(process.argv[2] ?? '');
  logFile = path.join(path.dirname(file), 'gateway.log');
  runDesktopGateway(file).catch((error: NodeJS.ErrnoException) => {
    // 只输出错误类别，不回显配置内容。
    gatewayLog(`failed to start: ${error.code ?? error.message}`);
    process.exitCode = 1;
  });
}
