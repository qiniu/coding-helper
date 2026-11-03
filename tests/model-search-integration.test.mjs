import assert from 'node:assert/strict';
import test from 'node:test';
import { runPrompt } from './helpers/prompt-pty.mjs';
const head = `import { promptHelper } from './dist/lib/wizard/ui/prompt-helper.js'; import { buildHermesModelChoices } from './dist/lib/wizard/flows/hermes-model-selection-flow.js'; const items = buildHermesModelChoices([{id:'z-ai/glm-5.2',name:'GLM',features:['工具调用'],model_constraints:{context_length:256000}},{id:'a/small',name:'Small',features:['工具调用'],model_constraints:{context_length:128000}},{id:'vendor/reasoner',name:'Friendly reasoner',features:['工具调用','深度思考'],model_constraints:{context_length:256000}}]);`;
for (const query of ['glm5', '智谱', '200k']) test('production searchSelect resolves ' + query, {skip:process.platform === 'win32'}, async () => {
 const out = await runPrompt(head + `console.log('RESULT',JSON.stringify(await promptHelper.searchSelect('SEARCH_READY',items)));`, [['SEARCH_READY',query], [query,query==='glm5'?'\x1b[B\r':'\r']]);
 assert.match(out, /RESULT.*"z-ai\/glm-5.2"/);
});

for(const [query,id] of [['工具调用','z-ai/glm-5.2'],['思考','vendor/reasoner'],['Friendly','vendor/reasoner']])test('production search preserves visible name or capability: '+query,{skip:process.platform==='win32'},async()=>{
 const out=await runPrompt(head+`console.log('RESULT',JSON.stringify(await promptHelper.searchSelect('CAP_READY',items)));`,[['CAP_READY',query],[query,query==='Friendly'?'\x1b[B\r':'\r']]);assert.ok(out.includes('"'+id+'"'),out);
});

for(const [language,query] of [['zh_CN','手动'],['en_US','manual']])test('manual entry remains searchable in '+language,{skip:process.platform==='win32'},async()=>{
 const source=head+`const {i18n}=await import('./dist/lib/i18n.js');i18n.init('${language}');const choices=buildHermesModelChoices([]);console.log('RESULT',JSON.stringify(await promptHelper.searchSelect('MANUAL_READY',choices)));`;const out=await runPrompt(source,[['MANUAL_READY',query],[query,'\r']]);assert.match(out,/RESULT.*"__manual_model__"/);
});
test('skip option remains searchable without becoming a custom model ID',{skip:process.platform==='win32'},async()=>{
 const out=await runPrompt(head+`const {i18n}=await import('./dist/lib/i18n.js');i18n.init('en_US');console.log('RESULT',JSON.stringify(await promptHelper.searchSelect('SKIP_READY',items,true))??'skip');`,[['SKIP_READY','skip'],['skip','\r']]);assert.match(out,/RESULT skip/);
});

test('explicit custom IDs stay first even when a catalog prefix matches',{skip:process.platform==='win32'},async()=>{
 const source=`import {promptHelper} from './dist/lib/wizard/ui/prompt-helper.js';console.log('RESULT',await promptHelper.searchSelect('PREFIX_READY',[{name:'FooBar',value:'qwen/foobar'}]));`;const out=await runPrompt(source,[['PREFIX_READY','qwen/foo'],['qwen/foo','\r']]);assert.match(out,/RESULT qwen\/foo[\r\n]/);
});
