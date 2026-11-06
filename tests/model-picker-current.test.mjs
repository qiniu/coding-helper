import assert from 'node:assert/strict';
import test from 'node:test';
import {runPrompt} from './helpers/prompt-pty.mjs';

const head=`import {configManager} from './dist/lib/config.js';import {i18n} from './dist/lib/i18n.js';import {marketModelService} from './dist/lib/market-model-service.js';import {pickModel} from './dist/lib/wizard/flows/model-pick-flow.js';i18n.init('en_US');configManager.getConnection=()=>({apiKey:'fake',baseUrl:'https://example.com',endpoint:'custom'});const m=id=>({id,name:id,features:['工具调用']});marketModelService.fetchModels=async()=>[m('vendor/a-new'),m('vendor/z-current')];`;

test('picker starts on the current model and keeps it visible while browsing another model',{skip:process.platform==='win32'},async()=>{
  let first;
  const source=head+`console.log('RESULT',JSON.stringify(await pickModel({tools:[],currentModels:[{tool:'Editor',model:'vendor/z-current'}]})));`;
  const out=await runPrompt(source,[
    [/Editor currently uses: vendor\/z-current[^]*Type search/,text=>{first=text;return '\x1b[A';}],
    [/❯ +vendor\/a-new[^]*Type search/,'\x1b'],
  ],120,{rows:32});
  assert.match(first,/❯▪ +vendor\/z-current/);
  assert.match(first,/current · Editor/);
  const browsing=out.slice(out.lastIndexOf('Editor currently uses: vendor/z-current'));
  assert.match(browsing,/vendor\/a-new/);
  assert.match(out,/RESULT "back"/);
});

test('batch picker identifies each tools current model without claiming all tools use one model',{skip:process.platform==='win32'},async()=>{
  const source=head+`console.log('RESULT',JSON.stringify(await pickModel({tools:[],currentModels:[{tool:'Editor A',model:'vendor/a-new'},{tool:'Editor B',model:'vendor/z-current'}]})));`;
  const out=await runPrompt(source,[[/current models are marked in the list[^]*Type search/,'\x1b']],150,{rows:32});
  assert.match(out,/current · Editor A/);assert.match(out,/current · Editor B/);
  assert.doesNotMatch(out,/Selected tools currently use:/);
});

test('current model remains visible when it is absent from the remote catalog',{skip:process.platform==='win32'},async()=>{
  const source=head+`console.log('RESULT',JSON.stringify(await pickModel({tools:[],currentModels:[{tool:'Editor',model:'vendor/removed-model'}]})));`;
  const out=await runPrompt(source,[[/Editor currently uses: vendor\/removed-model[^]*Type search/,'\x1b']],120,{rows:32});
  assert.match(out,/Editor currently uses: vendor\/removed-model/);
  assert.doesNotMatch(out,/current · Editor/);
});
