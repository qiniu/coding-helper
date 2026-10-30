import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-qwen-code-')));
process.env.HOME = process.env.USERPROFILE = home;
delete process.env.QWEN_HOME;
delete process.env.KIMI_CODE_HOME; delete process.env.GROK_HOME;
const { QwenCodeTool } = await import('../dist/lib/tools/qwen-code-tool.js');
const { stateStore } = await import('../dist/lib/core/state-store.js');
const { marketModelService } = await import('../dist/lib/market-model-service.js');
const { toolManager } = await import('../dist/lib/tool-manager.js');
const { hasSavedToolModelConfig } = await import('../dist/lib/wizard/menus/tool-menu.js');
const tool = new QwenCodeTool(); tool.getVersion = () => null;
marketModelService.fetchModels = async () => [];
const files = [".qwen/settings.json", ".qwen/.env"].map(file => path.join(home, file));
const originals = ["{ \"model\": {\"name\":\"original\"}, \"custom\":true }", "OTHER=yes\nQINIU_API_KEY=original\n"];
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
const read = file => fs.readFileSync(file, 'utf8');
const load = (key = 'test-key') => tool.loadConfig(key, 'https://api.qnaigc.com', { toolModels: { [tool.name]: 'test/model' } });
test('Qwen retains a same-ID foreign endpoint and selects the Qiniu route',async()=>{
 const foreign={id:'test/model',baseUrl:'https://other.test/v1',envKey:'OTHER_KEY'};
 const original=JSON.stringify({modelProviders:{openai:[foreign]},model:{name:'test/model',baseUrl:foreign.baseUrl}});
 write(files[0],original);write(files[1],'OTHER_KEY=keep\n');
 await load();const config=JSON.parse(read(files[0]));assert.deepEqual(config.modelProviders.openai[0],foreign);assert.equal(config.modelProviders.openai.length,2);assert.equal(config.model.baseUrl,'https://api.qnaigc.com/v1');
 await tool.unloadConfig();assert.equal(read(files[0]),original);assert.equal(read(files[1]),'OTHER_KEY=keep\n');
});
test('Qwen bootstraps home from user dotenv and normalizes tilde separators',async()=>{
 const legacy=path.join(home,'.qwen','.env'),fallback=path.join(home,'.env');
 fs.mkdirSync(path.dirname(legacy),{recursive:true});
 for(const [source,value,expected] of [[legacy,'~\\parent\\child',path.join(home,'parent','child')],[fallback,'~/fallback',path.join(home,'fallback')]]){
  fs.rmSync(legacy,{force:true});fs.rmSync(fallback,{force:true});delete process.env.QWEN_HOME;
  write(source,'QWEN_HOME='+value+'\n');
  await load();assert.equal(fs.existsSync(path.join(expected,'settings.json')),true);assert.match(read(path.join(expected,'.env')),/QINIU_API_KEY=test-key/);
  await tool.unloadConfig();assert.equal(fs.existsSync(path.join(expected,'settings.json')),false);assert.equal(read(source),'QWEN_HOME='+value+'\n');
 }
 fs.rmSync(legacy,{force:true});fs.rmSync(fallback,{force:true});
});
test('qwen-code is registered and recognizes saved generic model selection', () => {
  assert.ok(toolManager.get(tool.name));
  assert.equal(hasSavedToolModelConfig(tool, { toolModels: { [tool.name]: 'test/model' } }), true);
});
test('qwen-code restores bytes and refuses corrupt or changed config', async () => {
  files.forEach((file, i) => write(file, originals[i]));
  await load(); await load('second-key');
  assert.equal(read(files[0]).includes('second-key'), false); assert.match(read(files[1]), /QINIU_API_KEY=second-key/);
  await tool.unloadConfig(); files.forEach((file, i) => assert.equal(read(file), originals[i]));
  write(files[0], "{broken");
  await assert.rejects(load()); assert.equal(read(files[0]), "{broken");
  write(files[0], originals[0]); await load();
  const applied = read(files[0]); write(files[0], applied + ' ');
  await assert.rejects(load(), /changed/); assert.throws(() => tool.unloadConfig(), /changed/);
  assert.equal(read(files[0]), applied + ' '); write(files[0], applied);
  await tool.unloadConfig();
  files.forEach(file => fs.rmSync(file));
  await load(); await tool.unloadConfig(); files.forEach(file => assert.equal(fs.existsSync(file), false));
});

