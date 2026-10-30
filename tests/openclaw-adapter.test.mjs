import test from 'node:test';
import JSON5 from 'json5';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-openclaw-')));
process.env.HOME = process.env.USERPROFILE = home;
for (const key of ['OPENCLAW_CONFIG_PATH', 'OPENCLAW_STATE_DIR', 'OPENCLAW_PROFILE', 'OPENCLAW_HOME', 'OPENCLAW_CONFIG_READONLY', 'OPENCLAW_NIX_MODE']) delete process.env[key];
delete process.env.KIMI_CODE_HOME; delete process.env.GROK_HOME;
const { OpenClawTool, getOpenClawConfigFile } = await import('../dist/lib/tools/openclaw-tool.js');
const { stateStore } = await import('../dist/lib/core/state-store.js');
test('OpenClaw updates use the official lifecycle command',()=>{assert.equal(new OpenClawTool().updateCommand,'openclaw update');});
const { marketModelService } = await import('../dist/lib/market-model-service.js');
const { toolManager } = await import('../dist/lib/tool-manager.js');
const { hasSavedToolModelConfig } = await import('../dist/lib/wizard/menus/tool-menu.js');
const tool = new OpenClawTool(); tool.getVersion = () => null;
marketModelService.fetchModels = async () => [];
const files = [".openclaw/openclaw.json"].map(file => path.join(home, file));
const originals = ["{ \"agents\": {\"defaults\":{\"model\":{\"primary\":\"original\"}}}, \"custom\":true }"];
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
const read = file => fs.readFileSync(file, 'utf8');
const load = (key = 'test-key') => tool.loadConfig(key, 'https://api.qnaigc.com', { toolModels: { [tool.name]: 'test/model' } });
test('OpenClaw explicit API authentication and offline limits remain authoritative',async()=>{
 const {applyOpenClawConfig}=await import('../dist/lib/tools/openclaw-tool.js');
 const next=applyOpenClawConfig({models:{providers:{qiniu:{models:[{id:'test/model',contextWindow:8192,maxTokens:1024}]}}}},'https://api.qnaigc.com','new','test/model',{contextWindow:128000,maxOutputTokens:8192,verified:false});
 assert.equal(next.models.providers.qiniu.auth,'api-key');assert.equal(next.models.providers.qiniu.models[0].contextWindow,8192);assert.equal(next.models.providers.qiniu.models[0].maxTokens,1024);
});
test('OpenClaw scans current roster, effective HOME and profile-specific caches',async()=>{
 const customHome=path.join(home,'claw-home');process.env.OPENCLAW_HOME=customHome;process.env.OPENCLAW_PROFILE='work';process.env.OPENCLAW_CONFIG_PATH=path.join(home,'outside','root.json');
 const root=getOpenClawConfigFile();const cached='{ "providers": { "qiniu": { "apiKey": "old" } } }';
 try{for(const [config,cache] of [[{agents:{entries:{one:{agentDir:'~/custom-agent'}}}},path.join(customHome,'custom-agent','models.json')],[{},path.join(customHome,'.openclaw-work','agents','main','agent','models.json')]]){
   write(root,JSON.stringify(config));await load();write(cache,cached);await assert.rejects(load(),/persisted Qiniu provider/);assert.throws(()=>tool.unloadConfig(),/persisted Qiniu provider/);assert.equal(read(cache),cached);fs.rmSync(cache);tool.unloadConfig();assert.equal(read(root),JSON.stringify(config));
 }}finally{for(const key of ['OPENCLAW_HOME','OPENCLAW_PROFILE','OPENCLAW_CONFIG_PATH'])delete process.env[key];}
});
test('OpenClaw preserves provider rows, capabilities and empty unrestricted map',async()=>{
 const {applyOpenClawConfig}=await import('../dist/lib/tools/openclaw-tool.js');
 const original={models:{providers:{qiniu:{headers:{'X-Local':'keep'},models:[{id:'old',name:'Keep'},{id:'vision',compat:{custom:true}}]}}},agents:{defaults:{models:{}}}};
 const next=applyOpenClawConfig(original,'https://api.qnaigc.com','key','vision',{contextWindow:32000,maxOutputTokens:4000,reasoning:true,modalities:{input:['text','image'],output:['text']}});
 assert.deepEqual(next.agents.defaults.models,{});assert.deepEqual(next.models.providers.qiniu.headers,{'X-Local':'keep'});assert.deepEqual(next.models.providers.qiniu.models[0],{id:'old',name:'Keep'});
 const selected=next.models.providers.qiniu.models[1];assert.equal(selected.reasoning,true);assert.deepEqual(selected.input,['text','image']);assert.deepEqual(selected.compat,{custom:true});
 assert.throws(()=>applyOpenClawConfig({agents:{defaults:{$include:'policy.json'}}},'https://api.qnaigc.com','key','x'),/included configuration/);
});
test('OpenClaw blocks persisted agent credentials on reload and unload until explicit recovery',async()=>{
 const file=files[0],cache=path.join(home,'.openclaw','agents','main','agent','models.json');write(file,'{}');await load();const loaded=read(file);
 write(cache,'{"providers":{"qiniu":{"apiKey":"old-key","baseUrl":"https://old.test"}}}');
 try{await assert.rejects(load('new-key'),/persisted Qiniu provider/);assert.throws(()=>tool.unloadConfig(),/persisted Qiniu provider/);assert.equal(read(file),loaded);assert.match(read(cache),/old-key/);}
 finally{fs.rmSync(cache,{force:true});}
 tool.unloadConfig();assert.equal(read(file),'{}');
});
test('OpenClaw reserved default profile is case insensitive',()=>{
 try{for(const value of ['default','DEFAULT',' Default ']){process.env.OPENCLAW_PROFILE=value;assert.equal(getOpenClawConfigFile(),files[0]);}}finally{delete process.env.OPENCLAW_PROFILE;}
});
test('openclaw is registered and recognizes saved generic model selection', () => {
  assert.ok(toolManager.get(tool.name));
  assert.equal(hasSavedToolModelConfig(tool, { toolModels: { [tool.name]: 'test/model' } }), true);
});
test('openclaw restores bytes and refuses corrupt or changed config', async () => {
  files.forEach((file, i) => write(file, originals[i]));
  await load(); await load('second-key');
  assert.equal(JSON.parse(read(files[0])).agents.defaults.model.primary, 'qiniu/test/model');
  await tool.unloadConfig(); files.forEach((file, i) => assert.equal(read(file), originals[i]));
  write(files[0], "{ custom: }");
  await assert.rejects(load()); assert.equal(read(files[0]), "{ custom: }");
  write(files[0], originals[0]); await load();
  const applied = read(files[0]); write(files[0], applied + ' ');
  await assert.rejects(load(), /changed/); assert.throws(() => tool.unloadConfig(), /changed/);
  assert.equal(read(files[0]), applied + ' '); write(files[0], applied);
  await tool.unloadConfig();
  files.forEach(file => fs.rmSync(file));
  await load(); await tool.unloadConfig(); files.forEach(file => assert.equal(fs.existsSync(file), false));
});


