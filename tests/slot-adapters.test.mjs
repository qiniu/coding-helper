import assert from 'node:assert/strict'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import test from 'node:test'; import { parse } from 'smol-toml'; import yaml from 'js-yaml';
import { isolateHome } from './helpers/isolated-home.mjs'; import { runPrompt } from './helpers/prompt-pty.mjs';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-model-slots-')); isolateHome(home);
const { toolManager } = await import('../dist/lib/tool-manager.js');
const oldFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({status:true,data:['main','own','eye'].map(id=>({id,features:['工具调用'],model_constraints:{context_length:128000,max_tokens:8192},architecture:{function_calling:{supported:true},input_modalities:['text','image']}}))}));
test.after(() => { globalThis.fetch=oldFetch; fs.rmSync(home,{recursive:true,force:true}); });
const cases = [
 ['claude-code','.claude/settings.json', '{"model":"old","env":{"ANTHROPIC_DEFAULT_HAIKU_MODEL":"old-fallback","ANTHROPIC_SMALL_FAST_MODEL":"old-fast","ANTHROPIC_DEFAULT_FABLE_MODEL":"old-fable"}}\n', {claudeCode:{sonnetModel:'main',opusModel:'main',haikuModel:'main',subagentModel:'main'}}, {fallback:'own',subagent:'eye'}, text => {const v=JSON.parse(text); assert.equal(v.env.ANTHROPIC_DEFAULT_HAIKU_MODEL,'own');assert.equal(v.env.CLAUDE_CODE_SUBAGENT_MODEL,'eye');assert.equal(v.env.ANTHROPIC_SMALL_FAST_MODEL,'own');assert.equal(v.env.ANTHROPIC_DEFAULT_FABLE_MODEL,'main');}],
 ['codex','.codex/config.toml','model = "old"\nreview_model = "old-review"\n', {codexModel:'openai/gpt-6-astra'}, {review:'own',subagent:'eye',memory:'own'}, text=>{const v=parse(text); assert.equal(v.review_model,'own');assert.equal(v.agents.default_subagent_model,'eye');assert.equal(v.memories.extract_model,'own');}],
 ['droid','.factory/settings.json','{"customModels":[{"model":"mine","displayName":"Mine","baseUrl":"https://foreign"}],"sessionDefaultSettings":{"model":"old","autonomyMode":"safe"}}\n',{toolModels:{droid:'main'}},{spec:'own'},text=>{const v=JSON.parse(text);assert.equal(v.customModels[0].model,'mine');assert.equal(v.sessionDefaultSettings.model,'custom:Qiniu:-main-1');assert.equal(v.sessionDefaultSettings.specModeModel,'custom:Qiniu:-own-2');assert.equal(v.sessionDefaultSettings.autonomyMode,'safe');}],
 ['grok','.grok/config.toml','[ui]\ntheme = "dark"\n',{toolModels:{grok:'main'}},{summary:'own'},text=>{const v=parse(text);assert.equal(v.models.session_summary,'qiniu-summary');assert.equal(v.model['qiniu-summary'].model,'own');assert.equal(v.ui.theme,'dark');}],
 ['hermes','.hermes/config.yaml','model:\n  default: old\n  provider: local\nauxiliary:\n  vision:\n    model: old-eye\n    provider: local\n    api_mode: codex_responses\n    other: keep\n',{hermesModel:'main'},{vision:'eye'},text=>{const v=yaml.load(text);assert.equal(v.auxiliary.vision.model,'eye');assert.equal(v.auxiliary.vision.other,'keep');assert.equal(v.auxiliary.vision.api_mode,undefined);}],
];
for (const [name,relative,original,models,slots,check] of cases) test(`${name} writes slots and restores all original bytes`, async () => {
 const file=path.join(home,relative); fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,original);
 const tool=toolManager.get(name); await tool.loadConfig('sk-test','https://api.qnaigc.com',{...models,slotModels:{[name]:slots}});check(fs.readFileSync(file,'utf8')); if(name==='claude-code'){const env=tool.getLaunchEnv('sk-test','https://api.qnaigc.com',{...models,slotModels:{[name]:slots}});assert.equal(env.ANTHROPIC_SMALL_FAST_MODEL,'own');assert.equal(env.ANTHROPIC_DEFAULT_FABLE_MODEL,'main');} const first=fs.readFileSync(file,'utf8'); await tool.loadConfig('sk-test','https://api.qnaigc.com',{...models,slotModels:{[name]:slots}}); assert.equal(fs.readFileSync(file,'utf8'),first);
 if(name==='hermes'){await tool.loadConfig('sk-test','https://api.qnaigc.com',{...models,slotModels:{hermes:{}}});assert.equal(yaml.load(fs.readFileSync(file,'utf8')).auxiliary.vision.model,'main');assert.equal(yaml.load(fs.readFileSync(file,'utf8')).auxiliary.vision.api_mode,undefined);}
 await tool.unloadConfig(); assert.equal(fs.readFileSync(file,'utf8'),original);
});
test('Codex catalog includes distinct custom slots with context caps',async()=>{
 const {configManager}=await import('../dist/lib/config.js');configManager.setContextWindow(64000,['codex']);
 const tool=toolManager.get('codex');await tool.loadConfig('sk-test','https://api.qnaigc.com',{codexModel:'main',slotModels:{codex:{review:'own',subagent:'eye',memory:'own'}}});
 const catalog=JSON.parse(fs.readFileSync(path.join(home,'.codex/model-catalogs/qnaigc.json'),'utf8'));
 for(const id of ['main','own','eye']){const model=catalog.models.find(m=>m.slug===id);assert.ok(model,id);assert.equal(model.context_window,64000);assert.deepEqual(model.input_modalities,['text','image']);}
 assert.equal(catalog.models.filter(m=>m.slug==='own').length,1);await tool.unloadConfig();
});
test('Grok retains known context when main and summary models swap offline',async()=>{
 const {marketModelService}=await import('../dist/lib/market-model-service.js');const fetch=marketModelService.fetchModels;
 marketModelService.fetchModels=async()=>['main','own'].map((id,i)=>({id,model_constraints:{context_length:[32768,65536][i]}}));
 const tool=toolManager.get('grok');
 try{await tool.loadConfig('sk-test','https://api.qnaigc.com',{toolModels:{grok:'main'},slotModels:{grok:{summary:'own'}}});marketModelService.fetchModels=async()=>{throw Error('offline')};await tool.loadConfig('sk-test','https://api.qnaigc.com',{toolModels:{grok:'own'},slotModels:{grok:{summary:'main'}}});const config=parse(fs.readFileSync(path.join(home,'.grok/config.toml'),'utf8'));assert.equal(config.model.qiniu.context_window,65536);assert.equal(config.model['qiniu-summary'].context_window,32768);await tool.unloadConfig();}finally{marketModelService.fetchModels=fetch;}
});

test('Hermes vision follows the main model without an override and after clearing one',async()=>{
 const file=path.join(home,'.hermes/config.yaml');const original='model:\n  default: old\n  provider: local\nauxiliary:\n  vision:\n    provider: old-provider\n    model: old-eye\n    api_mode: codex_responses\n';fs.writeFileSync(file,original);const tool=toolManager.get('hermes');
 for(const [main,overrides,expected] of [['main',undefined,'main'],['main2',{vision:'eye'},'eye'],['main2',{},'main2']]){await tool.loadConfig('sk-test','https://api.qnaigc.com',{hermesModel:main,slotModels:overrides?{hermes:overrides}:undefined});const vision=yaml.load(fs.readFileSync(file,'utf8')).auxiliary.vision;assert.equal(vision.model,expected);assert.equal(vision.provider,'custom');assert.equal(vision.base_url,'https://api.qnaigc.com/v1');assert.equal(vision.api_mode,undefined);}
 await tool.unloadConfig();assert.equal(fs.readFileSync(file,'utf8'),original);
});
