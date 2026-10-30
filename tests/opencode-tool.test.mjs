import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// 隔离 HOME；测试用假 Key，模型上限查询会失败并走默认值
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-helper-opencode-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
delete process.env.XDG_CONFIG_HOME;
const MODELS = { defaultModel: 'deepseek-v3' };
// isConfigured 依据七牛域名判断，所以写入时使用七牛线路地址；上限查询走不到真实服务时用默认值
const QINIU = 'https://api.qnaigc.com';

const { OpenCodeTool, getOpenCodeConfigFile } = await import('../dist/lib/tools/opencode-tool.js');
// 普通配置测试不启动真实安装；版本保护在专项测试中注入。
OpenCodeTool.prototype.getVersion = () => null;
test('OpenCode 1.x adapter pins installation and update and refuses v2', async () => {
  const tool = new OpenCodeTool();
  tool.getVersion = () => '1.19.5';
  assert.equal(tool.installCommand, 'npm install -g opencode-ai@1');
  assert.equal(tool.updateCommand, 'npm install -g opencode-ai@1');
  assert.equal(tool.npmPackageName, 'opencode-ai');
  tool.getVersion = () => '2.0.0';
  assert.throws(() => tool.validateUpdate(), /1.x only/);
  await assert.rejects(tool.loadConfig('key', QINIU, MODELS), /1.x only/);
});
test('OpenCode v2 config is refused byte-for-byte even without an installed binary', async () => {
  const file = getOpenCodeConfigFile();
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const original = '{"providers":{"qiniu":{"settings":{"baseURL":"https://example.test"}}}}';
  fs.writeFileSync(file, original);
  try {
    await assert.rejects(new OpenCodeTool().loadConfig('key', QINIU, MODELS), /v2 configuration/);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
  } finally { fs.rmSync(file); }
});
const { stateStore } = await import('../dist/lib/core/state-store.js');
const { marketModelService } = await import('../dist/lib/market-model-service.js');

// 不访问网络：模型上限查询直接失败，走默认值
marketModelService.fetchModels = async () => {
  throw new Error('offline');
};

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf-8'));
test('OpenCode rejects inherited auth headers and unavailable alpha models without writes',async()=>{
 const file=getOpenCodeConfigFile();const saved=process.env.OPENCODE_ENABLE_EXPERIMENTAL_MODELS;delete process.env.OPENCODE_ENABLE_EXPERIMENTAL_MODELS;
 try{for(const provider of [{options:{headers:{Authorization:'old-token'}}},{models:{'deepseek-v3':{headers:{authorization:'old-token'}}}},{models:{'deepseek-v3':{status:'alpha'}}}]){
  stateStore.clear();const original=JSON.stringify({provider:{qiniu:provider}});write(file,original);
  await assert.rejects(new OpenCodeTool().loadConfig('new-key',QINIU,MODELS),/authentication headers|alpha model/);assert.equal(fs.readFileSync(file,'utf8'),original);
 }}finally{if(saved===undefined)delete process.env.OPENCODE_ENABLE_EXPERIMENTAL_MODELS;else process.env.OPENCODE_ENABLE_EXPERIMENTAL_MODELS=saved;}
});
test('OpenCode offline load preserves known limits from lower configuration layers',async()=>{
 stateStore.clear();const file=getOpenCodeConfigFile(),legacy=path.join(path.dirname(file),'config.json');
 write(file,'{}');write(legacy,JSON.stringify({provider:{qiniu:{models:{'deepseek-v3':{limit:{context:8192,output:2048}}}}}}));
 const tool=new OpenCodeTool();
 try{await tool.loadConfig('new-key',QINIU,MODELS);assert.deepEqual(json(file).provider.qiniu.models['deepseek-v3'].limit,{context:8192,output:2048});await tool.unloadConfig();}
 finally{fs.rmSync(legacy,{force:true});}
});

test('OpenCode: adds the qiniu provider as default model, restore brings the old model back', async () => {
  stateStore.clear();
  const file = getOpenCodeConfigFile();
  const original = { model: 'anthropic/claude-sonnet', provider: { ollama: { npm: 'x' } }, theme: 'dark' };
  write(file, JSON.stringify(original));
  const tool = new OpenCodeTool();
  await tool.loadConfig('sk-qiniu', QINIU, MODELS);
  const loaded = json(file);
  assert.equal(loaded.model, 'qiniu/deepseek-v3');
  assert.equal(loaded.provider.qiniu.options.baseURL, 'https://api.qnaigc.com/v1');
  assert.equal(loaded.provider.qiniu.options.apiKey, 'sk-qiniu');
  assert.ok(loaded.provider.ollama);
  assert.equal(tool.isConfigured(), true);

  tool.unloadConfig();
  assert.deepEqual(json(file), original);
});

test('OpenCode: a file that only existed because of us is removed on restore', async () => {
  stateStore.clear();
  fs.rmSync(path.join(home, '.config'), { recursive: true, force: true });
  const tool = new OpenCodeTool();
  await tool.loadConfig('sk-qiniu', QINIU, MODELS);
  tool.unloadConfig();
  assert.equal(fs.existsSync(getOpenCodeConfigFile()), false);
});

