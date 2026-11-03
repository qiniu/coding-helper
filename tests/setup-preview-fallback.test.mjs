import assert from 'node:assert/strict';import test from 'node:test';import {runPrompt} from './helpers/prompt-pty.mjs';
const source=`import {configManager} from './dist/lib/config.js';import {toolManager} from './dist/lib/tool-manager.js';import {marketModelService} from './dist/lib/market-model-service.js';import {promptHelper} from './dist/lib/wizard/ui/prompt-helper.js';import {safeWriteFile,isPreview} from './dist/lib/core/safe-write.js';import {runToolSetupFlow} from './dist/lib/wizard/flows/tool-setup-flow.js';configManager.setApiKey('fake');promptHelper.pressEnter=async()=>{};marketModelService.fetchModels=async()=>[{id:'good',name:'Good',features:['工具调用']}];const count={safe:0,normal:0};const normal={name:'minimax-code',displayName:'MiniMax',supportsPreview:false,runModelConfigFlow:async()=>true,loadConfig:async()=>{count.normal++;}};const safe={name:'opencode',displayName:'OpenCode',supportsPreview:true,loadConfig:async()=>{if(!isPreview())count.safe++;safeWriteFile(process.env.HOME+'/safe.json','{}');}};`;
test('initial setup sends unsupported writers through the normal flow',{skip:process.platform==='win32'},async()=>{
 const out=await runPrompt(source+`toolManager.getAll=()=>[normal];await runToolSetupFlow();console.log('RESULT',JSON.stringify(count));`,[['选择要配置的工具','\r']]);assert.match(out,/RESULT.*"safe":0,"normal":1/);
});
test('mixed initial setup commits safe tools and separately configures unsupported writers',{skip:process.platform==='win32'},async()=>{
 const out=await runPrompt(source+`toolManager.getAll=()=>[safe,normal];await runToolSetupFlow();console.log('RESULT',JSON.stringify(count));`,[['选择要配置的工具','\x1b[A '],['❯ ☑','\x1b[C'],['←→','\r'],['确认写入','\x1b[A\x1b[A\r']]);assert.match(out,/RESULT.*"safe":1,"normal":1/);
});

test('cancelling an individual fallback reports the setup as cancelled',{skip:process.platform==='win32'},async()=>{
 const out=await runPrompt(source+`normal.runModelConfigFlow=async()=>false;toolManager.getAll=()=>[normal];const completed=await runToolSetupFlow();console.log('RESULT',completed,JSON.stringify(count));`,[['选择要配置的工具','\r']]);assert.match(out,/RESULT false.*"safe":0,"normal":0/);
});

// 首次仅选择 Copilot 也应完成初始化，且不调用持久配置 writer。
test('initial setup keeps Copilot selectable and reports launcher readiness without writing',{skip:process.platform==='win32'},async()=>{
 const out=await runPrompt(source+`const copilot=toolManager.get('copilot');let models=0,writes=0;copilot.runModelConfigFlow=async()=>{models++;return true;};copilot.loadConfig=async()=>{writes++;throw new Error('must not write');};toolManager.getAll=()=>[copilot];const completed=await runToolSetupFlow();console.log('RESULT',JSON.stringify({completed,models,writes}));`,[[/选择要配置的工具[\s\S]*GitHub Copilot CLI[\s\S]*Esc 返回/,'\r']]);
 assert.match(out,/coding-helper run copilot/);assert.match(out,/RESULT.*"completed":true,"models":1,"writes":0/);
});
