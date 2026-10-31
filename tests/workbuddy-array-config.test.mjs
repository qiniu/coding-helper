import { isolateHome } from './helpers/isolated-home.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workbuddy-array-')));
isolateHome(home);
const { WorkBuddyTool } = await import('../dist/lib/tools/workbuddy-tool.js');
const { CodeBuddyTool } = await import('../dist/lib/tools/codebuddy-tool.js');
const { marketModelService } = await import('../dist/lib/market-model-service.js');
const { stateStore } = await import('../dist/lib/core/state-store.js');
const { previewWrites } = await import('../dist/lib/core/safe-write.js');
const { detectTool, getSyncTargets } = await import('../dist/lib/core/tool-service.js');
const file = path.join(home, '.workbuddy/models.json');
const tool = new WorkBuddyTool();
const market = { id: 'test/model', name: 'Test Model', features: ['工具调用'],
  model_constraints: { context_length: 32000, max_tokens: 4000 },
  architecture: { input_modalities: ['text', 'image'], function_calling: { supported: true } } };
const fetch = marketModelService.fetchModels;
marketModelService.fetchModels = async () => [market];
test.after(() => { marketModelService.fetchModels = fetch; fs.rmSync(home, { recursive: true, force: true }); });
test.beforeEach(() => { stateStore.clear(); fs.rmSync(path.dirname(file), { recursive: true, force: true }); });
const read = () => fs.readFileSync(file, 'utf8');
const write = content => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
const load = (key = 'test-key') => tool.loadConfig(key, 'https://api.qnaigc.com', { workbuddyModels: [market.id] });
const foreign = { id: 'foreign/model', vendor: 'Custom', apiKey: 'foreign-secret', custom: true, temperature: -0 };

test('array detection and sync targets recognize Qiniu without exposing credentials', () => {
  write(JSON.stringify([{ id: market.id, vendor: 'Qiniu', url: 'https://api.modelink.ai/v1/chat/completions', apiKey: 'secret' }]));
  assert.equal(tool.isConfigured(), true);
  assert.equal(tool.getConfig().models[0].id, market.id);
  const detection = detectTool(tool);
  assert.equal(detection.configured, true);
  assert.deepEqual(detection.errors, []);
  assert.deepEqual(getSyncTargets([tool]), [tool]);
  write(JSON.stringify([{ id: market.id, vendor: 'Qiniu', url: 'https://other.example/v1' }]));
  assert.equal(tool.isConfigured(), false);
});

test('array reload preserves foreign entries and restores exact original bytes', async () => {
  const original = '[\r\n\t{"id":"foreign/model","vendor":"Custom","apiKey":"foreign-secret","custom":true,"temperature":-0},\r\n\t{"id":"foreign/model","vendor":"Custom","apiKey":"foreign-secret","custom":true,"temperature":-0},\r\n\t{"id":"prior","vendor":"Qiniu","apiKey":"original-secret"}\r\n]\r\n';
  write(original);
  await load('first-key');
  await load('second-key');
  const models = JSON.parse(read());
  assert.ok(Array.isArray(models));
  assert.deepEqual(models.slice(0, 2), JSON.parse(JSON.stringify([foreign, foreign])));
  assert.equal(models.length, 3);
  assert.equal(models[2].apiKey, 'second-key');
  assert.equal(models[2].url, 'https://api.qnaigc.com/v1/chat/completions');
  assert.equal(models[2].supportsToolCall, true);
  assert.equal(models[2].supportsImages, true);
  assert.equal(models[2].maxInputTokens, 32000);
  await tool.unloadConfig();
  assert.equal(read(), original);
  assert.equal(stateStore.getState('workbuddy', file), undefined);
});

for (const original of [undefined, '[]', '[\r\n]\r\n']) {
  test('new and empty WorkBuddy files use arrays and restore their original existence: ' + JSON.stringify(original), async () => {
    if (original !== undefined) write(original);
    await load();
    assert.ok(Array.isArray(JSON.parse(read())));
    await load('updated-key');
    await tool.unloadConfig();
    if (original === undefined) assert.equal(fs.existsSync(file), false);
    else assert.equal(read(), original);
  });
}

