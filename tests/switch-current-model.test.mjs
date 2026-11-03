import assert from 'node:assert/strict';
import test from 'node:test';
import {runPrompt} from './helpers/prompt-pty.mjs';

// 走共享切换流程，当前值在选工具和搜索模型两页均可见；退出不修改客户端与 helper。
test('switch flow carries the selected tools current model into the picker',{skip:process.platform==='win32'},async()=>{
  const source=`import fs from 'node:fs';import assert from 'node:assert/strict';import {configManager} from './dist/lib/config.js';import {i18n} from './dist/lib/i18n.js';import {toolManager} from './dist/lib/tool-manager.js';import {marketModelService} from './dist/lib/market-model-service.js';import {runToolSetupFlow} from './dist/lib/wizard/flows/tool-setup-flow.js';i18n.init('en_US');configManager.setApiKey('fake');configManager.setModels({toolModels:{opencode:'vendor/z-current'}});const before=fs.readFileSync(configManager.configFile,'utf8');const tool=toolManager.get('opencode');tool.isInstalled=()=>true;tool.isConfigured=()=>true;let writes=0;tool.loadConfig=async()=>{writes++;};marketModelService.fetchModels=async()=>[{id:'vendor/a-new',features:['工具调用']},{id:'vendor/z-current',features:['工具调用']}];assert.equal(await runToolSetupFlow([tool],undefined,{showCurrentModels:true}),false);assert.equal(writes,0);assert.equal(fs.readFileSync(configManager.configFile,'utf8'),before);console.log('CANCEL_UNCHANGED');`;
  let frame;
  const out=await runPrompt(source,[
    [/Select tools[^]*vendor\/z-current[^]*Esc back/,'\r'],
    [/currently uses: vendor\/z-current[^]*Type search/,text=>{frame=text;return '\x1b';}],
    [/Select tools[^]*Esc back/,'\x1b'],
  ],130,{rows:36});
  assert.match(frame,/❯▪ +vendor\/z-current/);
  assert.match(out,/CANCEL_UNCHANGED/);
});
