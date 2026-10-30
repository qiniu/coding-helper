import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'tool-actions-'));process.env.HOME=process.env.USERPROFILE=home;
const {updateTool}=await import('../dist/lib/wizard/menus/tool-menu.js');
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
test('unversioned update displays exact command and cancellation never runs it',async()=>{
 const ui=capture();const marker=path.join(home,'should-not-exist');const command='touch '+marker;let confirmed=false;
 promptHelper.confirm=async(message,defaultValue)=>{assert.ok(message.includes(command));assert.equal(defaultValue,false);confirmed=true;return false;};
 try{await updateTool({displayName:'Installer tool',command:'demo',installCommand:command,isInstalled:()=>true,getVersion:()=>null});assert.equal(confirmed,true);assert.equal(fs.existsSync(marker),false);assert.ok(ui.messages.some(([kind,text])=>kind==='renderHint'&&text===command));}finally{ui.restore();}
});
