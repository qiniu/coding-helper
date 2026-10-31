import assert from 'node:assert/strict'; import test from 'node:test'; import { runPrompt } from './helpers/prompt-pty.mjs';
test('real PTY model picker search cancellation never saves helper settings', { skip: process.platform === 'win32' }, async () => {
 const out = await runPrompt(`import fs from 'node:fs'; import { configManager } from './dist/lib/config.js'; import { marketModelService } from './dist/lib/market-model-service.js'; import { pickModel } from './dist/lib/wizard/flows/model-pick-flow.js'; configManager.getConnection = () => ({apiKey:'fake',baseUrl:'https://example.com',endpoint:'china'}); marketModelService.fetchModels=async()=>[{id:'z-ai/glm-5.2',name:'GLM',features:['工具调用'],model_constraints:{context_length:200000,max_tokens:8192},architecture:{function_calling:{supported:true}}}]; console.log('RESULT',JSON.stringify(await pickModel({tools:[],title:'PICK_READY'}))); console.log('SAVED',fs.existsSync(configManager.configFile));`, [['glm-5.2', 'zzzz'], ['zzzz', '\x1b'], ['⌕ 直接打字搜索', '\x1b']]);
 assert.match(out, /RESULT.*"back"/); assert.match(out, /SAVED.*false/);
});
const pickerHead = `import {configManager} from './dist/lib/config.js';import {marketModelService} from './dist/lib/market-model-service.js';import {modelService} from './dist/lib/model-service.js';import {pickModel} from './dist/lib/wizard/flows/model-pick-flow.js';configManager.getConnection=()=>({apiKey:'bound-test-key',baseUrl:'https://api.modelink.ai',endpoint:'international'});`;
test('picker falls back to the standard catalog and shows its bound connection', {skip:process.platform==='win32'},async()=>{
 const source=pickerHead+`marketModelService.fetchModels=async()=>{throw Error('HTTP 404');};modelService.fetchModels=async(url,key)=>{if(url!=='https://api.modelink.ai'||key!=='bound-test-key')throw Error('wrong connection');return[{id:'vendor/standard'}]};console.log('RESULT',JSON.stringify(await pickModel({tools:[],title:'FALLBACK_READY'})));`;
 const out=await runPrompt(source,[['vendor/standard','\r']]);assert.match(out,/RESULT.*"model":"vendor\/standard"/);assert.match(out,/modelink.ai/);assert.doesNotMatch(out,/api.qnaigc.com/);
});
test('picker retains manual entry when both catalogs are unavailable', {skip:process.platform==='win32'},async()=>{
 const source=pickerHead+`marketModelService.fetchModels=modelService.fetchModels=async()=>{throw Error('offline')};console.log('RESULT',JSON.stringify(await pickModel({tools:[],title:'MANUAL_READY'})));`;
 const out=await runPrompt(source,[['←→','vendor/custom'],['vendor/custom','\r']]);assert.match(out,/RESULT.*"model":"vendor\/custom"/);
});
for(const query of ['vision','vision 1m','thinking']) test('picker preserves capability constraints for '+query,{skip:process.platform==='win32'},async()=>{
 const source=pickerHead+`marketModelService.fetchModels=async()=>[{id:'a/text',name:'Text',features:['工具调用'],model_constraints:{context_length:200000}}];console.log('RESULT',JSON.stringify(await pickModel({tools:[],title:'CONSTRAINT_READY'})));`;
 const out=await runPrompt(source,[['←→',query],[query,'\x1b'],['a/text','\x1b']]);const searched=out.slice(out.indexOf('⌕ '+query));const search=searched.slice(0,searched.indexOf('? '));assert.doesNotMatch(search,/❯/);assert.match(out,/RESULT.*"back"/);
});

test('production generic model flow opens picker and remembers accepted selections',{skip:process.platform==='win32'},async()=>{
 const source=`import {configManager} from './dist/lib/config.js';import {marketModelService} from './dist/lib/market-model-service.js';import {runGenericModelSelectionFlow} from './dist/lib/wizard/flows/generic-model-selection-flow.js';configManager.setApiKey('fake');marketModelService.fetchModels=async()=>[{id:'vendor/model',name:'Model',features:['工具调用']}];console.log('RESULT',await runGenericModelSelectionFlow('opencode','PICK_PRODUCTION'));console.log('RECENT',JSON.stringify(configManager.getModels().recentModels));`;
 const out=await runPrompt(source,[['←→','\r']]);assert.match(out,/RESULT vendor\/model/);assert.match(out,/RECENT.*\["vendor\/model"\]/);
});

test('model picker supports reasoning capability search with current metadata',{skip:process.platform==='win32'},async()=>{
 const source=pickerHead+`marketModelService.fetchModels=async()=>[{id:'a/brain',name:'Reasoner',features:['工具调用','深度思考'],model_constraints:{context_length:200000}},{id:'a/text',name:'Text',features:['工具调用']}];console.log('RESULT',JSON.stringify(await pickModel({tools:[]})));`;
 const out=await runPrompt(source,[['←→','思考'],['思考','\r']]);assert.match(out,/RESULT.*"model":"a\/brain"/);
});

for(const [input,expected] of [['qwen/foo','qwen/foo'],['qwen/','qwen/foobar']])test('picker distinguishes explicit ID from namespace search: '+input,{skip:process.platform==='win32'},async()=>{
 const source=pickerHead+`marketModelService.fetchModels=async()=>[{id:'qwen/foobar',name:'FooBar',features:['工具调用']}];console.log('RESULT',JSON.stringify(await pickModel({tools:[]})));`;const out=await runPrompt(source,[['←→',input],[input,'\r']]);assert.ok(out.includes('"model":"'+expected+'"'),out);
});
