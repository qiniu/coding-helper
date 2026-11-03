import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {isolateHome} from './helpers/isolated-home.mjs';
const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'qwen-recovery-')));isolateHome(home);
const root=path.join(home,'qwen');process.env.QWEN_HOME=root;
const {QwenCodeTool}=await import('../dist/lib/tools/qwen-code-tool.js');
const {stateStore}=await import('../dist/lib/core/state-store.js');
const {applyTool,removeTool}=await import('../dist/lib/core/tool-service.js');
const {isExternallyModified}=await import('../dist/lib/core/rebaseline.js');
const {marketModelService}=await import('../dist/lib/market-model-service.js');
const oldFetch=globalThis.fetch;
globalThis.fetch=async()=>new Response(JSON.stringify({status:true,data:[{id:'main',features:['工具调用'],model_constraints:{context_length:32768,max_tokens:4096}}]}));
const tool=new QwenCodeTool(),settings=path.join(root,'settings.json'),env=path.join(root,'.env');
const original=JSON.stringify({security:{auth:{selectedType:'openai'}},model:{name:'original',baseUrl:'https://original.example/v1'},modelProviders:{openai:[{id:'original',baseUrl:'https://original.example/v1',envKey:'ORIGINAL_KEY'}]}})+'\n';
const foreign=original.replaceAll('original','external').replaceAll('ORIGINAL','EXTERNAL');
const originalEnv='ORIGINAL_KEY=original-fixture\nKEEP=original\n',foreignEnv='EXTERNAL_KEY=external-fixture\nKEEP=current\n';
const connection={apiKey:'new-fixture',baseUrl:'https://api.qnaigc.com',models:{toolModels:{'qwen-code':'main'}}};
async function loaded(){
 stateStore.clear();fs.rmSync(root,{recursive:true,force:true});fs.mkdirSync(root,{recursive:true});fs.writeFileSync(settings,original);fs.writeFileSync(env,originalEnv);marketModelService.clearCache();
 await tool.loadConfig('old-fixture',connection.baseUrl,connection.models);
 return {settings:fs.readFileSync(settings,'utf8'),env:fs.readFileSync(env,'utf8'),records:stateStore.getFileStates(tool.name)};
}
async function switched(){const before=await loaded();fs.writeFileSync(settings,foreign);fs.writeFileSync(env,foreignEnv);assert.equal(isExternallyModified(tool),true);return before;}
test.after(()=>{globalThis.fetch=oldFetch;delete process.env.QWEN_HOME;fs.rmSync(home,{recursive:true,force:true});});
test('a deleted routing file retains the complete Qwen recovery journal until it is repaired',async()=>{
 const before=await loaded();fs.rmSync(settings);
 assert.equal(isExternallyModified(tool),false);
 assert.equal((await removeTool(tool)).status,'failed');assert.deepEqual(stateStore.getFileStates(tool.name),before.records);assert.equal(fs.readFileSync(env,'utf8'),before.env);
 fs.writeFileSync(settings,before.settings);assert.equal((await removeTool(tool)).status,'success');assert.equal(fs.readFileSync(settings,'utf8'),original);assert.equal(fs.readFileSync(env,'utf8'),originalEnv);
});
test('a missing credential file after an explicit provider switch can be recreated and restored as absent',async()=>{
 await switched();fs.rmSync(env);assert.equal(isExternallyModified(tool),true);
 const result=await applyTool(tool,connection);assert.equal(result.status,'success',result.reason);
 const entries=stateStore.getFileStates(tool.name)[0].state.priors.files;assert.equal(entries.length,2);assert.equal(entries.find(entry=>entry.file===env).original,null);assert.match(fs.readFileSync(env,'utf8'),/QINIU_API_KEY/);
 assert.equal((await removeTool(tool)).status,'success');assert.equal(fs.readFileSync(settings,'utf8'),foreign);assert.equal(fs.existsSync(env),false);
});
test('an invalid dotenv failure retains old records and can retry after the dotenv is corrected',async()=>{
 const before=await switched(),invalid='OTHER="first\nsecond"\n';fs.writeFileSync(env,invalid);
 assert.equal((await applyTool(tool,connection)).status,'failed');assert.deepEqual(stateStore.getFileStates(tool.name),before.records);assert.equal(fs.readFileSync(settings,'utf8'),foreign);assert.equal(fs.readFileSync(env,'utf8'),invalid);
 fs.writeFileSync(env,foreignEnv);const retried=await applyTool(tool,connection);assert.equal(retried.status,'success',retried.reason);
 assert.equal((await removeTool(tool)).status,'success');assert.equal(fs.readFileSync(settings,'utf8'),foreign);assert.equal(fs.readFileSync(env,'utf8'),foreignEnv);
});
test('a credential write failure rolls back the earlier settings write and reinstates the old records',async t=>{
 const before=await switched(),rename=fs.renameSync;
 t.mock.method(fs,'renameSync',(from,to)=>{if(path.resolve(String(to))===env)throw Object.assign(Error('fixture permission denied'),{code:'EACCES'});return rename(from,to);});
 assert.equal((await applyTool(tool,connection)).status,'failed');assert.deepEqual(stateStore.getFileStates(tool.name),before.records);assert.equal(fs.readFileSync(settings,'utf8'),foreign);assert.equal(fs.readFileSync(env,'utf8'),foreignEnv);
 t.mock.restoreAll();assert.equal((await applyTool(tool,connection)).status,'success');assert.equal((await removeTool(tool)).status,'success');assert.equal(fs.readFileSync(settings,'utf8'),foreign);assert.equal(fs.readFileSync(env,'utf8'),foreignEnv);
});
test('a failed client rollback retains its new partial-write journal for ordinary restore',async t=>{
 await switched();const rename=fs.renameSync;let settingsWrites=0;
 t.mock.method(fs,'renameSync',(from,to)=>{const target=path.resolve(String(to));if(target===env||(target===settings&&++settingsWrites>=2))throw Object.assign(Error('fixture permission denied'),{code:'EACCES'});return rename(from,to);});
 const result=await applyTool(tool,connection);assert.equal(result.status,'failed');assert.match(result.reason,/rollback failed/);
 const entries=stateStore.getFileStates(tool.name)[0].state.priors.files;assert.ok(entries.some(entry=>Object.hasOwn(entry,'before')));assert.equal(entries.find(entry=>entry.file===settings).original,foreign);
 t.mock.restoreAll();assert.equal((await removeTool(tool)).status,'success');assert.equal(fs.readFileSync(settings,'utf8'),foreign);assert.equal(fs.readFileSync(env,'utf8'),foreignEnv);assert.deepEqual(stateStore.getFileStates(tool.name),[]);
});

test('deleting a helper-created routing file still allows safe credential cleanup',async()=>{
 stateStore.clear();fs.rmSync(root,{recursive:true,force:true});fs.mkdirSync(root,{recursive:true});fs.writeFileSync(env,originalEnv);
 await tool.loadConfig('old-fixture',connection.baseUrl,connection.models);fs.rmSync(settings);
 assert.equal(isExternallyModified(tool),false);assert.equal((await removeTool(tool)).status,'success');assert.equal(fs.existsSync(settings),false);assert.equal(fs.readFileSync(env,'utf8'),originalEnv);assert.deepEqual(stateStore.getFileStates(tool.name),[]);
});