test('OpenCode: a later load records the values the user had at that time', async () => {
  stateStore.clear();
  const file = getOpenCodeConfigFile();
  write(file, JSON.stringify({ model: 'a/one' }));
  const tool = new OpenCodeTool();
  await tool.loadConfig('sk-qiniu', QINIU, MODELS);
  tool.unloadConfig();
  // 卸载后用户自己换了模型，再次装载、卸载应还原成新的模型
  write(file, JSON.stringify({ model: 'b/two' }));
  await tool.loadConfig('sk-qiniu', QINIU, MODELS);
  tool.unloadConfig();
  assert.equal(json(file).model, 'b/two');
});

test('OpenCode: a corrupt config is reported and never overwritten', async () => {
  stateStore.clear();
  const file = getOpenCodeConfigFile();
  write(file, '{ "model": ');
  await assert.rejects(() => new OpenCodeTool().loadConfig('sk-qiniu', QINIU, MODELS));
  assert.equal(fs.readFileSync(file, 'utf-8'), '{ "model": ');
});

test('OpenCode: fails clearly when no model has been chosen', async () => {
  await assert.rejects(() => new OpenCodeTool().loadConfig('sk', QINIU, {}), /model|模型/i);
});

function freshConfig(name, original = {}) {
  process.env.XDG_CONFIG_HOME = path.join(home, name);
  stateStore.clear();
  const file = getOpenCodeConfigFile();
  write(file, JSON.stringify(original));
  return file;
}

test('OpenCode: restores an unrelated model and an existing qiniu provider', async () => {
  const original = { model: 'anthropic/claude-sonnet', provider: { qiniu: { name: 'original', options: { baseURL: QINIU } } } };
  const file = freshConfig('existing-provider', original);
  const tool = new OpenCodeTool();
  await tool.loadConfig('fake', QINIU, MODELS);
  tool.unloadConfig();
  assert.deepEqual(json(file), original);
});

test('OpenCode: refuses concurrent edits or corrupt JSON after metadata fetch', async () => {
  const originalFetch = marketModelService.fetchModels;
  try {
    for (const changed of ['{"permission":{"edit":"deny"},"mcp":{"local":{}}}', '{broken', '']) {
      const file = freshConfig('race-' + changed.length, { model: 'before' });
      marketModelService.fetchModels = async () => { write(file, changed); return []; };
      await assert.rejects(new OpenCodeTool().loadConfig('fake', QINIU, MODELS), /changed|Cannot parse/);
      assert.equal(fs.readFileSync(file, 'utf8'), changed);
      assert.equal(stateStore.getPriors('opencode', file), undefined);
    }
  } finally { marketModelService.fetchModels = originalFetch; }
});

test('OpenCode: distinct XDG paths retain separate restoration state', async () => {
  const a = freshConfig('xdg-a', { model: 'a/model' });
  const tool = new OpenCodeTool();
  await tool.loadConfig('fake', QINIU, MODELS);
  process.env.XDG_CONFIG_HOME = path.join(home, 'xdg-b');
  const b = getOpenCodeConfigFile();
  write(b, JSON.stringify({ model: 'b/model' }));
  await tool.loadConfig('fake', QINIU, MODELS);
  tool.unloadConfig();
  assert.equal(json(b).model, 'b/model');
  assert.equal(stateStore.getPriors('opencode', a).snapshot.model, 'a/model');
  process.env.XDG_CONFIG_HOME = path.join(home, 'xdg-a');
  tool.unloadConfig();
  assert.equal(json(a).model, 'a/model');
});

test('OpenCode: failed backup or rename discards only new priors and retry records fresh model', async () => {
  for (const operation of ['copyFileSync', 'renameSync']) {
    const file = freshConfig('failure-' + operation, { model: 'before' });
    const originalOperation = fs[operation];
    fs[operation] = (...args) => {
      if (args[0] === file || args[1] === file) throw new Error('injected failure');
      return originalOperation(...args);
    };
    const tool = new OpenCodeTool();
    try { await assert.rejects(tool.loadConfig('fake', QINIU, MODELS), /injected/); }
    finally { fs[operation] = originalOperation; }
    assert.equal(json(file).model, 'before');
    assert.equal(stateStore.getPriors('opencode', file), undefined);
    write(file, JSON.stringify({ model: 'after-failure' }));
    await tool.loadConfig('fake', QINIU, MODELS);
    tool.unloadConfig();
    assert.equal(json(file).model, 'after-failure');
  }
});

test('OpenCode: failed repeated load preserves priors from successful application', async () => {
  const file = freshConfig('repeat-failure', { model: 'original' });
  const tool = new OpenCodeTool();
  await tool.loadConfig('fake', QINIU, MODELS);
  const original = fs.renameSync;
  fs.renameSync = (...args) => { if (args[1] === file) throw new Error('write failure'); return original(...args); };
  try { await assert.rejects(tool.loadConfig('fake', QINIU, { defaultModel: 'different' }), /write failure/); }
  finally { fs.renameSync = original; }
  assert.equal(stateStore.getPriors('opencode', file).snapshot.model, 'original');
  tool.unloadConfig();
  assert.equal(json(file).model, 'original');
});

