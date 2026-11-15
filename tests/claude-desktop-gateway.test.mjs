import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createDesktopGateway, listenDesktopGateway, DESKTOP_ROUTE } from '../dist/lib/desktop-gateway/server.js';

async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; }
async function close(server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }

test('authenticated local gateway maps models and preserves streaming responses and upstream errors', async () => {
  const seen = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    seen.push({ url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks)) });
    if (req.url.endsWith('count_tokens')) { res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '2' }); res.end('{"error":"limited"}'); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('event: content_block_delta\ndata: {"type":"tool_use"}\n\n');
    res.end('event: message_stop\ndata: {}\n\n');
  });
  const url = await listen(upstream);
  const gateway = createDesktopGateway({ upstream: url, apiKey: 'upstream-key', localToken: 'local-secret', model: 'deepseek-v4' });
  const local = await listen(gateway);
  try {
    assert.equal((await fetch(local + '/v1/models')).status, 401);
    const list = await fetch(local + '/v1/models', { headers: { authorization: 'Bearer local-secret' } }).then(r => r.json());
    assert.equal(list.data[0].id, DESKTOP_ROUTE);
    const response = await fetch(local + '/v1/messages', { method: 'POST', headers: { 'x-api-key': 'local-secret', 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'cookie': 'do-not-forward' }, body: JSON.stringify({ model: DESKTOP_ROUTE, stream: true, messages: [] }) });
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/event-stream/);
    assert.match(await response.text(), /tool_use/);
    assert.equal(seen[0].body.model, 'deepseek-v4'); assert.equal(seen[0].body.stream, true);
    assert.equal(seen[0].headers.authorization, 'Bearer upstream-key'); assert.equal(seen[0].headers.cookie, undefined);
    const limited = await fetch(local + '/v1/messages/count_tokens', { method: 'POST', headers: { authorization: 'Bearer local-secret' }, body: JSON.stringify({ model: DESKTOP_ROUTE, messages: [] }) });
    assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '2');
    assert.equal((await fetch(local + '/v1/messages', { method: 'POST', headers: { authorization: 'Bearer local-secret' }, body: '{bad' })).status, 400);
    assert.equal((await fetch(local + '/v1/messages', { method: 'POST', headers: { authorization: 'Bearer local-secret' }, body: '{"model":"unknown"}' })).status, 400);
    assert.equal((await fetch(local + '/other', { headers: { authorization: 'Bearer local-secret' } })).status, 404);
    assert.equal(seen.length, 2);
  } finally { await close(gateway); await close(upstream); }
});
test('gateway refuses insecure remote URLs and missing credentials', () => {
  for (const upstream of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/?x=1']) {
    assert.throws(() => createDesktopGateway({ upstream, apiKey: 'key', localToken: 'token', model: 'model' }));
  }
  assert.throws(() => createDesktopGateway({ upstream: 'https://example.com', apiKey: '', localToken: 'token', model: 'model' }));
});

test('gateway listener binds to loopback', async () => {
  const server = await listenDesktopGateway({ upstream: 'https://api.qnaigc.com', apiKey: 'key', localToken: 'token', model: 'model' });
  try { assert.equal(server.address().address, '127.0.0.1'); } finally { await close(server); }
});
