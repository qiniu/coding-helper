import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-grok-')));
process.env.HOME = process.env.USERPROFILE = home;
delete process.env.KIMI_CODE_HOME; delete process.env.GROK_HOME;
const { GrokTool } = await import('../dist/lib/tools/grok-tool.js');
test('Grok accepts semantic default encodings and identifies managed tables',async()=>{
 const {applyGrokConfig,hasManagedGrokConfig,getGrokInstallCommand}=await import('../dist/lib/tools/grok-tool.js');const {parse}=await import('smol-toml');
 for(const source of ['[models]\n"default"="old"\n"session_summary"="old-summary"\nkeep=true\nweb_search="old-web"\n','models.default="old"\nmodels.session_summary="old-summary"\nmodels.keep=true\nmodels.web_search="old-web"\n','models = { default = "old", session_summary = "old-summary", keep = true, web_search = "old-web" }\n']){
  const next=parse(applyGrokConfig(source,'https://api.qnaigc.com','key','test/model'));assert.equal(next.models.default,'qiniu');assert.equal(next.models.session_summary,'qiniu');assert.equal(next.model.qiniu.model,'test/model');assert.equal(next.models.keep,true);assert.equal(next.models.web_search,'old-web');
 }
 assert.equal(hasManagedGrokConfig('[model."qiniu"] # comment\nmodel="x"'),true);
 assert.equal(hasManagedGrokConfig('text="""\n[model.qiniu]\n"""'),false);
 assert.match(getGrokInstallCommand('win32'),/powershell.*install\.ps1/);assert.match(getGrokInstallCommand('linux'),/pipefail/);
});
test('Grok installer download failure cannot report success',{skip:process.platform==='win32'},async()=>{
 const {getGrokInstallCommand}=await import('../dist/lib/tools/grok-tool.js');const {spawnSync}=await import('node:child_process');
 const bin=fs.mkdtempSync(path.join(os.tmpdir(),'grok-installer-'));fs.writeFileSync(path.join(bin,'curl'),'#!/bin/sh\nexit 22\n',{mode:0o700});
 const result=spawnSync(getGrokInstallCommand('linux'),{shell:true,env:{...process.env,PATH:bin+':'+process.env.PATH}});assert.equal(result.status,22);
 fs.rmSync(bin,{recursive:true});
});
const { marketModelService } = await import('../dist/lib/market-model-service.js');
const { toolManager } = await import('../dist/lib/tool-manager.js');
const { hasSavedToolModelConfig } = await import('../dist/lib/wizard/menus/tool-menu.js');
const tool = new GrokTool(); tool.getVersion = () => null;
marketModelService.fetchModels = async () => [];
const files = [".grok/config.toml"].map(file => path.join(home, file));
const originals = ["# keep\n[models]\ndefault = \"original\"\nsession_summary = \"original-summary\" # restore this too\n[other]\ncustom = true\n"];
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
const read = file => fs.readFileSync(file, 'utf8');
const load = (key = 'test-key', model = 'test/model') => tool.loadConfig(key, 'https://api.qnaigc.com', { toolModels: { [tool.name]: model } });
test('Grok keeps CRLF and known context during an offline credential reload',async()=>{
 const {parse}=await import('smol-toml');const fetch=marketModelService.fetchModels;
 const original='[models]\r\ndefault="original"\r\n[other]\r\nkeep=true\r\n';write(files[0],original);
 marketModelService.fetchModels=async()=>[{id:'test/model',features:[],model_constraints:{context_length:32768,max_tokens:8192},architecture:{input_modalities:['text'],output_modalities:['text'],function_calling:{supported:false},reasoning:{supported:false}}}];
 try{await load();assert.doesNotMatch(read(files[0]),/(?<!\r)\n/);marketModelService.fetchModels=async()=>{throw Error('offline');};await load('second-key');const config=parse(read(files[0]));assert.equal(config.model.qiniu.context_window,32768);assert.equal(config.model.qiniu.api_key,'second-key');await tool.unloadConfig();assert.equal(read(files[0]),original);}finally{marketModelService.fetchModels=fetch;}
});
test('grok is registered and recognizes saved generic model selection', () => {
  assert.ok(toolManager.get(tool.name));
  assert.equal(hasSavedToolModelConfig(tool, { toolModels: { [tool.name]: 'test/model' } }), true);
});
test('grok restores bytes and refuses corrupt or changed config', async () => {
  files.forEach((file, i) => write(file, originals[i]));
  await load(); await load('second-key', 'second/model');
  const {parse}=await import('smol-toml');const selected=parse(read(files[0]));
  assert.equal(selected.models.default,'qiniu');assert.equal(selected.models.session_summary,'qiniu');assert.equal(selected.model.qiniu.model,'second/model');
  await tool.unloadConfig(); files.forEach((file, i) => assert.equal(read(file), originals[i]));
  write(files[0], "broken = [");
  await assert.rejects(load()); assert.equal(read(files[0]), "broken = [");
  write(files[0], originals[0]); await load();
  const applied = read(files[0]); write(files[0], applied + ' ');
  await assert.rejects(load(), /changed/); assert.throws(() => tool.unloadConfig(), /changed/);
  assert.equal(read(files[0]), applied + ' '); write(files[0], applied);
  await tool.unloadConfig();
  files.forEach(file => fs.rmSync(file));
  await load(); await tool.unloadConfig(); files.forEach(file => assert.equal(fs.existsSync(file), false));
});


test('Grok loads equivalent quoted TOML tables and restores original bytes', async () => {
  const original = '["models"]\ndefault = "old"\n[model."qiniu"]\nmodel = "old"\n';
  write(files[0], original); await load(); await load('second-key');
  await tool.unloadConfig(); assert.equal(read(files[0]), original);
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
