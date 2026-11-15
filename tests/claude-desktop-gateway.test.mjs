import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { once } from 'node:events';
import { createDesktopGateway, listenDesktopGateway, resolveRouteModel, DESKTOP_ROUTES } from '../dist/lib/desktop-gateway/server.js';
import { desktopModelRoutes, desktopGatewayProfile, desktopMenuModels } from '../dist/lib/desktop-gateway/mapping.js';

const routes = { [DESKTOP_ROUTES.sonnet]: 'qwen/qwen3.5-plus', [DESKTOP_ROUTES.opus]: 'deepseek/deepseek-v4-pro', [DESKTOP_ROUTES.haiku]: 'z-ai/glm-5.3-flash' };
const auth = { authorization: 'Bearer local-secret' };
async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; }
async function close(server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
function recorder(handler) {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    seen.push({ url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks)) });
    handler(req, res);
  });
  return { server, seen };
}

test('gateway authenticates, maps models, forwards query strings and streams upstream responses', async () => {
  const { server: upstream, seen } = recorder((req, res) => {
    if (req.url.includes('count_tokens')) { res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '2' }); res.end('{"error":"limited"}'); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('event: content_block_delta\ndata: {"type":"tool_use"}\n\n');
    res.end('event: message_stop\ndata: {}\n\n');
  });
  const gateway = createDesktopGateway({ upstream: await listen(upstream), apiKey: 'upstream-key', localToken: 'local-secret', routes });
  const local = await listen(gateway);
  try {
    assert.equal((await fetch(local + '/v1/models')).status, 401);
    assert.equal((await fetch(local + '/v1/models', { headers: { authorization: 'Bearer wrong' } })).status, 401);
    // Claude SDK 在 Messages 地址后附加 ?beta=true，路由须按路径匹配并把查询参数转发给上游。
    const response = await fetch(local + '/v1/messages?beta=true', { method: 'POST', headers: { 'x-api-key': 'local-secret', 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'anthropic-beta': 'tools-2024', cookie: 'do-not-forward' }, body: JSON.stringify({ model: DESKTOP_ROUTES.sonnet, stream: true, messages: [] }) });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    assert.match(await response.text(), /tool_use[\s\S]*message_stop/);
    assert.equal(seen[0].url, '/v1/messages?beta=true');
    assert.equal(seen[0].body.model, 'qwen/qwen3.5-plus');
    assert.equal(seen[0].body.stream, true);
    assert.equal(seen[0].headers.authorization, 'Bearer upstream-key');
    assert.equal(seen[0].headers['x-api-key'], undefined);
    assert.equal(seen[0].headers['anthropic-beta'], 'tools-2024');
    assert.equal(seen[0].headers.cookie, undefined);
    const limited = await fetch(local + '/v1/messages/count_tokens?beta=true', { method: 'POST', headers: auth, body: JSON.stringify({ model: DESKTOP_ROUTES.haiku, messages: [] }) });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '2');
    assert.equal(seen[1].body.model, 'z-ai/glm-5.3-flash');
    assert.equal((await fetch(local + '/v1/messages', { method: 'POST', headers: auth, body: '{bad' })).status, 400);
    const unknown = await fetch(local + '/v1/messages', { method: 'POST', headers: auth, body: '{"model":"gpt-5"}' });
    assert.equal(unknown.status, 400);
    assert.equal((await unknown.json()).error.type, 'invalid_request_error');
    assert.equal((await fetch(local + '/other', { headers: auth })).status, 404);
    assert.equal(seen.length, 2);
  } finally { await close(gateway); await close(upstream); }
});

test('model discovery publishes provider descriptions for each role', async () => {
  const gateway = await listenDesktopGateway({ upstream: 'https://api.qnaigc.com', apiKey: 'key', localToken: 'local-secret', routes });
  const url = `http://127.0.0.1:${gateway.address().port}`;
  try {
    assert.equal(gateway.address().address, '127.0.0.1');
    const list = await fetch(url + '/v1/models?limit=100', { headers: auth }).then(r => r.json());
    assert.deepEqual(list.data.map(item => item.id), Object.keys(routes));
    assert.equal(list.data[0].description, 'Qiniu · qwen/qwen3.5-plus');
    assert.equal(list.first_id, DESKTOP_ROUTES.sonnet);
    const one = await fetch(url + '/v1/models/claude-opus-4-6-20260101', { headers: auth }).then(r => r.json());
    assert.equal(one.display_name, 'deepseek/deepseek-v4-pro');
    assert.equal((await fetch(url + '/v1/models/gpt-5', { headers: auth })).status, 404);
  } finally { await close(gateway); }
});

