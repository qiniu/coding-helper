import test from 'node:test';import assert from 'node:assert/strict';import {runPrompt} from './helpers/prompt-pty.mjs';
const source=`import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {configManager} from './dist/lib/config.js';import {i18n} from './dist/lib/i18n.js';import {toolManager} from './dist/lib/tool-manager.js';import {showToolMenu} from './dist/lib/wizard/menus/tool-menu.js';configManager.setLang('en_US');configManager.setApiKey('fixture-key');i18n.init();globalThis.fetch=async()=>new Response(JSON.stringify({status:true,data:[{id:'z-ai/glm-5.2',name:'GLM',features:['工具调用'],model_constraints:{context_length:1000000,max_tokens:128000}}]}));const tool=toolManager.get('dsh');`;
const start=[[/Configure Models[\s\S]*?Esc back/,'\r'],[/Main model[\s\S]*?Esc back/,'\r'],[/Type to search[\s\S]*?Type search/,'z-ai/glm-5.2\r']];
test('DSH tool menu stages a model and saves only after write confirmation',{skip:process.platform==='win32'},async()=>{
 const out=await runPrompt(source+`await showToolMenu(tool);assert.equal(configManager.getModels().toolModels.dsh,'z-ai/glm-5.2');assert.equal(tool.isConfigured(),true);console.log('VERIFIED dsh write');`,[...start,[/Main model[\s\S]*?Esc back/,'\r'],[/\? Confirm[\s\S]*?Esc back/,'\r'],[/Press Enter/,'\r'],[/Configure Models[\s\S]*?Esc back/,'\x1b']],110,{rows:40});assert.match(out,/VERIFIED dsh write/);
});
test('DSH staged model cancellation returns to the tool menu with no client or model saved',{skip:process.platform==='win32'},async()=>{
 const out=await runPrompt(source+`await showToolMenu(tool);assert.equal(configManager.getModels().toolModels?.dsh,undefined);assert.equal(fs.existsSync(process.env.HOME+'/.dsh'),false);console.log('VERIFIED dsh cancel');`,[...start,[/Main model[\s\S]*?Esc back/,'\x1b'],[/Configure Models[\s\S]*?Esc back/,'\x1b']],110,{rows:40});assert.match(out,/VERIFIED dsh cancel/);
});
test('DSH starts from an empty HOME and completes the full first-use wizard',{skip:process.platform==='win32'},async()=>{
 const selectDsh=text=>{
  const screen=text.slice(text.lastIndexOf('? Select tools'));
  const rows=screen.split('\n').filter(line=>/[☐☑] [●○] /.test(line));
  const index=rows.findIndex(line=>line.includes('DeepSeek Harness'));
  assert.ok(index>=0,'DSH must be visible in the actual installed-first list');
  return '\x1b[B'.repeat(index)+' '+'\x1b[C';
 };
 const out=await runPrompt(source+`import {Wizard} from './dist/lib/wizard/wizard.js';configManager.clearConfig();i18n.init();assert.equal(fs.existsSync(configManager.configFile),false);const done=await new Wizard().runInitWizard();assert.equal(done,true);configManager.reload();assert.equal(configManager.getModels().toolModels.dsh,'z-ai/glm-5.2');assert.equal(tool.isConfigured(),true);console.log('VERIFIED dsh first run');`,[
  [/请选择语言[\s\S]*?Esc 返回/,'\x1b[B\r'],[/Select API endpoint[\s\S]*?Esc back/,'\x1b[B\r'],[/Enter your API Key[\s\S]*?Esc back/,'fixture-key\r'],[/Select tools[\s\S]*?Esc back/,selectDsh],[/Type to search[\s\S]*?Type search/,'z-ai/glm-5.2\r'],[/\? Confirm[\s\S]*?Esc back/,'\r'],[/Press Enter/,'\r'],
 ],110,{rows:40});assert.match(out,/VERIFIED dsh first run/);
});
for(const save of [true,false])test('DSH quick configuration recommends dsh web with save='+save,{skip:process.platform==='win32'},async()=>{
 const out=await runPrompt(source+`tool.isInstalled=()=>true;import {quickCommand} from './dist/commands/quick.js';await quickCommand('dsh',['z-ai/glm-5.2'],{save:${save}});assert.equal(process.exitCode,0);assert.equal(tool.isConfigured(),true);assert.equal(configManager.getModels().toolModels?.dsh,${save?"'z-ai/glm-5.2'":"undefined"});console.log('VERIFIED dsh quick hint');`,[],110,{rows:40});assert.match(out,/Start the tool: dsh web/);assert.match(out,/VERIFIED dsh quick hint/);
});

for(const save of [true,false])test('Desktop-only DSH quick configuration recommends restart with save='+save,{skip:process.platform==='win32'},async()=>{
 const out=await runPrompt(source+`const desktop=path.join(process.env.HOME,'.dsh/profiles/desktop');fs.mkdirSync(desktop,{recursive:true});fs.writeFileSync(path.join(desktop,'package.json'),JSON.stringify({name:'dsh-profile-desktop',dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']}}}));tool.searchPaths=[];tool.command='missing-dsh-fixture';assert.equal(tool.isInstalled(),null);const {quickCommand}=await import('./dist/commands/quick.js');await quickCommand('dsh',['z-ai/glm-5.2'],{save:${save}});assert.equal(process.exitCode,0);assert.equal(tool.isConfigured(),true);assert.equal(configManager.getModels().toolModels?.dsh,${save?"'z-ai/glm-5.2'":"undefined"});console.log('DESKTOP_QUICK_OK');`,[],110,{rows:40});
 assert.match(out,/DESKTOP_QUICK_OK/);assert.match(out,/Restart Desktop, choose the desktop profile/);assert.match(out,/restart DeepSeek Harness/i);assert.doesNotMatch(out,/Start the tool:.*(?:dsh web|missing-dsh-fixture)/);
});