test('OpenClaw respects explicit paths and never silently edits the default for a profile', async () => {
  const keys = ['OPENCLAW_CONFIG_PATH', 'OPENCLAW_STATE_DIR', 'OPENCLAW_PROFILE', 'OPENCLAW_HOME'];
  try {
    process.env.OPENCLAW_STATE_DIR = '~/alternate';
    assert.equal(getOpenClawConfigFile(), path.join(home, 'alternate/openclaw.json'));
    process.env.OPENCLAW_CONFIG_PATH = '~/custom/settings.json';
    const file = getOpenClawConfigFile(); assert.equal(file, path.join(home, 'custom/settings.json'));
    write(file, '{}'); await load(); await tool.unloadConfig(); assert.equal(read(file), '{}');
    delete process.env.OPENCLAW_CONFIG_PATH; delete process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_PROFILE = 'work'; assert.throws(() => getOpenClawConfigFile(), /named OpenClaw profile/);
    delete process.env.OPENCLAW_PROFILE; process.env.OPENCLAW_HOME = path.join(home, 'other-home');
    assert.equal(getOpenClawConfigFile(), path.join(home, 'other-home/.openclaw/openclaw.json'));
  } finally { for (const key of keys) delete process.env[key]; }
});

for (const selector of ['OPENCLAW_CONFIG_PATH', 'OPENCLAW_STATE_DIR', 'OPENCLAW_HOME']) {
  test('OpenClaw rejects a changed ' + selector + ' until its recorded target is unloaded', async () => {
    const first = path.join(home, selector, 'first'), second = path.join(home, selector, 'second');
    const value = dir => selector === 'OPENCLAW_CONFIG_PATH' ? path.join(dir, 'config.json') : dir;
    try {
      process.env[selector] = value(first); const originalFile = getOpenClawConfigFile();
      write(originalFile, '{"original":true}'); await load();
      const applied = read(originalFile), journal = stateStore.getFileStates(tool.name);
      process.env[selector] = value(second); const nextFile = getOpenClawConfigFile();
      assert.throws(() => tool.unloadConfig(), /OpenClaw configuration path changed/);
      await assert.rejects(load('next-key'), /OpenClaw configuration path changed/);
      assert.equal(fs.existsSync(nextFile), false); assert.equal(read(originalFile), applied);
      assert.deepEqual(stateStore.getFileStates(tool.name), journal);
      write(nextFile, '{"personal":true}');
      assert.throws(() => tool.unloadConfig(), /OpenClaw configuration path changed/);
      await assert.rejects(load(), /OpenClaw configuration path changed/);
      assert.equal(read(nextFile), '{"personal":true}'); assert.equal(read(originalFile), applied);
      process.env[selector] = value(first); tool.unloadConfig(); assert.equal(read(originalFile), '{"original":true}');
      process.env[selector] = value(second); await load(); tool.unloadConfig(); assert.equal(read(nextFile), '{"personal":true}');
    } finally {
      process.env[selector] = value(first);
      if (stateStore.getState(tool.name, getOpenClawConfigFile())) tool.unloadConfig();
      delete process.env[selector];
    }
  });
}

