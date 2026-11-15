import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { isolateHome } from './helpers/isolated-home.mjs';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'claude-desktop-')));
isolateHome(home);
// 模拟七牛线路：网关只接受 HTTPS 或回环 HTTP 上游，环境变量让回环地址被识别为七牛线路。
const seen = [];
const upstream = http.createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks)) });
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end('event: message_start\ndata: {"type":"message_start"}\n\nevent: message_stop\ndata: {}\n\n');
});
upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
const url = `http://127.0.0.1:${upstream.address().port}`;
process.env.CODING_HELPER_BASE_URL_CHINA = url;
const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
process.env.CODING_HELPER_DESKTOP_GATEWAY_PORT = String(probe.address().port);
await new Promise(resolve => probe.close(resolve));

const { ClaudeDesktopTool, desktopPaths, desktopManagedFiles, PROFILE_ID } = await import('../dist/lib/tools/claude-desktop-tool.js');
const { previewWrites, publicPlannedChanges } = await import('../dist/lib/core/safe-write.js');
const { stateStore } = await import('../dist/lib/core/state-store.js');
const { probeGateway, readGatewayConfig, stopDesktopGateway } = await import('../dist/lib/desktop-gateway/background.js');
const { DESKTOP_ROUTES } = await import('../dist/lib/desktop-gateway/server.js');
const { isExternallyModified } = await import('../dist/lib/core/rebaseline.js');
const { toolManager } = await import('../dist/lib/tool-manager.js');
const { toolSlots } = await import('../dist/lib/core/model-slots.js');

const tool = new ClaudeDesktopTool();
const files = desktopManagedFiles();
const [normalFile, threepFile, profileFile, metaFile, scriptFile, gatewayFile, autostartFile] = files;
const models = { toolModels: { 'claude-desktop': 'qwen/qwen3.5-plus' }, slotModels: { 'claude-desktop': { opus: 'deepseek/deepseek-v4-pro' } } };
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
const read = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const original = { [normalFile]: '{\n  "preferences": {"menuBar": true}\n}\n', [threepFile]: '{"custom":42}\n', [metaFile]: '{"entries":[{"id":"other","name":"Other"}],"appliedId":"other"}\n' };
function seed() { for (const [file, value] of Object.entries(original)) write(file, value); }
async function cleanup() {
  const gateway = (() => { try { return readGatewayConfig(); } catch { return undefined; } })();
  if (gateway) await stopDesktopGateway(gateway).catch(() => {});
  for (const entry of stateStore.getFileStates('claude-desktop')) stateStore.markRemoved('claude-desktop', entry.file);
  for (const file of files) fs.rmSync(file, { force: true });
}
test.after(async () => { await cleanup(); upstream.closeAllConnections(); upstream.close(); fs.rmSync(home, { recursive: true, force: true }); });

test('tool is registered with Opus and Haiku role slots', () => {
  assert.equal(toolManager.get('claude-desktop')?.displayName, 'Claude Desktop');
  assert.equal(toolManager.get('claude-app')?.name, 'claude-desktop');
  assert.deepEqual(toolSlots('claude-desktop').map(slot => slot.id), ['opus', 'haiku']);
  assert.equal(desktopPaths('darwin', '/Users/u', {})[0], '/Users/u/Library/Application Support/Claude/claude_desktop_config.json');
  assert.equal(desktopPaths('win32', '/home/u', { LOCALAPPDATA: '/local' })[1], path.join('/local', 'Claude-3p', 'claude_desktop_config.json'));
  assert.equal(desktopPaths('linux', '/home/u', { XDG_CONFIG_HOME: '/xdg' })[3], '/xdg/Claude-3p/configLibrary/_meta.json');
  assert.throws(() => desktopPaths('aix', '/home/u', {}), /not supported/);
});

test('preview plans every managed file without leaking keys, writing files or starting the gateway', async () => {
  seed();
  const preview = await previewWrites(() => tool.loadConfig('secret-test-key', url, models));
  assert.deepEqual(preview.changes.map(change => change.file).sort(), [...files].sort());
  assert.doesNotMatch(JSON.stringify(publicPlannedChanges(preview.changes)), /secret-test-key/);
  for (const [file, value] of Object.entries(original)) assert.equal(read(file), value);
  for (const file of [profileFile, scriptFile, gatewayFile, autostartFile]) assert.equal(fs.existsSync(file), false);
  assert.equal(stateStore.getFileStates('claude-desktop').length, 0);
});

