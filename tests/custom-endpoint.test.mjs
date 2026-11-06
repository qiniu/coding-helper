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
test('changing a custom URL and switching to built-in both offer old clients for sync', {skip:process.platform==='win32'},async()=>{
 const {runPrompt}=await import('./helpers/prompt-pty.mjs');
 const source=`import {configManager} from './dist/lib/config.js';import {i18n} from './dist/lib/i18n.js';import {isQiniuBaseUrl} from './dist/lib/endpoints.js';import {toolManager} from './dist/lib/tool-manager.js';import {promptHelper} from './dist/lib/wizard/ui/prompt-helper.js';import {runEndpointSelectionFlow} from './dist/lib/wizard/flows/endpoint-selection-flow.js';configManager.setLang('en_US');i18n.init();configManager.setEndpoint('custom','https://old.example/proxy');configManager.setApiKey('test-key');let clientUrl=configManager.baseUrl;toolManager.getAll=()=>[{name:'test',displayName:'Test',isConfigured:()=>isQiniuBaseUrl(clientUrl),loadConfig:async(_key,url)=>{clientUrl=url;}}];const offered=[];promptHelper.checkbox=async(_message,choices)=>{offered.push(choices.map(c=>c.value));return ['test'];};await runEndpointSelectionFlow();console.log('FIRST',clientUrl);await runEndpointSelectionFlow();console.log('SECOND',clientUrl);console.log('OFFERED',JSON.stringify(offered));`;
 const out=await runPrompt(source,[['Select API endpoint','\r'],['API base URL','invalid\r'],['API base URL','https://new.example/proxy\r'],['Select API endpoint','\x1b[A\x1b[A\r']]);
 assert.match(out,/FIRST https:\/\/new.example\/proxy/);assert.match(out,/SECOND https:\/\/api.qnaigc.com/);assert.match(out,/OFFERED.*\[\["test"\],\["test"\]\]/);assert.match(out,/not a valid/);
});
test('header displays the saved custom URL as configured', async t => {
  configManager.setEndpoint('custom', 'https://display.example/proxy');
  t.mock.method(uiRenderer, 'clearScreen', () => {});
  t.mock.method(uiRenderer, 'renderLogo', () => {});
  const {logger}=await import('../dist/utils/logger.js');
  const lines=[];t.mock.method(logger,'log',line=>lines.push(line));
  uiRenderer.renderHeader();
  assert.ok(lines.some(line=>line.includes(configManager.baseUrl.replace(/^https?:\/\//,''))));
});

test('quick-save maintains custom URL persistence and refreshes endpoint recognition',()=>{
 configManager.setEndpoint('custom','https://previous.example/proxy');
 configManager.saveSettings('key','custom',{});configManager.reload();assert.equal(configManager.baseUrl,'https://previous.example/proxy');
 configManager.saveSettings('key','international',{});
 assert.equal(isQiniuBaseUrl('https://previous.example/proxy/v1'),false);
 assert.doesNotMatch(fs.readFileSync(configManager.configFile,'utf8'),/base_url:/);
 configManager.reload();assert.equal(isQiniuBaseUrl('https://previous.example/proxy/v1'),false);
});