test('OpenCode: symlink targets and links remain unchanged', async () => {
  const file = freshConfig('symlink');
  const target = path.join(home, 'dotfiles-opencode.json');
  write(target, '{"model":"original"}');
  fs.rmSync(file);
  fs.symlinkSync(target, file);
  const tool = new OpenCodeTool();
  await assert.rejects(tool.loadConfig('fake', QINIU, MODELS), /symbolic link/);
  assert.throws(() => tool.unloadConfig(), /symbolic link/);
  assert.equal(fs.lstatSync(file).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(target, 'utf8'), '{"model":"original"}');
  assert.equal(stateStore.getPriors('opencode', file), undefined);
});

test('OpenCode: JSONC takes precedence and restores the same file', async () => {
  const file = freshConfig('jsonc', { model: 'json/model' });
  const jsonc = file + 'c';
  const original = '{"model":"jsonc/model"}';
  write(jsonc, original);
  assert.equal(getOpenCodeConfigFile(), jsonc);
  const tool = new OpenCodeTool();
  await tool.loadConfig('fake', QINIU, MODELS);
  assert.equal(json(jsonc).model, 'qiniu/deepseek-v3');
  assert.equal(json(file).model, 'json/model');
  tool.unloadConfig();
  assert.equal(fs.readFileSync(jsonc, 'utf8'), original);
  write(jsonc, '{ // comment\n "model": "unchanged" }');
  await assert.rejects(tool.loadConfig('fake', QINIU, MODELS), /Cannot parse/);
  assert.equal(json(file).model, 'json/model');
});

test('OpenCode: provider filter conflicts fail before changes or prior recording', async () => {
  for (const filters of [{ enabled_providers: ['anthropic'] }, { disabled_providers: ['qiniu'] }]) {
    for (const withJsonc of [false, true]) {
      const file = freshConfig('filters-' + Object.keys(filters)[0] + withJsonc, { model: 'original', ...filters });
      if (withJsonc) write(file + 'c', '{}');
      const target = getOpenCodeConfigFile();
      const before = fs.readFileSync(target, 'utf8');
      await assert.rejects(new OpenCodeTool().loadConfig('fake', QINIU, MODELS), /filters exclude/);
      assert.equal(fs.readFileSync(target, 'utf8'), before);
      assert.equal(stateStore.getPriors('opencode', target), undefined);
    }
  }
});