test('Qwen custom home, JSON comments, and selected endpoint roundtrip',async()=>{
  const originalHome=process.env.QWEN_HOME;process.env.QWEN_HOME=path.join(home,'custom-qwen');
  const targets=['settings.json','.env'].map(f=>path.join(process.env.QWEN_HOME,f));
  const original='\uFEFF{\n // user comment\n "model":{"name":"test/model","baseUrl":"https://old.example/v1"},\n "modelProviders":{"custom":[{"id":"test/model","baseUrl":"https://old.example/v1"}]},\n "url":"https://example.com/a//b", /* block */ "quoted":"\\\"//literal"\n}\n';
  write(targets[0],original);write(targets[1],'OTHER=keep\n');
  try{
    await load();const settings=JSON.parse(read(targets[0]));assert.equal(settings.model.baseUrl,'https://api.qnaigc.com/v1');assert.equal(settings.model.name,'test/model');assert.equal(settings.url,'https://example.com/a//b');assert.equal(settings.quoted,'"//literal');assert.equal(tool.getConfig().model.baseUrl,'https://api.qnaigc.com/v1');
    assert.equal(fs.existsSync(files[0]),false);await tool.unloadConfig();assert.equal(read(targets[0]),original);assert.equal(read(targets[1]),'OTHER=keep\n');
  }finally{if(originalHome===undefined)delete process.env.QWEN_HOME;else process.env.QWEN_HOME=originalHome;}
});

for (const source of ['environment', 'user dotenv']) {
  test('Qwen refuses load and unload after ' + source + ' changes directory, then restores the original targets', async () => {
    const oldDir = path.join(home, 'old-' + source), newDir = path.join(home, 'new-' + source);
    const oldFiles = ['settings.json', '.env'].map(file => path.join(oldDir, file));
    const bootstrap = path.join(home, '.qwen', '.env');
    const bootstrapBefore = fs.existsSync(bootstrap) ? read(bootstrap) : undefined;
    const setHome = dir => {
      if (source === 'environment') process.env.QWEN_HOME = dir;
      else { delete process.env.QWEN_HOME; write(bootstrap, 'QWEN_HOME=' + JSON.stringify(dir) + '\n'); }
    };
    try {
      setHome(oldDir); write(oldFiles[0], '{"custom":true}'); write(oldFiles[1], 'OTHER=keep\n');
      await load(); const applied = oldFiles.map(read), journal = stateStore.getFileStates(tool.name);
      setHome(newDir);
      assert.throws(() => tool.unloadConfig(), /Qwen configuration directory changed/);
      await assert.rejects(load('next-key'), /Qwen configuration directory changed/);
      assert.deepEqual(oldFiles.map(read), applied);
      assert.deepEqual(stateStore.getFileStates(tool.name), journal);
      assert.equal(fs.existsSync(newDir), false);
      setHome(oldDir); tool.unloadConfig();
      assert.equal(read(oldFiles[0]), '{"custom":true}'); assert.equal(read(oldFiles[1]), 'OTHER=keep\n');
      setHome(newDir); await load(); tool.unloadConfig();
      for (const file of ['settings.json', '.env']) assert.equal(fs.existsSync(path.join(newDir, file)), false);
    } finally {
      delete process.env.QWEN_HOME;
      if (bootstrapBefore === undefined) fs.rmSync(bootstrap, {force:true}); else write(bootstrap, bootstrapBefore);
    }
  });
}

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

