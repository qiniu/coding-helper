import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// 隔离 HOME：配置文件、原值记录都落在临时目录（需在导入前设置）
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-helper-compat-'));
process.env.HOME = home;
process.env.USERPROFILE = home;

const {
  OpenAICompatTool,
  openAIBaseUrl,
  getPath,
  setPath,
  restorePath,
} = await import('../dist/lib/tools/openai-compat-tool.js');
const { isQiniuBaseUrl } = await import('../dist/lib/endpoints.js');
const { configManager } = await import('../dist/lib/config.js');
const { stateStore } = await import('../dist/lib/core/state-store.js');
test('path helpers reject prototype-sensitive paths and never follow inherited objects', () => {
  for (const key of ['__proto__.model', 'constructor.prototype.model', 'a.prototype.x']) {
    const target = {};
    assert.throws(() => setPath(target,key,'polluted'), /Unsafe/);
    assert.throws(() => restorePath(target,key,undefined), /Unsafe/);
    assert.throws(() => getPath(target,key), /Unsafe/);
    assert.deepEqual(target,{});assert.equal(Object.prototype.model,undefined);
  }
  const inherited={model:{keep:true}};const target=Object.create(inherited);
  assert.equal(getPath(target,'model.keep'),undefined);
  restorePath(target,'model.keep',undefined);assert.equal(inherited.model.keep,true);
  setPath(target,'model.new','value');assert.deepEqual(inherited,{model:{keep:true}});
  assert.deepEqual(target.model,{new:'value'});
});

// 最小的子类，只用来测试基类的公共逻辑
class DemoTool extends OpenAICompatTool {
  name = 'demo';
  displayName = 'Demo';
  command = 'demo-cli-not-installed';
  installCommand = 'npm install -g demo';
  getConfig() { return {}; }
  isConfigured() { return false; }
  async loadConfig(_apiKey, _baseUrl, models) { this.model = this.resolveModel(models); }
  unloadConfig() {}
}

test('resolveModel prefers the per-tool model, then the default model', async () => {
  const tool = new DemoTool();
  await tool.loadConfig('sk', 'https://api.qnaigc.com', { toolModels: { demo: 'a' }, defaultModel: 'b' });
  assert.equal(tool.model, 'a');
  await tool.loadConfig('sk', 'https://api.qnaigc.com', { toolModels: { other: 'a' }, defaultModel: 'b' });
  assert.equal(tool.model, 'b');
  await assert.rejects(() => tool.loadConfig('sk', 'https://api.qnaigc.com', {}), /Demo/);
});

test('a missing command is reported as not installed', () => {
  const tool = new DemoTool();
  assert.equal(tool.isInstalled(), false);
  assert.equal(tool.getVersion(), null);
});

test('openAIBaseUrl appends /v1 once', () => {
  assert.equal(openAIBaseUrl('https://api.qnaigc.com'), 'https://api.qnaigc.com/v1');
  assert.equal(openAIBaseUrl('https://api.qnaigc.com/'), 'https://api.qnaigc.com/v1');
});

test('path helpers write nested values and restore removes what was added', () => {
  const config = { keep: 1 };
  setPath(config, 'provider.qiniu.options.baseURL', 'https://api.qnaigc.com/v1');
  assert.equal(getPath(config, 'provider.qiniu.options.baseURL'), 'https://api.qnaigc.com/v1');
  // 原值为 null：删除，并清理因此变空的中间对象
  restorePath(config, 'provider.qiniu.options.baseURL', null);
  assert.deepEqual(config, { keep: 1 });
  // 原值存在：写回原值
  setPath(config, 'model', 'qiniu/x');
  restorePath(config, 'model', 'old/model');
  assert.equal(config.model, 'old/model');
});

test('isQiniuBaseUrl recognises both endpoints and the legacy domain', () => {
  assert.equal(isQiniuBaseUrl('https://api.qnaigc.com/v1'), true);
  assert.equal(isQiniuBaseUrl('https://api.modelink.ai/'), true);
  assert.equal(isQiniuBaseUrl('https://openai.qiniu.com/v1'), true);
  assert.equal(isQiniuBaseUrl('https://api.openai.com/v1'), false);
  assert.equal(isQiniuBaseUrl(undefined), false);
});

