import { isolateHome } from './helpers/isolated-home.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-status-'));
isolateHome(home);
const { detectTool } = await import('../dist/lib/core/tool-service.js');
const { toolManager } = await import('../dist/lib/tool-manager.js');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));
const secret = 'sk-status-test-secret';
test('extensions without optional configuration detection remain loadable', () => {
  const result = detectTool({ isInstalled: () => false });
  assert.equal(result.configured, null);
  assert.deepEqual(result.errors, ['configuration_detection_unsupported']);
});
const write = (file, content) => {
  const target = path.join(home, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
};
write('.coding-helper/config.yaml', `lang: en_US\napi_key: ${secret}\n`);
// 版本检测用假输出，测试不运行本机真实客户端，也不允许联网。
write('preload.cjs', "require('node:child_process').spawnSync = () => ({status:0,stdout:'1.2.3',stderr:''});globalThis.fetch = () => { throw Error('Network access is forbidden'); };\n");
const env = { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config'), PATH: '/usr/bin:/bin' };
function cli(...args) {
  try {
    return { code: 0, stdout: execFileSync(process.execPath, ['--require', path.join(home, 'preload.cjs'), path.resolve('dist/cli.js'), ...args], { env, encoding: 'utf8', timeout: 15000 }) };
  } catch (error) { return { code: error.status, stdout: error.stdout, stderr: error.stderr }; }
}
function snapshot(dir = home) {
  return fs.readdirSync(dir).sort().flatMap(name => {
    const file = path.join(dir, name);
    return fs.statSync(file).isDirectory() ? snapshot(file) : [[path.relative(home, file), fs.readFileSync(file, 'utf8')]];
  });
}

test('detection handles each failure separately without exposing parser input', () => {
  const result = detectTool({
    isInstalled() { throw new Error(secret); },
    getVersion() { assert.fail(); },
    isConfigured() { throw new Error(secret); },
  });
  assert.equal(result.installed, null);
  assert.equal(result.configured, null);
  assert.deepEqual(result.errors, ['installation_detection_failed', 'configuration_detection_failed']);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('status JSON is read-only, includes desktop/launcher states and omits credentials', () => {
  write('.claude/settings.json', JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://api.qnaigc.com', ANTHROPIC_AUTH_TOKEN: secret } }));
  write('.hermes/config.yaml', `model:\n  base_url: https://api.modelink.ai/v1\n  api_key: ${secret}\n`);
  write('.codebuddy/models.json', JSON.stringify({ models: [{ id: 'm', vendor: 'Qiniu', url: 'https://api.qnaigc.com/v1', apiKey: secret }] }));
  write('.workbuddy/models.json', JSON.stringify({ models: [{ id: 'm', vendor: 'Qiniu', url: 'https://api.modelink.ai/v1', apiKey: secret }] }));
  write('.codex/config.toml', 'model_provider = "qnaigc"\n[model_providers.qnaigc]\nbase_url = "https://api.qnaigc.com/bypass/openai/v1"\n');
  const before = snapshot();
  const result = cli('status', '--json');
  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.apiKeySet, true);
  assert.equal(output.tools.length, toolManager.getAll().length);
  for (const name of ['claude-code', 'codex', 'hermes', 'codebuddy', 'workbuddy']) {
    assert.equal(output.tools.find(tool => tool.tool === name).configured, true, name);
  }
  assert.equal(output.tools.find(tool => tool.tool === 'workbuddy').installed, null);
  assert.equal(output.tools.find(tool => tool.tool === 'copilot').launchOnly, true);
  assert.equal(result.stdout.includes(secret), false);
  assert.deepEqual(snapshot(), before);
});

test('Codex detection follows the selected provider rather than an unused Qiniu block', () => {
  const tool = toolManager.get('codex');
  write('.codex/config.toml', 'model_provider = "other"\n[model_providers.qnaigc]\nbase_url = "https://api.qnaigc.com/v1"\n');
  assert.equal(tool.isConfigured(), false);
  write('.codex/config.toml', 'profile = "company"\n[profiles.company]\nmodel_provider = "qiniu"\n[model_providers.qiniu]\nbase_url = "https://api.modelink.ai/bypass/openai/v1"\n');
  assert.equal(tool.isConfigured(), true);
});

test('malformed configuration reports unknown and a failure exit without leaking file content', () => {
  write('.claude/settings.json', `{"env": "${secret}`);
  const before = snapshot();
  const result = cli('status', '--json');
  assert.equal(result.code, 1);
  const output = JSON.parse(result.stdout);
  const claude = output.tools.find(tool => tool.tool === 'claude-code');
  assert.equal(claude.configured, null);
  assert.deepEqual(claude.errors, ['configuration_detection_failed']);
  assert.equal(result.stdout.includes(secret), false);
  assert.deepEqual(snapshot(), before);
});

test('vendor labels alone do not treat a different provider URL as Qiniu', () => {
  for (const name of ['codebuddy', 'workbuddy']) {
    write(`.${name}/models.json`, JSON.stringify({ models: [{ id: 'm', vendor: 'Qiniu', url: 'https://other.example/v1' }] }));
    assert.equal(toolManager.get(name).isConfigured(), false);
  }
});

test('all persistent adapters distinguish malformed files from an unconfigured client', () => {
  const cases = [
    ['claude-code', '.claude/settings.json', '{'],
    ['codex', '.codex/config.toml', '['],
    ['hermes', '.hermes/config.yaml', 'model: ['],
    ['codebuddy', '.codebuddy/models.json', '{'],
    ['workbuddy', '.workbuddy/models.json', '{'],
    ['opencode', '.config/opencode/opencode.json', '{'],
    ['openclaw', '.openclaw/openclaw.json', '{'],
    ['qwen-code', '.qwen/settings.json', '{'],
    ['droid', '.factory/settings.json', '{'],
    ['minimax-code', '.minimax/config.yaml', 'custom_provider: ['],
    ['kimi-code', '.kimi-code/config.toml', '['],
    ['grok', '.grok/config.toml', '['],
  ];
  for (const [name, file, content] of cases) {
    write(file, content);
    const tool = toolManager.get(name);
    const detection = detectTool({ ...tool, isInstalled: () => false, isConfigured: () => tool.isConfigured() });
    assert.equal(detection.configured, null, name);
    assert.deepEqual(detection.errors, ['configuration_detection_failed'], name);
  }
});

test('Qwen credential variable names cannot classify a foreign endpoint as Qiniu',()=>{
  const entry={id:'model',envKey:'QINIU_API_KEY',baseUrl:'https://foreign.example/v1'};
  const save=()=>write('.qwen/settings.json',JSON.stringify({modelProviders:{openai:[entry]}}));
  save();assert.equal(toolManager.get('qwen-code').isConfigured(),false);
  entry.baseUrl='https://api.qnaigc.com/v1';save();assert.equal(toolManager.get('qwen-code').isConfigured(),true);
  delete entry.baseUrl;save();assert.equal(toolManager.get('qwen-code').isConfigured(),false);
});