for (const reload of [false, true]) {
  test('legacy object journal survives desktop conversion to array; reload=' + reload, async () => {
    const original = '{\r\n\t"models": [{"id":"old","vendor":"Qiniu","apiKey":"old-secret"}],\r\n\t"availableModels": ["old"], "custom": true\r\n}\r\n';
    write(original);
    await load();
    const object = JSON.parse(read());
    assert.ok(!Array.isArray(object));
    write(JSON.stringify(object.models));
    if (reload) {
      await load('new-key');
      assert.ok(Array.isArray(JSON.parse(read())));
      assert.equal(JSON.parse(read())[0].apiKey, 'new-key');
    }
    await tool.unloadConfig();
    assert.equal(read(), original);
    assert.equal(stateStore.getState('workbuddy', file), undefined);
  });
}

test('legacy journal for an originally absent file reloads after array conversion', async () => {
  await load();
  const models = JSON.parse(read());
  const saved = stateStore.getState('workbuddy', file);
  stateStore.setState('workbuddy', { ...saved, applied: { models, availableModels: models.map(m => m.id) } }, file);
  await load('new-key');
  assert.equal(JSON.parse(read())[0].apiKey, 'new-key');
  await tool.unloadConfig();
  assert.equal(fs.existsSync(file), false);
});

test('array preview supports repeated configuration without changing client or journal', async () => {
  write(JSON.stringify([foreign]));
  await load();
  const before = read();
  const journalFile = path.join(home, '.coding-helper/state.json');
  const journal = fs.readFileSync(journalFile, 'utf8');
  const backups = fs.readdirSync(path.join(home, '.coding-helper/backups'));
  const result = await previewWrites(async () => { await load('preview-key'); await load('preview-key-2'); });
  assert.equal(result.changes.length, 1);
  assert.ok(Array.isArray(JSON.parse(result.changes[0].after)));
  assert.equal(JSON.parse(result.changes[0].after).at(-1).apiKey, 'preview-key-2');
  assert.equal(read(), before);
  assert.equal(fs.readFileSync(journalFile, 'utf8'), journal);
  assert.deepEqual(fs.readdirSync(path.join(home, '.coding-helper/backups')), backups);
});

for (const original of ['[null]', '[{}]', '[{"id":""}]', '42', 'null', '[broken']) {
  test('invalid WorkBuddy array is rejected without overwriting: ' + original, async () => {
    write(original);
    await assert.rejects(load());
    assert.equal(read(), original);
    assert.equal(stateStore.getState('workbuddy', file), undefined);
    assert.equal(detectTool(tool).configured, null);
  });
}

test('foreign ID collisions and edits to managed arrays retain the file and journal', async () => {
  const collision = JSON.stringify([{ ...foreign, id: market.id }]);
  write(collision);
  await assert.rejects(load(), /another vendor/);
  assert.equal(read(), collision);
  assert.equal(stateStore.getState('workbuddy', file), undefined);
  write(JSON.stringify([foreign]));
  await load();
  const saved = stateStore.getState('workbuddy', file);
  const models = JSON.parse(read());
  models.at(-1).apiKey = 'user-changed-key';
  const changed = JSON.stringify(models);
  write(changed);
  await assert.rejects(load(), /changed since loading/);
  await assert.rejects(tool.unloadConfig(), /changed since loading/);
  assert.equal(read(), changed);
  assert.deepEqual(stateStore.getState('workbuddy', file), saved);
});

for (const interruption of ['before-write', 'after-write', 'after-object-conversion']) {
  test('array restoration recovers interrupted reload: ' + interruption, async () => {
    const original = interruption === 'after-object-conversion' ? '{ "custom": true }' : '[ ]\r\n';
    write(original);
    await load();
    const set = stateStore.setState;
    let count = 0;
    stateStore.setState = function (...args) {
      count++;
      if (count === 2 && interruption !== 'before-write') {
        if (interruption === 'after-object-conversion') write(JSON.stringify(JSON.parse(read()).models));
        throw Error('interrupted');
      }
      const result = set.apply(this, args);
      if (count === 1 && interruption === 'before-write') throw Error('interrupted');
      return result;
    };
    try { await assert.rejects(load('new-key'), /interrupted/); }
    finally { stateStore.setState = set; }
    await tool.unloadConfig();
    assert.equal(read(), original);
    assert.equal(stateStore.getState('workbuddy', file), undefined);
  });
}

test('CodeBuddy continues to reject a top-level array', async () => {
  const codebuddyFile = path.join(home, '.codebuddy/models.json');
  fs.mkdirSync(path.dirname(codebuddyFile), { recursive: true });
  fs.writeFileSync(codebuddyFile, '[]');
  await assert.rejects(new CodeBuddyTool().loadConfig('key', 'https://api.qnaigc.com', { codeBuddyModels: [market.id] }), /top-level value is not an object/);
  assert.equal(fs.readFileSync(codebuddyFile, 'utf8'), '[]');
});
