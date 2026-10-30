import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'hermes-safe-'));process.env.HOME=process.env.USERPROFILE=home;
const {HermesTool}=await import('../dist/lib/tools/hermes-tool.js');const tool=new HermesTool();const file=path.join(home,'.hermes/config.yaml');
test('Hermes roundtrip preserves comments and rejects corrupt or externally edited configuration',async()=>{fs.mkdirSync(path.dirname(file));const original='# keep\nmodel: {default: old, provider: original}\nother: true\n';fs.writeFileSync(file,original);await tool.loadConfig('key','https://api.qnaigc.com',{hermesModel:'test/model'});await tool.unloadConfig();assert.equal(fs.readFileSync(file,'utf8'),original);fs.writeFileSync(file,'model: [');await assert.rejects(tool.loadConfig('key','https://api.qnaigc.com',{hermesModel:'test/model'}));assert.equal(fs.readFileSync(file,'utf8'),'model: [');fs.writeFileSync(file,original);await tool.loadConfig('key','https://api.qnaigc.com',{hermesModel:'test/model'});fs.appendFileSync(file,'# user edit\n');await assert.rejects(tool.unloadConfig(),/changed/);assert.match(fs.readFileSync(file,'utf8'),/# user edit/);});

test('Hermes refuses to report successful unloading without restoration state',async()=>{
  const {stateStore}=await import('../dist/lib/core/state-store.js');stateStore.clear();const original='model: {api_key: legacy-key}\n';fs.writeFileSync(file,original);
  await assert.rejects(tool.unloadConfig(),/No restoration record/);assert.equal(fs.readFileSync(file,'utf8'),original);
});
test('Hermes tightens existing directory and unchanged file permissions',async()=>{
  if(process.platform==='win32')return;const {stateStore}=await import('../dist/lib/core/state-store.js');stateStore.clear();fs.writeFileSync(file,'{}');
  await tool.loadConfig('key','https://api.qnaigc.com',{hermesModel:'test/model'});
  fs.chmodSync(path.dirname(file),0o755);fs.chmodSync(file,0o644);await tool.loadConfig('key','https://api.qnaigc.com',{hermesModel:'test/model'});
  assert.equal(fs.statSync(path.dirname(file)).mode&0o777,0o700);assert.equal(fs.statSync(file).mode&0o777,0o600);await tool.unloadConfig();
});

test('Hermes refuses to snapshot legacy Qiniu credentials as user originals before reload', async () => {
  const {stateStore}=await import('../dist/lib/core/state-store.js');stateStore.clear();
  for(const endpoint of ['https://api.qnaigc.com/v1','https://api.modelink.ai/v1','https://openai.qiniu.com/v1']) {
    const original='model: {provider: custom, default: old, base_url: "'+endpoint+'", api_key: legacy-key}\n';
    fs.writeFileSync(file,original);
    await assert.rejects(tool.loadConfig('new-key','https://api.qnaigc.com',{hermesModel:'test/model'}),/Legacy Hermes.*Configuration is unchanged.*before loading/);
    assert.equal(fs.readFileSync(file,'utf8'),original);assert.equal(stateStore.getFileStates('hermes').length,0);
    await assert.rejects(tool.unloadConfig(),/No restoration record/);
    assert.equal(fs.readFileSync(file,'utf8'),original);
  }
  fs.writeFileSync(file,'# manually recovered\nmodel: {provider: original}\n');
  await tool.loadConfig('new-key','https://api.qnaigc.com',{hermesModel:'test/model'});
  await tool.loadConfig('next-key','https://api.qnaigc.com',{hermesModel:'test/model'});
  await tool.unloadConfig();assert.equal(fs.readFileSync(file,'utf8'),'# manually recovered\nmodel: {provider: original}\n');
});
test('Hermes legacy guard validates the transaction snapshot after external replacement',async()=>{
 const {stateStore}=await import('../dist/lib/core/state-store.js');stateStore.clear();
 const original='model: {provider: original}\n';const legacy='model: {base_url: "https://api.qnaigc.com/v1", api_key: legacy-key}\n';fs.writeFileSync(file,original);
 const saved=stateStore.getFileStates;let injected=false;
 stateStore.getFileStates=function(...args){if(!injected){injected=true;fs.writeFileSync(file,legacy);}return saved.apply(this,args);};
 try{await assert.rejects(tool.loadConfig('new-key','https://api.qnaigc.com',{hermesModel:'test/model'}),/Legacy Hermes/);assert.equal(fs.readFileSync(file,'utf8'),legacy);assert.equal(stateStore.getFileStates('hermes').length,0);}
 finally{stateStore.getFileStates=saved;}
});
