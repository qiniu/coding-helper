import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'tool-actions-'));process.env.HOME=process.env.USERPROFILE=home;
const {unloadToolConfig,updateTool}=await import('../dist/lib/wizard/menus/tool-menu.js');
const {promptHelper}=await import('../dist/lib/wizard/ui/prompt-helper.js');
const {uiRenderer}=await import('../dist/lib/wizard/ui/ui-renderer.js');
const {i18n}=await import('../dist/lib/i18n.js');
i18n.init('en_US');
function capture(){
  const names=['renderHeader','renderSuccess','renderError','renderHint'];const old=Object.fromEntries(names.map(n=>[n,uiRenderer[n]]));const messages=[];
  for(const n of names)uiRenderer[n]=(...args)=>messages.push([n,...args]);
  const confirm=promptHelper.confirm,enter=promptHelper.pressEnter;promptHelper.pressEnter=async()=>{};
  return {messages,restore(){Object.assign(uiRenderer,old);promptHelper.confirm=confirm;promptHelper.pressEnter=enter;}};
}
test('unload shows actionable legacy error and never reports successful removal',async()=>{
 const ui=capture();promptHelper.confirm=async()=>true;
 try{await unloadToolConfig({displayName:'Buddy',unloadConfig:async()=>{throw Error('No restoration record. Configuration is unchanged; remove legacy credentials manually.');}});
 assert.ok(ui.messages.some(([kind,text])=>kind==='renderError'&&text.includes('Configuration is unchanged')));assert.equal(ui.messages.some(([kind])=>kind==='renderSuccess'),false);
 }finally{ui.restore();}
});
test('cancelled unload performs no write',async()=>{
 const ui=capture();promptHelper.confirm=async()=>false;
 try{await unloadToolConfig({displayName:'Buddy',unloadConfig(){assert.fail('must not unload');}});}finally{ui.restore();}
});
