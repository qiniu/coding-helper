import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import test from 'node:test';
import {isolateHome} from './helpers/isolated-home.mjs';import {runPrompt} from './helpers/prompt-pty.mjs';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'menu-review-'));isolateHome(home);test.after(()=>fs.rmSync(home,{recursive:true,force:true}));
const {configManager}=await import('../dist/lib/config.js');const {reloadPlanForTool}=await import('../dist/lib/wizard/menus/tool-menu.js');const {commitWritePlan}=await import('../dist/lib/wizard/ui/write-plan.js');
for(const [name,field] of [['codebuddy','codeBuddyModels'],['workbuddy','workbuddyModels']])test(name+' reload retains every saved model through helper persistence',async()=>{
 configManager.setModels({[field]:['vendor/a','vendor/b']});let written;
 const tool={name,displayName:name,supportsPreview:true,isConfigured:()=>true,loadConfig:async(_key,_url,models)=>{written=models[field];}};
 const plan=reloadPlanForTool(tool);plan.connection={apiKey:'fake',endpoint:'china',baseUrl:'https://example.com'};
 assert.match(plan.changes[0].after,/vendor\/a, vendor\/b/);assert.equal((await commitWritePlan([plan]))[0].status,'success');assert.deepEqual(written,['vendor/a','vendor/b']);assert.deepEqual(configManager.getModels()[field],written);
});
test('profile names matching control words can be activated',{skip:process.platform==='win32'},async()=>{
 for(const name of ['back','__add__','__back__']){
  const out=await runPrompt(`import {configManager} from './dist/lib/config.js';import {i18n} from './dist/lib/i18n.js';import {runProfileFlow} from './dist/lib/wizard/flows/profile-flow.js';configManager.setLang('en_US');i18n.init('en_US');configManager.saveProfile(${JSON.stringify(name)},'fake','china');await runProfileFlow();console.log('ACTIVE',configManager.getActiveProfile());`,[
   [/New profile[\s\S]*?Esc back/,'\r'],[/Use this profile[\s\S]*?Esc back/,'\r'],[/Switched to profile[\s\S]*?Press Enter/,'\r'],[/Test connection[\s\S]*?Esc back/,'\x1b'],[/New profile[\s\S]*?Esc back/,'\x1b']]);
  assert.ok(out.includes('ACTIVE '+name),out);
 }
});
test('unusable account diagnostics contain no unresolved template token',async()=>{
 const {i18n}=await import('../dist/lib/i18n.js');const {describeAccountStatus}=await import('../dist/lib/api-validator.js');for(const language of ['en_US','zh_CN']){i18n.init(language);assert.doesNotMatch(describeAccountStatus({usable:false,code:'http_401'}),/\{\{/);}
});
test('MiniMax load uses its normal writer instead of preview rejection',{skip:process.platform==='win32'},async()=>{
 const source=`import {configManager} from './dist/lib/config.js';import {promptHelper} from './dist/lib/wizard/ui/prompt-helper.js';import {showToolMenu} from './dist/lib/wizard/menus/tool-menu.js';configManager.setApiKey('fake');configManager.setModels({toolModels:{'minimax-code':'main'}});promptHelper.confirm=async()=>true;promptHelper.pressEnter=async()=>console.log('ACK_READY');let writes=0;const tool={name:'minimax-code',displayName:'MiniMax',supportsPreview:false,getVersion:()=>null,isInstalled:()=>true,runModelConfigFlow:async()=>true,loadConfig:async()=>{writes++;}};await showToolMenu(tool);console.log('WRITES',writes);`;
 const out=await runPrompt(source,[['请选择操作','\x1b[B\r'],['ACK_READY','\x1b']]);assert.match(out,/WRITES 1/);assert.doesNotMatch(out,/setup_preview_unsupported/);
});
test('restore menu includes journal targets whose client is no longer configured',{skip:process.platform==='win32'},async()=>{
 const source=`import {toolManager} from './dist/lib/tool-manager.js';import {stateStore} from './dist/lib/core/state-store.js';import {showMainMenu} from './dist/lib/wizard/menus/main-menu.js';toolManager.getAll=()=>[{name:'journal',displayName:'JournalOnly',isInstalled:()=>false,isConfigured:()=>false}];stateStore.getRecordedTools=()=>['journal'];await showMainMenu();console.log('RESULT done');`;
 const out=await runPrompt(source,[[/接入编码工具[\s\S]*?Esc 退出/,'\x1b[B'.repeat(5)+'\r'],[/1 个工具[\s\S]*?Esc 返回/,'\x1b[B\r'],[/JournalOnly[\s\S]*?Esc 返回/,'\x1b'],[/更多…[\s\S]*?Esc 返回/,'\x1b'],[/接入编码工具[\s\S]*?Esc 退出/,'\x1b']]);assert.match(out,/RESULT done/);
});
test('generic checkbox wrapper selects all unspecified preferences',{skip:process.platform==='win32'},async()=>{
 const out=await runPrompt(`import {promptHelper} from './dist/lib/wizard/ui/prompt-helper.js';console.log('RESULT',JSON.stringify(await promptHelper.checkbox('CHECK_READY',[{name:'Alpha',value:'a'},{name:'Beta',value:'b'}])));`,[['CHECK_READY','\x1b[A'],['❯ ☐',' '],['❯ ☑','\x1b[C']]);assert.match(out,/RESULT.*\["a","b"\]/);
});

test('switching models with no connected tools displays feedback until acknowledged',{skip:process.platform==='win32'},async()=>{
 const en=JSON.parse(fs.readFileSync(new URL('../src/locales/en_US.json',import.meta.url),'utf8'));
 const out=await runPrompt(`import {i18n} from './dist/lib/i18n.js';import {showMainMenu} from './dist/lib/wizard/menus/main-menu.js';i18n.init('en_US');await showMainMenu();console.log('RESULT done');`,[['Select action','\x1b[B\r'],[en.press_enter_to_continue,'\r'],['Select action','\x1b']]);assert.ok(out.includes(en.menu_switch_model_none));assert.match(out,/RESULT done/);
});

test('recoverable profile failures preserve the original session exit code after acknowledgement',{skip:process.platform==='win32'},async()=>{
 for(const code of ['undefined','0','2']){
  const out=await runPrompt(`import {configManager} from './dist/lib/config.js';import {i18n} from './dist/lib/i18n.js';import {runProfileFlow} from './dist/lib/wizard/flows/profile-flow.js';configManager.setLang('en_US');i18n.init('en_US');configManager.saveProfile('recoverable','fake','china');configManager.useProfile=()=>{throw new Error('private detail');};process.exitCode=${code};await runProfileFlow();console.log('EXIT',String(process.exitCode));process.exitCode=0;`,[
   [/New profile[\s\S]*?Esc back/,'\r'],[/Use this profile[\s\S]*?Esc back/,'\r'],[/Profile operation failed[\s\S]*?Press Enter/,'\r'],[/Test connection[\s\S]*?Esc back/,'\x1b'],[/New profile[\s\S]*?Esc back/,'\x1b']]);
  assert.match(out,new RegExp('EXIT '+code));assert.doesNotMatch(out,/private detail/);
 }
});
