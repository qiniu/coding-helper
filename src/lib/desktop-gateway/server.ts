import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import { timingSafeEqual, createHash } from 'node:crypto';

// 桌面端只接受 Claude 角色名；真实模型由本地网关映射到七牛。
export const DESKTOP_ROUTE = 'claude-sonnet-4-6';
export const DESKTOP_ROUTES = { sonnet: DESKTOP_ROUTE, opus: 'claude-opus-4-6', haiku: 'claude-haiku-4-5' } as const;
const MAX_BODY = 16 * 1024 * 1024;

export interface DesktopGatewayOptions {
  upstream: string;
  apiKey: string;
  localToken: string;
  model?: string;
  routes?: Record<string, string>;
}

function secretMatches(actual: string | undefined, expected: string): boolean {
  if (!actual || !expected) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function fail(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ type: 'error', error: { type: 'gateway_error', message } }));
}
function upstreamBase(value: string): URL {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) {
    throw new Error('Gateway upstream must be HTTPS or an HTTP loopback address.');
  }
  return url;
}

// 只转发明确允许的 Anthropic 端点；拒绝携带客户端凭据或跳转到其他地址。
export function createDesktopGateway(options: DesktopGatewayOptions): http.Server {
  const base = upstreamBase(options.upstream);
  const routes = options.routes ?? (options.model ? { [DESKTOP_ROUTE]: options.model } : {});
  if (!options.apiKey.trim() || !options.localToken.trim() || !Object.keys(routes).length || Object.entries(routes).some(([route, model]) => !Object.values(DESKTOP_ROUTES).includes(route as typeof DESKTOP_ROUTES[keyof typeof DESKTOP_ROUTES]) || typeof model !== 'string' || !model.trim())) throw new Error('Gateway credentials and model routes are required.');
  const fingerprint = createHash('sha256').update(JSON.stringify([base.toString(), options.apiKey, options.localToken, Object.entries(routes).sort()])).digest('hex');
  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const authorization = req.headers.authorization;
    const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    const apiKey = typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : undefined;
    if (!secretMatches(bearer ?? apiKey, options.localToken)) { fail(res, 401, 'Unauthorized'); return; }
    if (req.method === 'GET' && req.url === '/_coding_helper/health') {
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ fingerprint })); return;
    }
    if (req.method === 'POST' && req.url === '/_coding_helper/stop') {
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); server.close(); server.closeIdleConnections?.(); return;
    }
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      const data = Object.entries(routes).map(([id, model]) => ({ id, type: 'model', display_name: model, created_at: '2024-01-01T00:00:00Z' }));
      res.end(JSON.stringify({ data, has_more: false, first_id: data[0].id, last_id: data[data.length - 1].id }));
      return;
    }
    if (req.method !== 'POST' || !['/v1/messages', '/v1/messages/count_tokens'].includes(req.url ?? '')) { fail(res, 404, 'Not found'); return; }
    const chunks: Buffer[] = [];
    let size = 0, tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) { tooLarge = true; chunks.length = 0; }
      else if (!tooLarge) chunks.push(chunk);
    });
    req.on('error', () => { if (!res.destroyed) fail(res, 400, 'Invalid request'); });
    req.on('end', () => {
      if (tooLarge) { fail(res, 413, 'Request too large'); return; }
      let body: Record<string, unknown>;
      try {
        const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        body = value as Record<string, unknown>;
      } catch { fail(res, 400, 'Invalid JSON object'); return; }
      if (typeof body.model !== 'string' || !Object.hasOwn(routes, body.model)) { fail(res, 400, 'Unknown model route'); return; }
      body.model = routes[body.model];
      const bytes = Buffer.from(JSON.stringify(body));
      const target = new URL(base.toString());
      target.pathname = `${target.pathname.replace(/\/+$/, '')}${req.url}`;
      const headers: Record<string, string> = { 'content-type': 'application/json', 'content-length': String(bytes.length), authorization: `Bearer ${options.apiKey}` };
      for (const name of ['anthropic-version', 'anthropic-beta']) {
        const value = req.headers[name];
        if (typeof value === 'string') headers[name] = value;
      }
      const forward = (target.protocol === 'https:' ? https : http).request(target, { method: 'POST', headers }, upstream => {
        // 上游响应直接流式转发，保留事件、状态码及内容类型，不缓冲工具调用。
        const outHeaders: Record<string, string | string[]> = {};
        for (const name of ['content-type', 'cache-control', 'retry-after', 'request-id']) {
          const value = upstream.headers[name]; if (value !== undefined) outHeaders[name] = value;
        }
        res.writeHead(upstream.statusCode ?? 502, outHeaders);
        upstream.on('error', () => res.destroy());
        upstream.pipe(res);
      });
      forward.on('error', () => { if (!res.destroyed) fail(res, 502, 'Upstream request failed'); });
      res.on('close', () => { if (!res.writableEnded) forward.destroy(); });
      forward.end(bytes);
    });
  });
  return server;
}

// 服务入口固定绑定 IPv4 回环地址，不允许调用方暴露到局域网。
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
