import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import spawn from 'cross-spawn';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'launch-error-'));process.env.HOME=process.env.USERPROFILE=home;
const {launchTool}=await import('../dist/lib/wizard/menus/tool-menu.js');const {uiRenderer}=await import('../dist/lib/wizard/ui/ui-renderer.js');const {promptHelper}=await import('../dist/lib/wizard/ui/prompt-helper.js');
test('menu shows synchronous startup errors until acknowledgement',async()=>{
 const saved=spawn.sync,render=uiRenderer.renderError,enter=promptHelper.pressEnter;let message,ack=false;
 spawn.sync=()=>({error:Error('missing interpreter'),status:null});uiRenderer.renderError=text=>{message=text;};promptHelper.pressEnter=async()=>{ack=true;};
 try{await launchTool({command:'missing-test-client',displayName:'Test',installCommand:'unused',isInstalled:()=>true});assert.match(message,/missing interpreter/);assert.equal(ack,true);}
 finally{spawn.sync=saved;uiRenderer.renderError=render;promptHelper.pressEnter=enter;}
});