test('OpenClaw unset override reports recovery through the menu without claiming removal', async () => {
  const {unloadToolConfig}=await import('../dist/lib/wizard/menus/tool-menu.js');
  const {promptHelper}=await import('../dist/lib/wizard/ui/prompt-helper.js');
  const {uiRenderer}=await import('../dist/lib/wizard/ui/ui-renderer.js');
  const {i18n}=await import('../dist/lib/i18n.js');i18n.init('en_US');
  const file=path.join(home,'unset-override.json');fs.rmSync(files[0],{force:true});
  process.env.OPENCLAW_CONFIG_PATH=file;await load();const applied=read(file);
  delete process.env.OPENCLAW_CONFIG_PATH;
  const confirm=promptHelper.confirm,enter=promptHelper.pressEnter;
  const methods=['renderHeader','renderSuccess','renderError'],old=Object.fromEntries(methods.map(name=>[name,uiRenderer[name]])),messages=[];
  for(const name of methods)uiRenderer[name]=(...args)=>messages.push([name,...args]);
  promptHelper.confirm=async()=>true;promptHelper.pressEnter=async()=>{};
  try {
    await unloadToolConfig(tool);
    assert.ok(messages.some(([kind,text])=>kind==='renderError'&&text.includes('OpenClaw configuration path changed')));
    assert.equal(messages.some(([kind])=>kind==='renderSuccess'),false);assert.equal(read(file),applied);
    assert.equal(fs.existsSync(files[0]),false);assert.equal(stateStore.getFileStates(tool.name).length,1);
  } finally {
    Object.assign(uiRenderer,old);promptHelper.confirm=confirm;promptHelper.pressEnter=enter;
    process.env.OPENCLAW_CONFIG_PATH=file;tool.unloadConfig();delete process.env.OPENCLAW_CONFIG_PATH;
  }
  assert.equal(fs.existsSync(file),false);
});

