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
test('main menu reaches context flow and invalid input can be retried or cancelled',async t=>{
 for(const method of ['renderHeader','renderTitle','renderError'])t.mock.method(uiRenderer,method,()=>{});
 t.mock.method(toolManager,'getAll',()=>[{name:'opencode',isConfigured:()=>true}]);
 let selections=0;
 t.mock.method(promptHelper,'select',async(_message,items)=>{assert.ok(items.some(v=>v.value==='context'));return selections++?'exit':'context';});
 const inputs=['invalid',''];t.mock.method(promptHelper,'input',async()=>inputs.shift());
 await showMainMenu();
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
