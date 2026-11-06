import assert from 'node:assert/strict'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import test from 'node:test'; import {parse} from 'smol-toml';
import {isolateHome} from './helpers/isolated-home.mjs';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'context-offline-'));isolateHome(home);
const {configManager}=await import('../dist/lib/config.js');const {toolManager}=await import('../dist/lib/tool-manager.js');const {marketModelService}=await import('../dist/lib/market-model-service.js');
const model='context/model';let offline=false;
marketModelService.fetchModels=async()=>{if(offline)throw Error('offline');return [{id:model,features:['工具调用'],model_constraints:{context_length:32768,max_tokens:8192},architecture:{input_modalities:['text','image'],output_modalities:['text'],function_calling:{supported:true},reasoning:{supported:false}}}];};
test.after(()=>fs.rmSync(home,{recursive:true,force:true}));
const cases=[
 ['qwen-code','.qwen/settings.json',text=>{const v=JSON.parse(text).modelProviders.openai.find(v=>v.id===model);return {context:v.generationConfig.contextWindowSize};}],
 ['opencode','.config/opencode/opencode.json',text=>{const v=JSON.parse(text).provider.qiniu.models[model];return {context:v.limit.context,output:v.limit.output,image:v.modalities.input.includes('image')};}],
 ['openclaw','.openclaw/openclaw.json',text=>{const v=JSON.parse(text).models.providers.qiniu.models.find(v=>v.id===model);return {context:v.contextWindow,output:v.maxTokens,image:v.input.includes('image')};}],
 ['droid','.factory/settings.json',text=>{const v=JSON.parse(text).customModels.find(v=>v.model===model);return {context:v.maxContextLimit+v.maxOutputTokens,output:v.maxOutputTokens,image:!v.noImageSupport};}],
 ['grok','.grok/config.toml',text=>{const v=parse(text).model.qiniu;return {context:v.context_window};}],
];
for(const [name,file,inspect] of cases)test(`${name} offline context cap never expands verified limits or loses modalities`,async()=>{
 offline=false;const tool=toolManager.get(name);const models={toolModels:{[name]:model}};await tool.loadConfig('sk-test','https://api.qnaigc.com',models);
 const before=inspect(fs.readFileSync(path.join(home,file),'utf8'));assert.equal(before.context,32768);offline=true;
 configManager.setContextWindow(64000,[name]);await tool.loadConfig('sk-next','https://api.qnaigc.com',models);
 assert.deepEqual(inspect(fs.readFileSync(path.join(home,file),'utf8')),before);
 configManager.setContextWindow(16000,[name]);await tool.loadConfig('sk-next','https://api.qnaigc.com',models);
 const capped=inspect(fs.readFileSync(path.join(home,file),'utf8'));assert.equal(capped.context,16000);if('image' in before)assert.equal(capped.image,before.image);if(capped.output)assert.ok(capped.output<16000);
 await tool.unloadConfig();
});

test('small Droid caps leave half the context for input online and offline', async () => {
 const tool=toolManager.get('droid');const models={toolModels:{droid:model}};
 configManager.setContextWindow(4000,['droid']);
 for(const unavailable of [false,true]) {
  offline=unavailable;await tool.loadConfig('sk-test','https://api.qnaigc.com',models);
  const entry=JSON.parse(fs.readFileSync(path.join(home,'.factory/settings.json'),'utf8')).customModels.find(v=>v.model===model);
  assert.equal(entry.maxContextLimit,2000);assert.equal(entry.maxOutputTokens,2000);
 }
 await tool.unloadConfig();
});
for(const name of ['codebuddy','workbuddy'])test(`${name} caps both input and output budgets`,async()=>{
 offline=false;configManager.setContextWindow(4000,[name]);
 const tool=toolManager.get(name);
 await tool.loadConfig('sk-test','https://api.qnaigc.com',{[name==='codebuddy'?'codeBuddyModels':'workbuddyModels']:[model]});
 const caps=tool.getConfig().models.find(v=>v.id===model);
 assert.equal(caps.maxInputTokens,4000);assert.equal(caps.maxOutputTokens,2000);await tool.unloadConfig();
});
