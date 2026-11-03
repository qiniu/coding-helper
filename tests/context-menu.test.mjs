import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isolateHome } from './helpers/isolated-home.mjs';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'context-menu-'));isolateHome(home);
const {toolManager}=await import('../dist/lib/tool-manager.js');
const {runContextFlow}=await import('../dist/lib/wizard/flows/context-flow.js');
const {showMainMenu}=await import('../dist/lib/wizard/menus/main-menu.js');
const {promptHelper}=await import('../dist/lib/wizard/ui/prompt-helper.js');
const {uiRenderer}=await import('../dist/lib/wizard/ui/ui-renderer.js');
test.after(()=>fs.rmSync(home,{recursive:true,force:true}));
test('context flow invalid input can be retried or cancelled',async t=>{
 for(const method of ['renderHeader','renderTitle','renderError'])t.mock.method(uiRenderer,method,()=>{});
 t.mock.method(toolManager,'getAll',()=>[{name:'opencode',isConfigured:()=>true}]);
 const inputs=['invalid',''];t.mock.method(promptHelper,'input',async()=>inputs.shift());
 await runContextFlow();
 assert.equal(uiRenderer.renderError.mock.calls.length,1);assert.equal(inputs.length,0);
 assert.equal(fs.existsSync(path.join(home,'.coding-helper/config.yaml')),false);
});

test('empty or unsupported context targets show a hint before asking for input',async t=>{
 const hints=[];t.mock.method(uiRenderer,'renderHint',message=>hints.push(message));
 const enter=t.mock.method(promptHelper,'pressEnter',async()=>{});
 t.mock.method(promptHelper,'input',async()=>assert.fail('no context input without targets'));
 t.mock.method(promptHelper,'checkbox',async()=>assert.fail('no empty selector'));
 let tools=[];t.mock.method(toolManager,'getAll',()=>tools);
 await runContextFlow();
 tools=['claude-code','hermes','copilot'].map(name=>({name,isConfigured:()=>true,launchOnly:name==='copilot'}));
 await runContextFlow();
 assert.equal(hints.length,2);assert.equal(enter.mock.calls.length,2);
});

test('main menu More reaches context and returns after invalid input cancellation',{skip:process.platform==='win32'},async()=>{
 const {runPrompt}=await import('./helpers/prompt-pty.mjs');
 const source=`import fs from 'node:fs';import {configManager} from './dist/lib/config.js';import {i18n} from './dist/lib/i18n.js';configManager.setLang('en_US');i18n.init();const before=fs.readFileSync(configManager.configFile,'utf8');const {toolManager}=await import('./dist/lib/tool-manager.js');toolManager.getAll=()=>[{name:'opencode',displayName:'OpenCode',isConfigured:()=>true,isInstalled:()=>true}];const {showMainMenu}=await import('./dist/lib/wizard/menus/main-menu.js');await showMainMenu();console.log('UNCHANGED',fs.readFileSync(configManager.configFile,'utf8')===before);`;
 const out=await runPrompt(source,[['Select action','\x1b[B'.repeat(5)+'\r'],['Select action','\r'],['Context size (','invalid\r'],['Context size (','\x1b'],['Select action','\x1b'],['Select action','\x1b']]);assert.match(out,/UNCHANGED.*true/);assert.match(out,/invalid/);
});
test('completed context writes remain visible until acknowledged',{skip:process.platform==='win32'},async()=>{
 const {runPrompt}=await import('./helpers/prompt-pty.mjs');
 const source=`import {configManager} from './dist/lib/config.js';import {toolManager} from './dist/lib/tool-manager.js';import {safeWriteFile} from './dist/lib/core/safe-write.js';import {runContextFlow} from './dist/lib/wizard/flows/context-flow.js';configManager.setApiKey('fake');toolManager.getAll=()=>[{name:'opencode',displayName:'ContextTarget',supportsPreview:true,isConfigured:()=>true,loadConfig:async()=>safeWriteFile(process.env.HOME+'/client.json','{}')}];await runContextFlow();console.log('RESULT done');`;
 const out=await runPrompt(source,[['上下文大小','96k\r'],['选择要修改的工具','\r'],['确认写入','\x1b[A\x1b[A\r'],['按回车','\r']]);assert.match(out,/RESULT done/);assert.ok(out.indexOf('按回车')<out.indexOf('RESULT done'));
});