test('OpenCode: generated vision models retain input modalities', async () => {
  const file = freshConfig('vision');
  const original = marketModelService.fetchModels;
  marketModelService.fetchModels = async () => [{ id: 'vision', features: [], model_constraints: { context_length: 32000, max_tokens: 4096 }, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'], function_calling: { supported: true }, reasoning: { supported: false } } }];
  try {
    await new OpenCodeTool().loadConfig('fake', QINIU, { defaultModel: 'vision' });
    assert.deepEqual(json(file).provider.qiniu.models.vision.modalities, { input: ['text', 'image'], output: ['text'] });
  } finally { marketModelService.fetchModels = original; }
});

test('OpenCode: unloading preserves managed fields subsequently changed by the user', async () => {
  const file = freshConfig('user-edits', { model: 'original/model' });
  const tool = new OpenCodeTool();
  await tool.loadConfig('fake', QINIU, MODELS);
  const edited = json(file);
  edited.model = 'user/new-model';
  edited.provider.qiniu = { name: 'replacement', options: { baseURL: 'https://other.example/v1' } };
  write(file, JSON.stringify(edited));
  tool.unloadConfig();
  const result = json(file);
  assert.equal(result.model, 'user/new-model');
  assert.deepEqual(result.provider.qiniu, edited.provider.qiniu);
});

test('OpenCode: unload without restoration state does not delete a user-owned Qiniu provider', () => {
  const original = { model: 'qiniu/user-model', provider: { qiniu: { options: { baseURL: QINIU }, models: { custom: {} } } } };
  const file = freshConfig('unmanaged-qiniu', original);
  assert.throws(() => new OpenCodeTool().unloadConfig(), /No restoration record.*Configuration is unchanged/);
  assert.deepEqual(json(file), original);
});

test('OpenCode: nested custom Qiniu settings survive a load/unload cycle', async () => {
  const original = { provider: { qiniu: { options: { baseURL: QINIU }, models: { custom: {} } } } };
  const file = freshConfig('nested-user-edits', original);
  const tool = new OpenCodeTool();
  await tool.loadConfig('fake', QINIU, MODELS);
  const edited = json(file);
  edited.provider.qiniu.options.timeout = 12345;
  write(file, JSON.stringify(edited));
  tool.unloadConfig();
  assert.equal(json(file).provider.qiniu.options.timeout, 12345);
});

test('OpenCode: corrupt state blocks unloading without touching the client file', async () => {
  const file = freshConfig('state-corruption', { model: 'original' });
  const tool = new OpenCodeTool();
  await tool.loadConfig('fake', QINIU, MODELS);
  const before = fs.readFileSync(file, 'utf8');
  const stateFile = path.join(home, '.coding-helper', 'state.json');
  const state = fs.readFileSync(stateFile, 'utf8');
  write(stateFile, '{broken');
  try { assert.throws(() => tool.unloadConfig(), /Cannot parse/); }
  finally { write(stateFile, state); }
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('OpenCode: empty existing files and provider containers round trip', async () => {
  for (const [index, original] of [{}, { provider: {} }, { provider: { qiniu: {} } }, { model: 'x', provider: { qiniu: { models: { 'deepseek-v3': { custom: true } } } } }].entries()) {
    const file = freshConfig('roundtrip-' + index, original);
    const tool = new OpenCodeTool();
    await tool.loadConfig('fake', QINIU, MODELS);
    await tool.loadConfig('fake2', QINIU, { defaultModel: 'second-model' });
    tool.unloadConfig();
    assert.throws(() => tool.unloadConfig(), /No restoration record/);
    assert.deepEqual(json(file), original);
  }
});

test('OpenCode: failed state cleanup can be retried without removing restored provider', async () => {
  const original = { model: 'original', provider: { qiniu: { options: { baseURL: QINIU }, custom: true } } };
  const file = freshConfig('cleanup-retry', original);
  const tool = new OpenCodeTool();
  await tool.loadConfig('fake', QINIU, MODELS);
  const rename = fs.renameSync;
  fs.renameSync = (source, target) => {
    if (String(target).endsWith('state.json')) throw new Error('state unavailable');
    return rename(source, target);
  };
  try { assert.throws(() => tool.unloadConfig(), /state unavailable/); }
  finally { fs.renameSync = rename; }
  assert.deepEqual(json(file), original);
  tool.unloadConfig();
  assert.deepEqual(json(file), original);
  assert.equal(stateStore.getState('opencode', file), undefined);
});

test('OpenCode: reloading after a managed field edit refuses stale restoration priors', async () => {
  const file = freshConfig('reload-after-edit', { model: 'original' });
  const tool = new OpenCodeTool();
  await tool.loadConfig('fake', QINIU, MODELS);
  const modified = json(file);
  modified.model = 'user/new-model';
  write(file, JSON.stringify(modified));
  await assert.rejects(tool.loadConfig('fake', QINIU, MODELS), /changed|unload/i);
  assert.equal(json(file).model, 'user/new-model');
});

test('OpenCode: invalid provider shapes are not normalized destructively', async () => {
  for (const original of [{ provider: [] }, { provider: 'broken' }, { enabled_providers: 'qiniu' }]) {
    const file = freshConfig('invalid-' + typeof original.provider, original);
    await assert.rejects(new OpenCodeTool().loadConfig('fake', QINIU, MODELS), /Invalid/);
    assert.deepEqual(json(file), original);
  }
});

test('OpenCode: symlinked directory aliases share restoration state', async () => {
  const file = freshConfig('real-xdg', { model: 'original' });
  const tool = new OpenCodeTool();
  await tool.loadConfig('fake', QINIU, MODELS);
  const alias = path.join(home, 'xdg-alias');
  fs.symlinkSync(path.join(home, 'real-xdg'), alias, 'dir');
  process.env.XDG_CONFIG_HOME = alias;
  tool.unloadConfig();
  assert.equal(json(file).model, 'original');
});

test('OpenCode: overlapping loads cannot record each other as original configuration', async () => {
  const file = freshConfig('overlapping-loads', { model: 'original' });
  const fetch = marketModelService.fetchModels;
  let release;
  marketModelService.fetchModels = () => new Promise(resolve => { release = resolve; });
  const tool = new OpenCodeTool();
  const first = tool.loadConfig('fake', QINIU, MODELS);
  marketModelService.fetchModels = async () => [];
  try {
    await tool.loadConfig('fake', QINIU, { defaultModel: 'second' });
    release([]);
    await assert.rejects(first, /changed/);
    tool.unloadConfig();
    assert.equal(json(file).model, 'original');
  } finally { marketModelService.fetchModels = fetch; }
});

test('OpenCode: external edit at final write retains its pending restoration record', async () => {
  const file = freshConfig('last-write-race', { model: 'original' });
  const copy = fs.copyFileSync;
  fs.copyFileSync = (source, ...args) => {
    const result = copy(source, ...args);
    if (source === file) write(file, '{"model":"editor","mcp":{"new":{}}}');
    return result;
  };
  try { await assert.rejects(new OpenCodeTool().loadConfig('fake', QINIU, MODELS), /changed before writing/); }
  finally { fs.copyFileSync = copy; }
  assert.deepEqual(json(file), { model: 'editor', mcp: { new: {} } });
  assert.ok(stateStore.getState('opencode', file).pending);
});

test('OpenCode: dangling higher-precedence JSONC is rejected instead of writing JSON', async () => {
  const file = freshConfig('dangling-jsonc', { model: 'original' });
  fs.symlinkSync(path.join(home, 'absent-jsonc-target'), file + 'c');
  await assert.rejects(new OpenCodeTool().loadConfig('fake', QINIU, MODELS), /symbolic link/);
  assert.equal(json(file).model, 'original');
});

test('OpenCode: three-way restoration preserves an independent edit across varied originals', async () => {
  for (let i = 0; i < 25; i++) {
    const original = {
      ...(i % 2 ? { model: 'original-' + i } : {}),
      ...(i % 3 ? { $schema: 'https://opencode.ai/config.json' } : {}),
      provider: { other: { name: 'keep' }, ...(i % 4 ? { qiniu: { options: { timeout: i }, models: { existing: { name: 'keep' } } } } : {}) },
      mcp: { custom: { enabled: false } },
    };
    const file = freshConfig('matrix-' + i, original);
    const tool = new OpenCodeTool();
    await tool.loadConfig('fake', QINIU, MODELS);
    const changed = json(file);
    changed.permission = { edit: 'ask' };
    write(file, JSON.stringify(changed));
    tool.unloadConfig();
    assert.deepEqual(json(file), { ...original, permission: { edit: 'ask' } });
  }
});

test('OpenCode: the parsed object and guarded text come from the same read', async () => {
  const file = freshConfig('read-snapshot-race', { model: 'original' });
  const read = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = (target, ...args) => {
    const result = read(target, ...args);
    if (String(target) === file && ++reads === 3) write(file, '{"model":"edited","permission":{"edit":"deny"}}');
    return result;
  };
  try { await assert.rejects(new OpenCodeTool().loadConfig('fake', QINIU, MODELS), /changed/); }
  finally { fs.readFileSync = read; }
  assert.deepEqual(json(file), { model: 'edited', permission: { edit: 'deny' } });
});

test('OpenCode: unload does not overwrite an edit between parsing and snapshot capture', async () => {
  const file = freshConfig('unload-read-race', { model: 'original' });
  const tool = new OpenCodeTool();
  await tool.loadConfig('fake', QINIU, MODELS);
  const read = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = (target, ...args) => {
    const result = read(target, ...args);
    if (String(target) === file && ++reads === 1) write(file, '{"model":"edited","permission":{"edit":"deny"}}');
    return result;
  };
  try { assert.throws(() => tool.unloadConfig(), /changed/); }
  finally { fs.readFileSync = read; }
  assert.deepEqual(json(file), { model: 'edited', permission: { edit: 'deny' } });
});

test('OpenCode: model-level filters reject an unavailable selected model before writing', async () => {
  for (const [index, filter] of [{ whitelist: ['other'] }, { blacklist: ['deepseek-v3'] }].entries()) {
    for (const jsonc of [false, true]) {
      const original = { model: 'user/model', provider: { qiniu: filter } };
      const file = freshConfig('model-filter-' + index + jsonc, original);
      if (jsonc) write(file + 'c', '{}');
      const target = getOpenCodeConfigFile();
      const before = fs.readFileSync(target, 'utf8');
      await assert.rejects(new OpenCodeTool().loadConfig('fake', QINIU, MODELS), /model filters|whitelist|blacklist/);
      assert.equal(fs.readFileSync(target, 'utf8'), before);
      assert.equal(stateStore.getState('opencode', target), undefined);
    }
  }
});

test('OpenCode: new higher-priority JSONC does not hide the previously managed JSON on unload', async () => {
  const original = { model: 'user/original' };
  const file = freshConfig('precedence-switch', original);
  const tool = new OpenCodeTool();
  await tool.loadConfig('fake', QINIU, MODELS);
  const jsonc = '{"permission":{"edit":"ask"}}';
  write(file + 'c', jsonc);
  tool.unloadConfig();
  assert.deepEqual(json(file), original);
  assert.equal(fs.readFileSync(file + 'c', 'utf8'), jsonc);
  assert.equal(stateStore.getState('opencode', file), undefined);
});

test('OpenCode: target changes must not create two independent managed configurations', async () => {
  const file = freshConfig('double-managed', { model: 'original' });
  const tool = new OpenCodeTool();
  await tool.loadConfig('fake', QINIU, MODELS);
  write(file + 'c', '{}');
  await assert.rejects(tool.loadConfig('fake', QINIU, MODELS), /[Uu]nload|managed configuration/);
  assert.deepEqual(json(file + 'c'), {});
  assert.equal(stateStore.getState('opencode', file + 'c'), undefined);
});

test('OpenCode: higher-priority model filters can explicitly allow the selection', async () => {
  const file = freshConfig('allowed-model-filter', { provider: { qiniu: { whitelist: ['other'], blacklist: ['deepseek-v3'] } } });
  const original = { provider: { qiniu: { whitelist: ['deepseek-v3'], blacklist: [] } } };
  write(file + 'c', JSON.stringify(original));
  const tool = new OpenCodeTool();
  await tool.loadConfig('fake', QINIU, MODELS);
  assert.equal(json(file + 'c').model, 'qiniu/deepseek-v3');
  tool.unloadConfig();
  assert.deepEqual(json(file + 'c'), original);
});

test('OpenCode: removed managed JSONC clears only its own record on unload', async () => {
  const file = freshConfig('removed-managed-jsonc', { model: 'lower/original' });
  write(file + 'c', '{}');
  const tool = new OpenCodeTool();
  await tool.loadConfig('fake', QINIU, MODELS);
  fs.rmSync(file + 'c');
  tool.unloadConfig();
  assert.deepEqual(json(file), { model: 'lower/original' });
  assert.equal(fs.existsSync(file + 'c'), false);
  assert.equal(stateStore.getState('opencode', file + 'c'), undefined);
});

test('OpenCode: malformed model filters fail without normalizing user configuration', async () => {
  for (const [index, original] of [{ provider: { qiniu: { whitelist: 'deepseek-v3' } } }, { provider: { qiniu: { blacklist: [42] } } }].entries()) {
    const file = freshConfig('malformed-model-filter-' + index, original);
    await assert.rejects(new OpenCodeTool().loadConfig('fake', QINIU, MODELS), /Invalid/);
    assert.deepEqual(json(file), original);
  }
});

test('OpenCode: selected model overrides and nested limit fields survive loading', async () => {
  const selected = { name: 'custom', options: { reasoningEffort: 'high' }, headers: { 'X-Local': 'keep' }, variants: { custom: { temperature: 0.1 } }, limit: { context: 1024, input: 768, output: 256 }, reasoning: true };
  const original = { provider: { qiniu: { models: { 'deepseek-v3': selected } } } };
  const file = freshConfig('selected-overrides', original);
  const tool = new OpenCodeTool();
  await tool.loadConfig('fake', QINIU, MODELS);
  const model = json(file).provider.qiniu.models['deepseek-v3'];
  assert.deepEqual(model.options, selected.options);
  assert.deepEqual(model.headers, selected.headers);
  assert.deepEqual(model.variants, selected.variants);
  assert.deepEqual(model.limit, { context: 1024, input: 768, output: 256 });
  assert.equal(model.reasoning, true);
  tool.unloadConfig();
  assert.deepEqual(json(file), original);
});

test('OpenCode: reasoning metadata is written for true and false capabilities', async () => {
  const fetch = marketModelService.fetchModels;
  try {
    for (const reasoning of [true, false]) {
      const file = freshConfig('reasoning-' + reasoning);
      marketModelService.fetchModels = async () => [{ id: 'reasoner', features: [], model_constraints: { context_length: 32000, max_tokens: 4096 }, architecture: { input_modalities: ['text'], output_modalities: ['text'], function_calling: { supported: false }, reasoning: { supported: reasoning } } }];
      const tool = new OpenCodeTool();
      await tool.loadConfig('fake', QINIU, { defaultModel: 'reasoner' });
      assert.equal(json(file).provider.qiniu.models.reasoner.reasoning, reasoning);
      tool.unloadConfig();
      assert.deepEqual(json(file), {});
    }
  } finally { marketModelService.fetchModels = fetch; }
});

test('OpenCode: config.json filters apply before both target formats', async () => {
  const filters = [{ disabled_providers: ['qiniu'] }, { enabled_providers: ['anthropic'] }, { provider: { qiniu: { whitelist: ['other'] } } }, { provider: { qiniu: { blacklist: ['deepseek-v3'] } } }];
  for (const [i, filter] of filters.entries()) {
    for (const jsonc of [false, true]) {
      const file = freshConfig('legacy-filter-' + i + jsonc);
      const lower = path.join(path.dirname(file), 'config.json');
      write(lower, JSON.stringify(filter));
      if (jsonc) write(file + 'c', '{}');
      const target = getOpenCodeConfigFile();
      await assert.rejects(new OpenCodeTool().loadConfig('fake', QINIU, MODELS), /filters exclude/);
      assert.deepEqual(json(target), {});
      assert.deepEqual(json(lower), filter);
      assert.equal(stateStore.getState('opencode', target), undefined);
    }
  }
});

test('OpenCode: higher global layers override legacy provider and model filters', async () => {
  const original = { disabled_providers: [], enabled_providers: ['qiniu'], provider: { qiniu: { whitelist: ['deepseek-v3'], blacklist: [] } } };
  const file = freshConfig('legacy-filter-override', original);
  const lower = path.join(path.dirname(file), 'config.json');
  const blocked = { disabled_providers: ['qiniu'], enabled_providers: ['other'], provider: { qiniu: { whitelist: ['other'], blacklist: ['deepseek-v3'] } } };
  write(lower, JSON.stringify(blocked));
  write(file + 'c', '{}');
  const tool = new OpenCodeTool();
  await tool.loadConfig('fake', QINIU, MODELS);
  assert.equal(json(file + 'c').model, 'qiniu/deepseek-v3');
  tool.unloadConfig();
  assert.deepEqual(json(file), original);
  assert.deepEqual(json(lower), blocked);
});

test('OpenCode: rejects changed or malformed legacy config without writing', async () => {
  const fetch = marketModelService.fetchModels;
  const file = freshConfig('legacy-race');
  const lower = path.join(path.dirname(file), 'config.json');
  try {
    marketModelService.fetchModels = async () => { write(lower, '{"disabled_providers":["qiniu"]}'); return []; };
    await assert.rejects(new OpenCodeTool().loadConfig('fake', QINIU, MODELS), /changed/);
    assert.deepEqual(json(file), {});
    write(lower, '{broken');
    await assert.rejects(new OpenCodeTool().loadConfig('fake', QINIU, MODELS), /Cannot parse/);
    assert.deepEqual(json(file), {});
  } finally { marketModelService.fetchModels = fetch; }
});

test('OpenCode: an existing empty symlinked configuration directory survives unload and reload', async () => {
  const file = freshConfig('empty-directory-alias');
  fs.rmSync(file);
  const originalDir = path.dirname(file);
  const aliasRoot = path.join(home, 'empty-directory-alias-root');
  fs.mkdirSync(aliasRoot);
  fs.symlinkSync(originalDir, path.join(aliasRoot, 'opencode'), process.platform === 'win32' ? 'junction' : 'dir');
  process.env.XDG_CONFIG_HOME = aliasRoot;
  const tool = new OpenCodeTool();
  for (let i = 0; i < 2; i++) {
    await tool.loadConfig('fake', QINIU, MODELS);
    tool.unloadConfig();
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.statSync(originalDir).isDirectory(), true);
    assert.equal(fs.statSync(path.join(aliasRoot, 'opencode')).isDirectory(), true);
  }
});

async function crashLoad(file, point) {
  const { spawnSync } = await import('node:child_process');
  const source = [
    "import fs from 'node:fs';",
    'const { OpenCodeTool } = await import(' + JSON.stringify(new URL('../dist/lib/tools/opencode-tool.js', import.meta.url).href) + ');',
    'const { marketModelService } = await import(' + JSON.stringify(new URL('../dist/lib/market-model-service.js', import.meta.url).href) + ');',
    "marketModelService.fetchModels = async () => [];",
    'const file = ' + JSON.stringify(file) + ';',
    'const point = ' + JSON.stringify(point) + ';',
    'const rename = fs.renameSync;',
    "fs.renameSync = (from, to) => { if (String(to) === file && point === 'before') process.exit(86); const result = rename(from, to); if (String(to) === file && point === 'after') process.exit(86); return result; };",
    "await new OpenCodeTool().loadConfig('fake-next-key', 'https://api.qnaigc.com', { defaultModel: 'next-model' });",
  ].join('\n');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { env: { ...process.env }, encoding: 'utf8' });
  assert.equal(result.status, 86, result.stderr);
  const lock = path.join(home, '.coding-helper', 'state.lock');
  assert.equal(fs.existsSync(lock), true);
  // The child has exited; simulate the documented stale-lock recovery.
  fs.rmSync(lock);
}

test('OpenCode: process interruption before and after rename retains restorable committed state', async () => {
  for (const reload of [false, true]) {
    for (const point of ['before', 'after']) {
      const original = { model: 'user/original', provider: { qiniu: { options: { timeout: 123 } } } };
      const file = freshConfig('crash-' + reload + point, original);
      const tool = new OpenCodeTool();
      if (reload) await tool.loadConfig('fake-first-key', QINIU, MODELS);
      const committed = stateStore.getState('opencode', file)?.applied;
      await crashLoad(file, point);
      const pending = stateStore.getState('opencode', file);
      assert.deepEqual(pending.applied, committed);
      assert.ok(pending.pending);
      tool.unloadConfig();
      assert.deepEqual(json(file), original);
      assert.equal(stateStore.getState('opencode', file), undefined);
      await tool.loadConfig('fake-retry', QINIU, MODELS);
      tool.unloadConfig();
      assert.deepEqual(json(file), original);
    }
  }
});

test('OpenCode: interrupted initial write to a missing file can safely unload', async () => {
  for (const point of ['before', 'after']) {
    const file = freshConfig('crash-missing-' + point);
    fs.rmSync(file);
    await crashLoad(file, point);
    new OpenCodeTool().unloadConfig();
    assert.equal(fs.existsSync(file), false);
    assert.equal(stateStore.getState('opencode', file), undefined);
  }
});

test('OpenCode: ambiguous interrupted writes retain the file and restoration journal', async () => {
  const file = freshConfig('crash-user-edit', { model: 'original' });
  const tool = new OpenCodeTool();
  await tool.loadConfig('fake-first', QINIU, MODELS);
  await crashLoad(file, 'after');
  const saved = stateStore.getState('opencode', file);
  const edited = { ...json(file), permission: { edit: 'ask' } };
  write(file, JSON.stringify(edited));
  assert.throws(() => tool.unloadConfig(), /journal retained/);
  await assert.rejects(tool.loadConfig('fake', QINIU, MODELS), /journal retained/);
  assert.deepEqual(json(file), edited);
  assert.deepEqual(stateStore.getState('opencode', file), saved);
});

test('OpenCode: failed final state commit remains recoverable on retry', async () => {
  const original = { model: 'original' };
  const file = freshConfig('final-state-failure', original);
  const tool = new OpenCodeTool();
  await tool.loadConfig('fake-first', QINIU, MODELS);
  const setState = stateStore.setState.bind(stateStore);
  stateStore.setState = (name, value, target) => {
    if (name === 'opencode' && value && !value.pending) throw new Error('final commit unavailable');
    return setState(name, value, target);
  };
  try { await assert.rejects(tool.loadConfig('fake-next', QINIU, { defaultModel: 'second' }), /final commit unavailable/); }
  finally { stateStore.setState = setState; }
  assert.ok(stateStore.getState('opencode', file).pending);
  assert.equal(json(file).model, 'qiniu/second');
  await tool.loadConfig('fake-retry', QINIU, { defaultModel: 'third' });
  assert.equal(stateStore.getState('opencode', file).pending, undefined);
  tool.unloadConfig();
  assert.deepEqual(json(file), original);
});

test('OpenCode: an error after client rename does not discard the applied journal', async () => {
  const original = { model: 'original' };
  const file = freshConfig('post-rename-error', original);
  const tool = new OpenCodeTool();
  await tool.loadConfig('fake-first', QINIU, MODELS);
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    const result = rename(from, to);
    if (String(to) === file) throw new Error('post-rename cleanup failed');
    return result;
  };
  try { await assert.rejects(tool.loadConfig('fake-next', QINIU, { defaultModel: 'second' }), /post-rename/); }
  finally { fs.renameSync = rename; }
  assert.ok(stateStore.getState('opencode', file).pending);
  tool.unloadConfig();
  assert.deepEqual(json(file), original);
});

for(const [label,selected] of [['wire-id',{id:'old-model'}],['sdk',{provider:{npm:'@ai-sdk/anthropic'}}],['deprecated',{status:'deprecated'}]]){
  for(const inherited of [false,true])test('OpenCode: refuses '+label+' route '+(inherited?'inherited from lower config':'in target'),async()=>{
    const original={provider:{qiniu:{models:{'deepseek-v3':selected}}}};const file=freshConfig(label+'-'+inherited,inherited?{provider:{qiniu:{models:{'deepseek-v3':{name:'selected'}}}}}:original);
    const lower=path.join(path.dirname(file),'config.json');if(inherited)write(lower,JSON.stringify(original));const before=fs.readFileSync(file,'utf8');
    await assert.rejects(new OpenCodeTool().loadConfig('fake',QINIU,MODELS),/conflicting|deprecated/);assert.equal(fs.readFileSync(file,'utf8'),before);assert.equal(stateStore.getState('opencode',file),undefined);
  });
}
test('OpenCode: ambiguous post-rename edits preserve the pending journal',async()=>{
  const file=freshConfig('ambiguous-postrename',{model:'original'});const rename=fs.renameSync;let once=true;
  fs.renameSync=(from,to)=>{const result=rename(from,to);if(to===file&&once){once=false;const current=json(file);current.theme='edited';write(file,JSON.stringify(current));throw Error('post rename failure');}return result;};
  try{await assert.rejects(new OpenCodeTool().loadConfig('fake',QINIU,MODELS),/post rename failure/);}finally{fs.renameSync=rename;}
  assert.ok(stateStore.getState('opencode',file).pending);assert.equal(json(file).theme,'edited');assert.throws(()=>new OpenCodeTool().unloadConfig(),/journal retained/);
});

test('OpenCode: unmanaged global JSON, JSONC and legacy files produce recovery errors', () => {
  for(const name of ['opencode.json','opencode.jsonc','config.json']) {
    const file=freshConfig('unmanaged-global-'+name);fs.rmSync(file);
    const target=path.join(path.dirname(file),name);const content='{ "provider": { "qiniu": { "options": { "apiKey": "legacy" } } } }';write(target,content);
    assert.throws(()=>new OpenCodeTool().unloadConfig(),/No restoration record.*Configuration is unchanged/);
    assert.equal(fs.readFileSync(target,'utf8'),content);
  }
  const file=freshConfig('unmanaged-missing');fs.rmSync(file);
  assert.doesNotThrow(()=>new OpenCodeTool().unloadConfig());
});
test('OpenCode: menu reports unchanged legacy credentials without success', async () => {
  const file=freshConfig('unmanaged-menu',{provider:{qiniu:{options:{apiKey:'legacy'}}}});const before=fs.readFileSync(file,'utf8');
  const {unloadToolConfig}=await import('../dist/lib/wizard/menus/tool-menu.js');const {promptHelper}=await import('../dist/lib/wizard/ui/prompt-helper.js');const {uiRenderer}=await import('../dist/lib/wizard/ui/ui-renderer.js');
  const oldConfirm=promptHelper.confirm,oldEnter=promptHelper.pressEnter;const names=['renderHeader','renderSuccess','renderError'];const old=Object.fromEntries(names.map(n=>[n,uiRenderer[n]]));const messages=[];
  for(const n of names)uiRenderer[n]=(...args)=>messages.push([n,...args]);promptHelper.confirm=async()=>true;promptHelper.pressEnter=async()=>{};
  try {await unloadToolConfig(new OpenCodeTool());assert.equal(messages.some(([kind])=>kind==='renderSuccess'),false);assert.ok(messages.some(([kind,text])=>kind==='renderError'&&text.includes('Configuration is unchanged')));assert.equal(fs.readFileSync(file,'utf8'),before);}
  finally{Object.assign(uiRenderer,old);promptHelper.confirm=oldConfirm;promptHelper.pressEnter=oldEnter;}
});
