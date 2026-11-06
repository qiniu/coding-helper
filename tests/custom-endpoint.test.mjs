import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isolateHome } from './helpers/isolated-home.mjs';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-endpoint-'));
isolateHome(home);
const { configManager } = await import('../dist/lib/config.js');
const { normalizeCustomBaseUrl, getBaseUrl, isQiniuBaseUrl, registerCustomBaseUrls } = await import('../dist/lib/endpoints.js');
test.after(() => fs.rmSync(process.env.HOME, { recursive: true, force: true }));
test('custom endpoint validates and normalizes URLs without falling back', () => {
  assert.equal(normalizeCustomBaseUrl(' https://gateway.example.com/proxy/// '), 'https://gateway.example.com/proxy');
  for (const url of ['file:///tmp/x', 'https://u:p@gateway.example.com', 'https://example.com/?key=x', 'https://example.com/#x', 'https://example.com/proxy?', 'https://example.com/proxy#', 'invalid']) assert.throws(() => normalizeCustomBaseUrl(url));
  assert.throws(() => getBaseUrl('custom'));
  configManager.setEndpoint('custom', 'https://gateway.example.com/proxy/');
  assert.equal(configManager.baseUrl, 'https://gateway.example.com/proxy');
  configManager.reload();
  assert.equal(configManager.baseUrl, 'https://gateway.example.com/proxy');
  assert.equal(isQiniuBaseUrl('https://gateway.example.com/proxy/v1'), true);
  for (const url of ['https://gateway.example.com.evil/proxy', 'https://gateway.example.com/proxy2/v1', 'https://u:p@gateway.example.com/proxy/v1']) assert.equal(isQiniuBaseUrl(url), false);
  const before = fs.readFileSync(configManager.configFile, 'utf8');
  assert.throws(() => configManager.setEndpoint('custom', 'invalid'));
  assert.equal(fs.readFileSync(configManager.configFile, 'utf8'), before);
  registerCustomBaseUrls([]);
  assert.equal(isQiniuBaseUrl('https://gateway.example.com/proxy/v1'), false);
});

const { promptHelper } = await import('../dist/lib/wizard/ui/prompt-helper.js');
const { uiRenderer } = await import('../dist/lib/wizard/ui/ui-renderer.js');
const { toolManager } = await import('../dist/lib/tool-manager.js');
const { runEndpointSelectionFlow } = await import('../dist/lib/wizard/flows/endpoint-selection-flow.js');
test('changing a custom URL and switching to built-in both offer old clients for sync', async t => {
  const original = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  const output = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  t.after(() => {
    if (original) Object.defineProperty(process.stdin, 'isTTY', original); else delete process.stdin.isTTY;
    if (output) Object.defineProperty(process.stdout, 'isTTY', output); else delete process.stdout.isTTY;
  });
  for (const method of ['renderHeader', 'renderError', 'renderSuccess']) t.mock.method(uiRenderer, method, () => {});
  configManager.setEndpoint('custom', 'https://old.example/proxy');
  configManager.setApiKey('test-key');
  let clientUrl = configManager.baseUrl;
  const tool = { name: 'test', displayName: 'Test', isConfigured: () => isQiniuBaseUrl(clientUrl), loadConfig: async (_key, url) => { clientUrl = url; } };
  t.mock.method(toolManager, 'getAll', () => [tool]);
  const offered = [];
  t.mock.method(promptHelper, 'checkbox', async (_message, choices) => { offered.push(choices.map(c => c.value)); return ['test']; });
  let endpoint = 'custom';
  t.mock.method(promptHelper, 'select', async () => endpoint);
  const inputs = ['invalid', 'https://new.example/proxy'];
  t.mock.method(promptHelper, 'input', async () => inputs.shift());
  await runEndpointSelectionFlow();
  assert.equal(clientUrl, 'https://new.example/proxy');
  assert.equal(uiRenderer.renderError.mock.calls.length, 1);
  endpoint = 'china';
  await runEndpointSelectionFlow();
  assert.equal(clientUrl, getBaseUrl('china'));
  assert.deepEqual(offered, [['test'], ['test']]);
});
test('header displays the saved custom URL as configured', t => {
  configManager.setEndpoint('custom', 'https://display.example/proxy');
  t.mock.method(uiRenderer, 'clearScreen', () => {});
  t.mock.method(uiRenderer, 'renderLogo', () => {});
  const panel = t.mock.method(uiRenderer, 'renderConfigPanel', () => {});
  uiRenderer.renderHeader();
  assert.equal(panel.mock.calls[0].arguments[0][0].value, configManager.baseUrl);
  assert.equal(panel.mock.calls[0].arguments[0][0].configured, true);
});

test('quick-save maintains custom URL persistence and refreshes endpoint recognition',()=>{
 configManager.setEndpoint('custom','https://previous.example/proxy');
 configManager.saveSettings('key','custom',{});configManager.reload();assert.equal(configManager.baseUrl,'https://previous.example/proxy');
 configManager.saveSettings('key','international',{});
 assert.equal(isQiniuBaseUrl('https://previous.example/proxy/v1'),false);
 assert.doesNotMatch(fs.readFileSync(configManager.configFile,'utf8'),/base_url:/);
 configManager.reload();assert.equal(isQiniuBaseUrl('https://previous.example/proxy/v1'),false);
});
