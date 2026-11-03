import assert from 'node:assert/strict';
import test from 'node:test';
import { runPrompt } from './helpers/prompt-pty.mjs';

const pty = { skip: process.platform === 'win32' };
const source = (saved = false) => `
  import fs from 'node:fs';
  import assert from 'node:assert/strict';
  import { configManager } from './dist/lib/config.js';
  import { i18n } from './dist/lib/i18n.js';
  import { runApiKeyFlow } from './dist/lib/wizard/flows/api-key-flow.js';
  import { authCommand } from './dist/commands/auth.js';
  import { quickCommand } from './dist/commands/quick.js';
  import { toolManager } from './dist/lib/tool-manager.js';
  import { modelService } from './dist/lib/model-service.js';
  import { marketModelService } from './dist/lib/market-model-service.js';
  configManager.setLang('zh_CN');
  i18n.init('zh_CN');
  ${saved ? "configManager.setApiKey('saved-key');" : ''}
  const before = fs.readFileSync(configManager.configFile, 'utf8');
  let requests = 0, clears = 0, writes = 0;
  globalThis.fetch = async () => { requests++; return new Response('{}', { status: 401 }); };
  modelService.clearCache = marketModelService.clearCache = () => { clears++; };
  for (const tool of toolManager.getAll()) tool.loadConfig = async () => { writes++; };
`;
const unchanged = expectedRequests => `
  assert.equal(requests, ${expectedRequests});
  assert.equal(clears, 0);
  assert.equal(writes, 0);
  assert.equal(fs.readFileSync(configManager.configFile, 'utf8'), before);
  console.log('KEY_CANCEL_OK');
`;
const keyPrompt = /请输入您的 API Key[^]*Esc 返回/;

for (const saved of [false, true]) test(`API key Esc returns false without validation or persistence (${saved ? 'existing key' : 'first key'})`, pty, async () => {
  const out = await runPrompt(source(saved) + `assert.equal(await runApiKeyFlow(true), false);` + unchanged(0), [[keyPrompt, 'discarded-secret\x1b']]);
  assert.match(out, /KEY_CANCEL_OK/);
  assert.doesNotMatch(out, /API Key 不能为空|是否重新输入|discarded-secret/);
});

test('empty API key submission still offers retry, and Esc from retry cancels', pty, async () => {
  const out = await runPrompt(source() + `assert.equal(await runApiKeyFlow(), false);` + unchanged(0), [
    [keyPrompt, '\r'], [/是否重新输入[^]*Esc 返回/, '\x1b'],
  ]);
  assert.match(out, /KEY_CANCEL_OK/);
  assert.match(out, /API Key 不能为空/);
});

test('Esc after an invalid API key retry does not validate or prompt again', pty, async () => {
  const out = await runPrompt(source(true) + `assert.equal(await runApiKeyFlow(), false);` + unchanged(1), [
    [keyPrompt, 'invalid-key\r'], [/是否重新输入[^]*Esc 返回/, '\r'], [keyPrompt, '\x1b'],
  ]);
  assert.match(out, /KEY_CANCEL_OK/);
  assert.doesNotMatch(out, /API Key 不能为空/);
});

test('interactive auth Esc keeps the existing key and exits without an error', pty, async () => {
  const out = await runPrompt(source(true) + `await authCommand(undefined, { sync: true }); assert.ok(!process.exitCode);` + unchanged(0), [[keyPrompt, '\x1b']]);
  assert.match(out, /KEY_CANCEL_OK/);
  assert.doesNotMatch(out, /API Key 不能为空|是否重新输入/);
});

test('interactive quick configuration Esc returns before validation or client writes', pty, async () => {
  const out = await runPrompt(source() + `await quickCommand('codex', [], {}); assert.ok(!process.exitCode);` + unchanged(0), [[keyPrompt, '\x1b']]);
  assert.match(out, /KEY_CANCEL_OK/);
  assert.doesNotMatch(out, /API Key 不能为空|是否重新输入|缺少 API Key/);
});

