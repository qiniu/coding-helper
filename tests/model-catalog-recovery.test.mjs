import assert from 'node:assert/strict';
import test from 'node:test';
import { runPrompt } from './helpers/prompt-pty.mjs';

const head = `import assert from 'node:assert/strict';import fs from 'node:fs';import {i18n} from './dist/lib/i18n.js';import {configManager} from './dist/lib/config.js';import {marketModelService} from './dist/lib/market-model-service.js';import {modelService} from './dist/lib/model-service.js';import {FLOW_STEP_KEYS} from './dist/lib/wizard/ui/ui-renderer.js';i18n.init('en_US');configManager.setApiKey('fixture');const step={current:5,total:6,keys:FLOW_STEP_KEYS};const before=fs.readFileSync(configManager.configFile,'utf8');`;
const recovery = /Choose how to continue[^]*Esc back/;
const pty = {skip:process.platform==='win32'};
for (const name of ['codebuddy','workbuddy']) {
  const fn = name === 'codebuddy' ? 'runCodeBuddyModelSelectionFlow' : 'runWorkBuddyModelSelectionFlow';
  const selection = head+`const {${fn}:select}=await import('./dist/lib/wizard/flows/${name}-model-selection-flow.js');`;
  test(`${name} falls back to standard API without guessing capability tags`,pty,async()=>{
    const source=selection+`marketModelService.fetchModels=async()=>{throw Error('market unavailable');};modelService.fetchModels=async()=>[{id:'vendor/model'}];assert.deepEqual(await select({step}),['vendor/model']);assert.equal(fs.readFileSync(configManager.configFile,'utf8'),before);console.log('FALLBACK_OK');`;
    const out=await runPrompt(source,[[/vendor\/model[^]*Type search/,'\r'],[/Selected 1:[^]*Type search/,'\r']],110,{rows:40});
    assert.match(out,/5 \/ 6/);assert.match(out,/FALLBACK_OK/);assert.doesNotMatch(out,/\[Tool calls\]/);
  });
  test(`${name} offers retry after both APIs fail and retry defaults forward`,pty,async()=>{
    const source=selection+`let tries=0;marketModelService.fetchModels=async()=>{if(++tries===1)throw Error('secret-backend');return[{id:'a',name:'Recovered',features:['工具调用']}];};modelService.fetchModels=async()=>{throw Error('secret-backend');};assert.deepEqual(await select({step}),['a']);assert.equal(tries,2);console.log('RETRY_OK');`;
    const out=await runPrompt(source,[[recovery,'\r'],[/Recovered[^]*Type search/,'\r'],[/Selected 1:[^]*Type search/,'\r']],110,{rows:40});
    assert.match(out,/RETRY_OK/);assert.doesNotMatch(out,/secret-backend/);
  });
  test(`${name} manual recovery preserves multiple models without premature writes`,pty,async()=>{
    const source=selection+`marketModelService.fetchModels=modelService.fetchModels=async()=>{throw Error('offline');};assert.deepEqual(await select({step}),['one/a','two/b']);assert.equal(fs.readFileSync(configManager.configFile,'utf8'),before);console.log('MANUAL_OK');`;
    const out=await runPrompt(source,[[recovery,'\x1b[B\r'],[/Type search/,'one/a,two/b,one/a\r'],[/Selected 2:[^]*Type search/,'\r']],110,{rows:40});assert.match(out,/MANUAL_OK/);
  });
}

test('failed model step returns to tool selection and can retry instead of exiting init',pty,async()=>{
  const source=head+`import {toolManager} from './dist/lib/tool-manager.js';import {runToolSetupFlow} from './dist/lib/wizard/flows/tool-setup-flow.js';const tool=toolManager.get('workbuddy');tool.isInstalled=()=>true;let writes=0;tool.loadConfig=async()=>{writes++;};marketModelService.fetchModels=modelService.fetchModels=async()=>{throw Error('offline');};assert.equal(await runToolSetupFlow([tool],{first:4,total:6,keys:FLOW_STEP_KEYS}),false);assert.equal(writes,0);assert.equal(fs.readFileSync(configManager.configFile,'utf8'),before);console.log('BACK_OK');`;
  const out=await runPrompt(source,[[/Select tools[^]*Esc back/,'\r'],[recovery,'\x1b'],[/Select tools[^]*Esc back/,'\x1b']],110,{rows:40});assert.match(out,/5 \/ 6/);assert.match(out,/BACK_OK/);
});

test('model editor and nested picker retain wizard progress and stage with Next',pty,async()=>{
  const source=head+`import {toolManager} from './dist/lib/tool-manager.js';import {editToolModels} from './dist/lib/wizard/flows/model-slots-flow.js';marketModelService.fetchModels=async()=>[{id:'a/model',features:['工具调用']}];const tool=toolManager.get('claude-code');tool.checkModel=async()=>undefined;const plan=await editToolModels(tool,undefined,{step});assert.equal(plan.main,'a/model');assert.equal(fs.readFileSync(configManager.configFile,'utf8'),before);console.log('STAGED_OK');`;
  const frames=[];const out=await runPrompt(source,[[/Main model[^]*Next[^]*Esc back/,s=>{frames.push(s.slice(s.lastIndexOf('5 / 6')-120));return '\r';}],[/Type search/,s=>{frames.push(s.slice(s.lastIndexOf('5 / 6')-120));return '\r';}],[/a\/model[^]*Next[^]*Esc back/,'\r']],110,{rows:40});
  for(const frame of frames)assert.match(frame,/5 \/ 6/);assert.match(out,/STAGED_OK/);assert.doesNotMatch(out,/Save & write/);
});