test('Qwen accepts a different directory alias for the same recorded files', async () => {
  const real = path.join(home, 'real-qwen'), alias = path.join(home, 'alias-qwen');
  fs.mkdirSync(real, {recursive:true}); fs.symlinkSync(real, alias, 'dir');
  try {
    process.env.QWEN_HOME = alias; await load();
    process.env.QWEN_HOME = real; await load('next-key'); tool.unloadConfig();
    assert.equal(fs.existsSync(path.join(real, 'settings.json')), false);
    assert.equal(fs.existsSync(path.join(real, '.env')), false);
    assert.equal(stateStore.getFileStates(tool.name).length, 0);
  } finally { delete process.env.QWEN_HOME; fs.rmSync(alias); }
});

test('Qwen directory drift reports an error through the unload menu and preserves both directories', async () => {
  const {unloadToolConfig}=await import('../dist/lib/wizard/menus/tool-menu.js');
  const {promptHelper}=await import('../dist/lib/wizard/ui/prompt-helper.js');
  const {uiRenderer}=await import('../dist/lib/wizard/ui/ui-renderer.js');
  const {i18n}=await import('../dist/lib/i18n.js'); i18n.init('en_US');
  const oldDir=path.join(home,'menu-old'),newDir=path.join(home,'menu-new');
  const oldConfirm=promptHelper.confirm,oldEnter=promptHelper.pressEnter;
  const methods=['renderHeader','renderSuccess','renderError'],old=Object.fromEntries(methods.map(name=>[name,uiRenderer[name]])),messages=[];
  process.env.QWEN_HOME=oldDir; await load();
  const credential=read(path.join(oldDir,'.env'));
  write(path.join(newDir,'settings.json'),'{}');write(path.join(newDir,'.env'),'OTHER=keep\n');
  process.env.QWEN_HOME=newDir;
  for(const name of methods) uiRenderer[name]=(...args)=>messages.push([name,...args]);
  promptHelper.confirm=async()=>true; promptHelper.pressEnter=async()=>{};
  try {
    await unloadToolConfig(tool);
    assert.ok(messages.some(([kind,text])=>kind==='renderError'&&text.includes('Qwen configuration directory changed')));
    assert.equal(messages.some(([kind])=>kind==='renderSuccess'),false);
    await assert.rejects(load(),/Qwen configuration directory changed/);
    assert.equal(read(path.join(oldDir,'.env')),credential);
    assert.equal(read(path.join(newDir,'settings.json')),'{}');assert.equal(read(path.join(newDir,'.env')),'OTHER=keep\n');
  } finally {
    Object.assign(uiRenderer,old);promptHelper.confirm=oldConfirm;promptHelper.pressEnter=oldEnter;
    process.env.QWEN_HOME=oldDir;tool.unloadConfig();delete process.env.QWEN_HOME;
  }
});

test('Qwen legacy unload menu displays unchanged guidance instead of successful removal', async () => {
  const {unloadToolConfig}=await import('../dist/lib/wizard/menus/tool-menu.js');
  const {promptHelper}=await import('../dist/lib/wizard/ui/prompt-helper.js');
  const {uiRenderer}=await import('../dist/lib/wizard/ui/ui-renderer.js');
  const {i18n}=await import('../dist/lib/i18n.js');i18n.init('en_US');
  const oldConfirm=promptHelper.confirm,oldEnter=promptHelper.pressEnter;
  const names=['renderHeader','renderSuccess','renderError'];const old=Object.fromEntries(names.map(n=>[n,uiRenderer[n]]));const messages=[];
  for(const n of names)uiRenderer[n]=(...args)=>messages.push([n,...args]);
  promptHelper.confirm=async()=>true;promptHelper.pressEnter=async()=>{};write(files[1],'QINIU_API_KEY=legacy-key');
  try {
    await unloadToolConfig(tool);
    assert.ok(messages.some(([kind,text])=>kind==='renderError'&&text.includes('Configuration is unchanged')));
    assert.equal(messages.some(([kind])=>kind==='renderSuccess'),false);
    assert.equal(read(files[1]),'QINIU_API_KEY=legacy-key');
  } finally {Object.assign(uiRenderer,old);promptHelper.confirm=oldConfirm;promptHelper.pressEnter=oldEnter;fs.rmSync(files[1]);}
});