test('OpenClaw accepts a parent directory alias for the same recorded config', async () => {
  const real=path.join(home,'canonical-claw'),alias=path.join(home,'alias-claw');
  fs.mkdirSync(real,{recursive:true});fs.symlinkSync(real,alias,'dir');
  try {
    process.env.OPENCLAW_CONFIG_PATH=path.join(alias,'config.json');await load();
    process.env.OPENCLAW_CONFIG_PATH=path.join(real,'config.json');await load('next-key');tool.unloadConfig();
    assert.equal(fs.existsSync(path.join(real,'config.json')),false);assert.equal(stateStore.getFileStates(tool.name).length,0);
  } finally {delete process.env.OPENCLAW_CONFIG_PATH;fs.rmSync(alias);}
});

test('OpenClaw expands home override tilde against real user home before dependent paths',async()=>{
 const keys=['OPENCLAW_HOME','OPENCLAW_STATE_DIR','OPENCLAW_CONFIG_PATH'];
 try{
  for(const value of ['~','~/custom-home']){
   process.env.OPENCLAW_HOME=value;const effective=value==='~'?home:path.join(home,'custom-home');const expected=path.join(effective,'.openclaw/openclaw.json');assert.equal(getOpenClawConfigFile(),expected);
   write(expected,'{"original":true}');await load();assert.equal(JSON.parse(read(expected)).agents.defaults.model.primary,'qiniu/test/model');await tool.unloadConfig();assert.equal(read(expected),'{"original":true}');
   process.env.OPENCLAW_STATE_DIR='~/state';assert.equal(getOpenClawConfigFile(),path.join(effective,'state/openclaw.json'));
   process.env.OPENCLAW_CONFIG_PATH='~/chosen.json';assert.equal(getOpenClawConfigFile(),path.join(effective,'chosen.json'));delete process.env.OPENCLAW_STATE_DIR;delete process.env.OPENCLAW_CONFIG_PATH;
  }
 }finally{for(const key of keys)delete process.env[key];}
});

test('unload without a restoration record preserves every existing target and reports recovery guidance', () => {
  files.forEach(file => fs.rmSync(file, {force:true}));
  assert.doesNotThrow(() => tool.unloadConfig());
  for (const file of files) {
    write(file, 'legacy credential bytes');
    assert.throws(() => tool.unloadConfig(), /No restoration record.*Configuration is unchanged.*manually/);
    assert.equal(read(file), 'legacy credential bytes');
    fs.rmSync(file);
  }
});

for (const flag of ['OPENCLAW_CONFIG_READONLY', 'OPENCLAW_NIX_MODE']) {
  test('OpenClaw respects immutable configuration: ' + flag, async () => {
    const { stateStore } = await import('../dist/lib/core/state-store.js');
    const file = files[0]; write(file, originals[0]); await load();
    const applied = read(file), saved = stateStore.getState(tool.name, file);
    const fetch = marketModelService.fetchModels; let requests = 0;
    marketModelService.fetchModels = async () => { requests++; return []; };
    process.env.OPENCLAW_CONFIG_READONLY = '0'; process.env[flag] = '1';
    try {
      assert.ok(tool.getConfig().models);
      await assert.rejects(load(), /externally managed and read-only/);
      assert.throws(() => tool.unloadConfig(), /externally managed and read-only/);
      assert.equal(requests, 0); assert.equal(read(file), applied);
      assert.deepEqual(stateStore.getState(tool.name, file), saved);
    } finally {
      delete process.env.OPENCLAW_CONFIG_READONLY; delete process.env.OPENCLAW_NIX_MODE;
      marketModelService.fetchModels = fetch;
    }
    tool.unloadConfig(); assert.equal(read(file), originals[0]);
    process.env[flag] = '0';
    try { await load(); tool.unloadConfig(); assert.equal(read(file), originals[0]); }
    finally { delete process.env[flag]; }
  });
}