test('toolModels are merged per tool and defaultModel is kept', () => {
  configManager.setModels({ toolModels: { a: 'm1' }, defaultModel: 'm1' });
  configManager.setModels({ toolModels: { b: 'm2' } });
  const models = configManager.getModels();
  assert.deepEqual(models.toolModels, { a: 'm1', b: 'm2' });
  assert.equal(models.defaultModel, 'm1');
});

test('clearing the config keeps backups and recorded prior values', () => {
  configManager.setApiKey('sk-test');
  stateStore.recordPriors('demo', { model: 'old' });
  fs.mkdirSync(path.join(home, '.coding-helper', 'backups'), { recursive: true });
  configManager.clearConfig();
  assert.equal(fs.existsSync(path.join(home, '.coding-helper', 'config.yaml')), false);
  assert.equal(fs.existsSync(path.join(home, '.coding-helper', 'backups')), true);
  assert.deepEqual(stateStore.getPriors('demo'), { model: 'old' });
});

test('Qiniu URL classification enforces the full origin and excludes credentials', () => {
  for (const value of [
    'https://api.qnaigc.com.evil.example/v1',
    'https://api.qnaigc.com@evil.example',
    'https://evil.example/?next=https://api.qnaigc.com',
    'http://api.qnaigc.com', 'https://api.qnaigc.com:8443',
    'https://user@api.qnaigc.com', 'not a URL',
  ]) assert.equal(isQiniuBaseUrl(value), false, value);
  assert.equal(isQiniuBaseUrl('https://API.QNAIGC.COM:443/v1/'), true);
});

test('clearModelConfig waits for asynchronous unload and propagates failure', async () => {
  const tool = new DemoTool();
  let release;
  let finished = false;
  tool.unloadConfig = () => new Promise(resolve => { release = resolve; });
  const cleanup = tool.clearModelConfig().then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false);
  release();
  await cleanup;
  assert.equal(finished, true);
  tool.unloadConfig = async () => { throw new Error('cleanup failed'); };
  await assert.rejects(tool.clearModelConfig(), /cleanup failed/);
});

test('model metadata keeps supported input and output modalities', async () => {
  const { fetchModelLimits } = await import('../dist/lib/tools/openai-compat-tool.js');
  const { marketModelService } = await import('../dist/lib/market-model-service.js');
  const original = marketModelService.fetchModels;
  marketModelService.fetchModels = async () => [{
    id: 'vision', features: [], model_constraints: { context_length: 32000, max_tokens: 4096 },
    architecture: { input_modalities: ['text', 'image', 'image', 'unknown'], output_modalities: ['text'], function_calling: { supported: false }, reasoning: { supported: false } },
  }];
  try {
    assert.deepEqual(await fetchModelLimits('https://api.qnaigc.com', 'fake-key', 'vision'), {
      contextWindow: 32000, maxOutputTokens: 4096, reasoning: false,
      modalities: { input: ['text', 'image'], output: ['text'] },
    });
  } finally { marketModelService.fetchModels = original; }
});

test('metadata carries reasoning and leaves fallback unspecified', async () => {
  const { fetchModelLimits } = await import('../dist/lib/tools/openai-compat-tool.js');
  const { marketModelService } = await import('../dist/lib/market-model-service.js');
  const original = marketModelService.fetchModels;
  try {
    marketModelService.fetchModels = async () => [{ id: 'reasoner', features: [], model_constraints: { context_length: 32000, max_tokens: 4096 }, architecture: { input_modalities: ['text'], output_modalities: ['text'], function_calling: { supported: false }, reasoning: { supported: true } } }];
    assert.equal((await fetchModelLimits('https://api.qnaigc.com', 'fake', 'reasoner')).reasoning, true);
    assert.equal((await fetchModelLimits('https://api.qnaigc.com', 'fake', 'missing')).reasoning, undefined);
    marketModelService.fetchModels = async () => { throw new Error('offline'); };
    assert.equal((await fetchModelLimits('https://api.qnaigc.com', 'fake', 'reasoner')).reasoning, undefined);
  } finally { marketModelService.fetchModels = original; }
});
