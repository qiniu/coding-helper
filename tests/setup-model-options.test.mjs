import assert from 'node:assert/strict';
import test from 'node:test';
import { runPrompt } from './helpers/prompt-pty.mjs';

const head = name => `import fs from 'node:fs';import assert from 'node:assert/strict';import {configManager} from './dist/lib/config.js';import {i18n} from './dist/lib/i18n.js';import {toolManager} from './dist/lib/tool-manager.js';import {marketModelService} from './dist/lib/market-model-service.js';import {runToolSetupFlow} from './dist/lib/wizard/flows/tool-setup-flow.js';import {safeWriteFile,isPreview} from './dist/lib/core/safe-write.js';i18n.init('en_US');configManager.setApiKey('fake');const tool=toolManager.get('${name}');tool.isInstalled=()=>true;tool.isConfigured=()=>false;tool.checkModel=async()=>undefined;let writes=0;tool.loadConfig=async(key,url,models)=>{if(!isPreview())writes++;safeWriteFile(process.env.HOME+'/client.json',JSON.stringify(models));};const before=fs.readFileSync(configManager.configFile,'utf8');`;

test('first-use setup can select built-in models before fetching any catalog', {skip:process.platform==='win32'}, async () => {
  const source=head('claude-code')+`marketModelService.fetchModels=async()=>assert.fail('built-in models must not fetch the catalog');const result=await runToolSetupFlow([tool]);assert.equal(result,true);assert.equal(writes,1);const models=JSON.parse(fs.readFileSync(process.env.HOME+'/client.json','utf8'));assert.deepEqual(models.claudeCode,{useDefaultModels:true});assert.deepEqual(configManager.getModels().claudeCode,{useDefaultModels:true});console.log('BUILTIN_OK');`;
  const out=await runPrompt(source,[
    [/Select tools[^]*Esc back/,'\r'],
    [/Use Claude Code's built-in models[^]*Esc back/,'\x1b[F\x1b[A\r'],
    [/Using Claude Code's built-in models[^]*Esc back/,'\r'],
    [/\? Confirm[^]*Esc back/,'\r'],
    [/Press Enter/,'\r'],
  ],110,{rows:40});
  assert.match(out,/BUILTIN_OK/);
});

for(const [name,field] of [['codebuddy','codeBuddyModels'],['workbuddy','workbuddyModels']]) {
  test(`first-use ${name} setup preserves multiple models through confirmation and persistence`,{skip:process.platform==='win32'},async()=>{
    const source=head(name)+`marketModelService.fetchModels=async()=>[{id:'a/model',name:'Model A',features:['工具调用']},{id:'b/model',name:'Model B',features:['工具调用']}];const result=await runToolSetupFlow([tool]);assert.equal(result,true);assert.equal(writes,1);assert.deepEqual(JSON.parse(fs.readFileSync(process.env.HOME+'/client.json','utf8')).${field},['a/model','b/model']);assert.deepEqual(configManager.getModels().${field},['a/model','b/model']);console.log('MULTI_OK');`;
    const out=await runPrompt(source,[
      [/Select tools[^]*Esc back/,'\r'],
      [/Select models to configure[^]*Type search/,'a/model\r'],
      [/Selected 1:[^]*Type search/,'b/model\r'],
      [/Selected 2:[^]*Type search/,'\r'],
      [/\? Confirm[^]*Esc back/,'\r'],
      [/Press Enter/,'\r'],
    ],110,{rows:40});
    assert.match(out,/MULTI_OK/);
  });
}

test('cancelling first-use multi-model selection saves neither client nor helper settings',{skip:process.platform==='win32'},async()=>{
  const source=head('codebuddy')+`marketModelService.fetchModels=async()=>[{id:'a/model',name:'Model A',features:['工具调用']}];assert.equal(await runToolSetupFlow([tool]),false);assert.equal(writes,0);assert.equal(fs.existsSync(process.env.HOME+'/client.json'),false);assert.equal(fs.readFileSync(configManager.configFile,'utf8'),before);console.log('CANCEL_OK');`;
  const out=await runPrompt(source,[[/Select tools[^]*Esc back/,'\r'],[/Select models to configure[^]*Esc back/,'\x1b'],[/Select tools[^]*Esc back/,'\x1b']],110,{rows:40});
  assert.match(out,/CANCEL_OK/);
});
