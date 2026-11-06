import assert from 'node:assert/strict';
import test from 'node:test';
import { runPrompt } from './helpers/prompt-pty.mjs';
const pty = {skip:process.platform==='win32'};
const sourceHead = `import assert from 'node:assert/strict';import fs from 'node:fs';import {configManager} from './dist/lib/config.js';import {i18n} from './dist/lib/i18n.js';import {promptHelper} from './dist/lib/wizard/ui/prompt-helper.js';i18n.init('en_US');configManager.setApiKey('denied-fixture');const before=fs.readFileSync(configManager.configFile,'utf8');`;
const steps = [[/Model catalog access was denied[^]*Esc back/,'\r']];
const verify = `assert.equal(fs.readFileSync(configManager.configFile,'utf8'),before);console.log('DENIED_OK');`;
function assertDenied(out) { assert.match(out,/DENIED_OK/);assert.doesNotMatch(out,/Enter a model ID|Enter model IDs|Retry fetching|gateway-secret-fixture/); }
for (const status of [401,402,403]) for (const endpoint of ['market','standard']) test(`picker blocks manual recovery for ${endpoint} HTTP ${status}`,pty,async()=>{
 const source=sourceHead+`let calls=0;globalThis.fetch=async url=>{calls++;return new Response('gateway-secret-fixture',{status:'${endpoint}'==='market'||url.endsWith('/v1/models')?${status}:404});};import {pickModel} from './dist/lib/wizard/flows/model-pick-flow.js';assert.equal(await pickModel({tools:[],title:'DENIED'}),'back');assert.equal(calls,${endpoint==='market'?1:2});`+verify;
 assertDenied(await runPrompt(source,steps,110,{rows:40}));
});
for (const [flow,call,result] of [
 ['generic','runGenericModelSelectionFlow("qwen-code","Qwen")','null'],
 ['hermes','runHermesModelSelectionFlow()','null'],
 ['codebuddy','runCodeBuddyModelSelectionFlow()','null'],
 ['workbuddy','runWorkBuddyModelSelectionFlow()','null'],
 ['model','runModelSelectionFlow()','false'],
]) test(`${flow} model flow cannot persist a denied catalog as a manual selection`,pty,async()=>{
 const module=flow==='model'?'model-selection-flow':flow+'-model-selection-flow';
 const fn=call.split('(')[0];
 const source=sourceHead+`promptHelper.confirm=async()=>true;globalThis.fetch=async()=>new Response('',{status:401});import {${fn}} from './dist/lib/wizard/flows/${module}.js';assert.equal(await ${call},${result});`+verify;
 assertDenied(await runPrompt(source,steps,110,{rows:40}));
});