test('OpenClaw rechecks immutable mode after asynchronous metadata lookup', async () => {
  const file = files[0]; write(file, originals[0]);
  const fetch = marketModelService.fetchModels;
  marketModelService.fetchModels = async () => { process.env.OPENCLAW_CONFIG_READONLY = '1'; return []; };
  try { await assert.rejects(load(), /externally managed and read-only/); assert.equal(read(file), originals[0]); }
  finally { delete process.env.OPENCLAW_CONFIG_READONLY; marketModelService.fetchModels = fetch; }
});

 test('OpenClaw loads JSON5 and restores comments and formatting byte-for-byte', async () => {
  const original = "{\r\n // user's comment\r\n custom: 'keep', models: { providers: { other: { apiKey: 'user-key', }, }, },\r\n values: [0x10, .5, +1, Infinity, -Infinity, NaN,],\r\n}\r\n";
  const file = files[0]; write(file, original);
  assert.equal(tool.getConfig().custom, 'keep');
  await load(); await load('next-key');
  const applied = JSON5.parse(read(file));
  assert.equal(applied.models.providers.qiniu.apiKey, 'next-key');
  assert.deepEqual(applied.models.providers.other, { apiKey: 'user-key' });
  assert.deepEqual(applied.values, [16, 0.5, 1, Infinity, -Infinity, NaN]);
  assert.equal(tool.isConfigured(), true);
  tool.unloadConfig(); assert.equal(read(file), original);
 });

for (const invalid of ['{ foo: }', '[]', 'null', '', '// comment only']) {
 test('OpenClaw rejects invalid JSON5 or non-object without changing state: ' + invalid, async () => {
  const { stateStore } = await import('../dist/lib/core/state-store.js');
  const file = files[0]; write(file, invalid); const prior = stateStore.getState(tool.name,file);
  await assert.rejects(load(), /Cannot parse/); assert.equal(read(file), invalid);
  assert.deepEqual(stateStore.getState(tool.name,file), prior);
 });
}

for (const selection of ['openai/gpt-4.1', { primary: 'openai/gpt-4.1', fallbacks: ['anthropic/claude-sonnet-4'] }]) {
 test('OpenClaw accepts and restores model selection ' + JSON.stringify(selection), async () => {
  const original = JSON.stringify({agents:{defaults:{model:selection}}});
  const file=files[0];write(file,original);await load();await load('next-key');
  const selected=tool.getConfig().agents.defaults.model;assert.equal(selected.primary,'qiniu/test/model');
  if (typeof selection==='object') assert.deepEqual(selected.fallbacks,selection.fallbacks);
  tool.unloadConfig();assert.equal(read(file),original);
 });
}
for(const selection of [null, 42, []]) {
 test('OpenClaw rejects invalid model selection '+JSON.stringify(selection), async()=>{
  const original=JSON.stringify({agents:{defaults:{model:selection}}});write(files[0],original);
  await assert.rejects(load(),/Invalid OpenClaw model/);assert.equal(read(files[0]),original);
 });
}

for (const allow of [undefined, [], ['other/model'], ['qiniu/*'], ['qiniu/test/*'], ['qiniu/test/model']]) {
 test('OpenClaw preserves policy and allows selected model: '+JSON.stringify(allow), async()=>{
  const models={'other/model':{alias:'Other'},'qiniu/test/model':{alias:'Keep',params:{temperature:0.2}},'qiniu/old':{alias:'Old'}};
  const original=JSON.stringify({agents:{defaults:{models,modelPolicy:{...(allow===undefined?{}:{allow})}}}});
  write(files[0],original);await load();await load();const defaults=tool.getConfig().agents.defaults;
  const expected=allow?.length===1 && allow[0]==='other/model'?[...allow,'qiniu/test/model']:allow;
  assert.deepEqual(defaults.modelPolicy.allow,expected);assert.deepEqual(defaults.models,models);
  tool.unloadConfig();assert.equal(read(files[0]),original);
 });
}
for (const policy of [null, {allow:'other/model'}, {allow:[42]}]) {
 test('OpenClaw rejects malformed model policy '+JSON.stringify(policy),async()=>{
  const original=JSON.stringify({agents:{defaults:{modelPolicy:policy}}});write(files[0],original);
  await assert.rejects(load(),/Invalid OpenClaw/);assert.equal(read(files[0]),original);
 });
}