test('route resolution tolerates dated names, 1M markers and newer releases but rejects non-Claude names', () => {
  const only = { [DESKTOP_ROUTES.sonnet]: 'main' };
  assert.equal(resolveRouteModel(routes, DESKTOP_ROUTES.opus), 'deepseek/deepseek-v4-pro');
  assert.equal(resolveRouteModel(routes, 'claude-haiku-4-5-20251001'), 'z-ai/glm-5.3-flash');
  assert.equal(resolveRouteModel(routes, 'claude-sonnet-4-6[1m]'), 'qwen/qwen3.5-plus');
  assert.equal(resolveRouteModel(routes, 'claude-opus-5-5'), 'deepseek/deepseek-v4-pro');
  assert.equal(resolveRouteModel(routes, 'claude-fable-5'), 'deepseek/deepseek-v4-pro');
  assert.equal(resolveRouteModel(routes, 'anthropic/claude-sonnet-5'), 'qwen/qwen3.5-plus');
  assert.equal(resolveRouteModel(routes, 'claude-mythos-1'), 'qwen/qwen3.5-plus');
  assert.equal(resolveRouteModel(only, 'claude-haiku-4-5'), 'main');
  for (const model of ['gpt-5', 'qwen/qwen3.5-plus', 'claude-', '', '__proto__']) assert.equal(resolveRouteModel(routes, model), undefined, model);
});

test('client aborts cancel the upstream request', async () => {
  let closed;
  const closedPromise = new Promise(resolve => { closed = resolve; });
  const upstream = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('event: ping\ndata: {}\n\n');
    res.on('close', () => closed(true));
  });
  const gateway = createDesktopGateway({ upstream: await listen(upstream), apiKey: 'key', localToken: 'local-secret', routes });
  const local = await listen(gateway);
  try {
    const controller = new AbortController();
    const res = await fetch(local + '/v1/messages', { method: 'POST', headers: auth, body: JSON.stringify({ model: DESKTOP_ROUTES.sonnet, stream: true }), signal: controller.signal });
    const reader = res.body.getReader();
    await reader.read();
    controller.abort();
    assert.equal(await Promise.race([closedPromise, new Promise(resolve => setTimeout(() => resolve(false), 3000))]), true);
  } finally { await close(gateway); await close(upstream); }
});

test('gateway refuses insecure upstreams, missing credentials and unknown routes', () => {
  for (const upstream of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/?x=1']) {
    assert.throws(() => createDesktopGateway({ upstream, apiKey: 'key', localToken: 'token', routes }), upstream);
  }
  assert.throws(() => createDesktopGateway({ upstream: 'https://example.com', apiKey: '', localToken: 'token', routes }));
  assert.throws(() => createDesktopGateway({ upstream: 'https://example.com', apiKey: 'key', localToken: 'token', routes: { 'gpt-5': 'x' } }));
  assert.throws(() => createDesktopGateway({ upstream: 'https://example.com', apiKey: 'key', localToken: 'token', routes: { [DESKTOP_ROUTES.opus]: 'x' } }));
});

test('desktop profile lists distinct roles, uses the local token and enables discovery', () => {
  const mapped = desktopModelRoutes({ toolModels: { 'claude-desktop': 'qwen' }, slotModels: { 'claude-desktop': { opus: 'deepseek', haiku: 'kimi' } } });
  assert.deepEqual(Object.values(mapped), ['qwen', 'deepseek', 'kimi']);
  const profile = desktopGatewayProfile({ other: 'keep' }, 'http://127.0.0.1:12345', 'local-secret', mapped);
  assert.equal(profile.other, 'keep');
  assert.equal(profile.inferenceProvider, 'gateway');
  assert.equal(profile.inferenceGatewayBaseUrl, 'http://127.0.0.1:12345');
  assert.equal(profile.inferenceGatewayApiKey, 'local-secret');
  assert.equal(profile.inferenceGatewayAuthScheme, 'bearer');
  assert.equal(profile.modelDiscoveryEnabled, true);
  assert.deepEqual(profile.inferenceModels.map(m => m.name), Object.values(DESKTOP_ROUTES));
  assert.deepEqual(profile.inferenceModels.map(m => m.labelOverride), ['qwen', 'deepseek', 'kimi']);
  // 跟随主模型的角色不在菜单里重复出现，但网关仍为其保留路由。
  const following = desktopModelRoutes({ defaultModel: 'qwen' });
  assert.deepEqual(Object.values(following), ['qwen', 'qwen', 'qwen']);
  assert.deepEqual(desktopMenuModels(following), [{ name: DESKTOP_ROUTES.sonnet, labelOverride: 'qwen' }]);
  assert.throws(() => desktopGatewayProfile({}, 'http://0.0.0.0:12345', 'token', mapped));
  assert.throws(() => desktopGatewayProfile({}, 'http://127.0.0.1:12345/path', 'token', mapped));
  assert.throws(() => desktopModelRoutes({}));
});

test('gateway entry is self-contained so it can run outside the npx cache', () => {
  const source = fs.readFileSync(new URL('../dist/lib/desktop-gateway/server.js', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map(match => match[1]);
  assert.ok(imports.length > 0);
  assert.deepEqual(imports.filter(name => !name.startsWith('node:')), []);
});