test('load writes the gateway profile, starts the gateway and routes Desktop requests to Qiniu models', async () => {
  await tool.loadConfig('secret-test-key', url, models);
  assert.equal(tool.isConfigured(), true);
  assert.equal(json(normalFile).deploymentMode, '3p');
  assert.deepEqual(json(normalFile).preferences, { menuBar: true });
  assert.equal(json(threepFile).custom, 42);
  const meta = json(metaFile);
  assert.deepEqual(meta.entries.map(entry => entry.id), ['other', PROFILE_ID]);
  assert.equal(meta.appliedId, PROFILE_ID);
  const profile = json(profileFile);
  const gateway = readGatewayConfig();
  assert.equal(profile.inferenceGatewayBaseUrl, `http://127.0.0.1:${gateway.port}`);
  assert.equal(profile.inferenceGatewayApiKey, gateway.localToken);
  assert.deepEqual(profile.inferenceModels, [
    { name: DESKTOP_ROUTES.sonnet, labelOverride: 'qwen/qwen3.5-plus' },
    { name: DESKTOP_ROUTES.opus, labelOverride: 'deepseek/deepseek-v4-pro' },
  ]);
  // 七牛 Key 只在网关私有配置里，不进入 Desktop 文件、自启动项或状态输出。
  for (const file of [normalFile, threepFile, profileFile, metaFile, autostartFile]) assert.doesNotMatch(read(file), /secret-test-key/);
  assert.match(read(gatewayFile), /secret-test-key/);
  if (process.platform !== 'win32') for (const file of [profileFile, gatewayFile]) assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.doesNotMatch(JSON.stringify(tool.getConfig()), /secret-test-key|localToken/);
  assert.doesNotMatch(JSON.stringify(tool.getConfig()), new RegExp(gateway.localToken));
  assert.match(read(autostartFile), /gateway\.mjs/);
  assert.equal(read(scriptFile), fs.readFileSync(new URL('../dist/lib/desktop-gateway/server.js', import.meta.url), 'utf8'));
  assert.equal(await probeGateway(gateway), 'current');

  const res = await fetch(`${profile.inferenceGatewayBaseUrl}/v1/messages?beta=true`, { method: 'POST', headers: { authorization: `Bearer ${profile.inferenceGatewayApiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', stream: true, messages: [{ role: 'user', content: 'hi' }] }) });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /message_stop/);
  assert.equal(seen.at(-1).body.model, 'qwen/qwen3.5-plus');
  assert.equal(seen.at(-1).auth, 'Bearer secret-test-key');
  assert.equal(seen.at(-1).url, '/v1/messages?beta=true');
});

test('reloading new models keeps the port and token and replaces the running gateway', async () => {
  const before = readGatewayConfig();
  await tool.loadConfig('secret-test-key', url, { toolModels: { 'claude-desktop': 'z-ai/glm-5.3' } });
  const after = readGatewayConfig();
  assert.equal(after.port, before.port);
  assert.equal(after.localToken, before.localToken);
  assert.equal(await probeGateway(after), 'current');
  assert.deepEqual(json(profileFile).inferenceModels, [{ name: DESKTOP_ROUTES.sonnet, labelOverride: 'z-ai/glm-5.3' }]);
  const res = await fetch(`http://127.0.0.1:${after.port}/v1/messages`, { method: 'POST', headers: { authorization: `Bearer ${after.localToken}` }, body: JSON.stringify({ model: DESKTOP_ROUTES.opus }) });
  assert.equal(res.status, 200); await res.text();
  assert.equal(seen.at(-1).body.model, 'z-ai/glm-5.3');
});

test('restore keeps edits Claude Desktop made itself and stops the gateway', async () => {
  const gateway = readGatewayConfig();
  // Desktop 运行时会改写偏好、profile 设置和 profile 列表。
  write(normalFile, JSON.stringify({ ...json(normalFile), preferences: { menuBar: false }, mcpServers: { fs: {} } }, null, 2) + '\n');
  write(profileFile, JSON.stringify({ ...json(profileFile), permissionMode: 'auto' }, null, 2) + '\n');
  const meta = json(metaFile); meta.entries.push({ id: 'later', name: 'Later' }); write(metaFile, JSON.stringify(meta));
  await tool.unloadConfig();
  assert.equal(tool.isConfigured(), false);
  assert.deepEqual(json(normalFile), { preferences: { menuBar: false }, mcpServers: { fs: {} } });
  assert.equal(read(threepFile), original[threepFile]);
  assert.deepEqual(json(metaFile), { entries: [{ id: 'other', name: 'Other' }, { id: 'later', name: 'Later' }], appliedId: 'other' });
  for (const file of [profileFile, scriptFile, gatewayFile, autostartFile]) assert.equal(fs.existsSync(file), false, file);
  assert.equal(await probeGateway(gateway), 'free');
  assert.equal(stateStore.getFileStates('claude-desktop').length, 0);
});

test('restore refuses to overwrite a profile that was repointed elsewhere', async () => {
  seed();
  await tool.loadConfig('secret-test-key', url, models);
  const applied = read(profileFile);
  write(profileFile, JSON.stringify({ ...json(profileFile), inferenceGatewayBaseUrl: 'https://other.example' }));
  await assert.rejects(tool.unloadConfig(), /changed/);
  assert.equal(stateStore.getFileStates('claude-desktop').length, 1);
  write(profileFile, applied);
  await tool.unloadConfig();
  for (const [file, value] of Object.entries(original)) assert.equal(read(file), value);
});

test('switching Desktop to another profile counts as an external provider switch', async () => {
  seed();
  await tool.loadConfig('secret-test-key', url, models);
  assert.equal(isExternallyModified(tool), false);
  const meta = json(metaFile); meta.appliedId = 'other'; write(metaFile, JSON.stringify(meta));
  assert.equal(tool.isConfigured(), false);
  assert.equal(isExternallyModified(tool), true);
  meta.appliedId = PROFILE_ID; write(metaFile, JSON.stringify(meta));
  await tool.unloadConfig();
});

test('invalid inputs and malformed Desktop files never mutate anything', async () => {
  await cleanup(); seed();
  await assert.rejects(tool.loadConfig('', url, models), /API key/);
  await assert.rejects(tool.loadConfig('secret', url, {}), /model is required/);
  write(metaFile, '{broken');
  await assert.rejects(tool.loadConfig('secret', url, models));
  write(metaFile, '{"entries":{}}');
  await assert.rejects(tool.loadConfig('secret', url, models), /profile list/);
  assert.equal(read(normalFile), original[normalFile]);
  for (const file of [profileFile, scriptFile, gatewayFile, autostartFile]) assert.equal(fs.existsSync(file), false);
  assert.equal(stateStore.getFileStates('claude-desktop').length, 0);
});
