import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'opencode-version-'));
process.env.HOME=process.env.USERPROFILE=home;
const {updateTool}=await import('../dist/lib/wizard/menus/tool-menu.js');
const {OpenCodeTool}=await import('../dist/lib/tools/opencode-tool.js');
const {promptHelper}=await import('../dist/lib/wizard/ui/prompt-helper.js');
const {uiRenderer}=await import('../dist/lib/wizard/ui/ui-renderer.js');
test('OpenCode update ignores an unsupported registry latest and shows the pinned command',async()=>{
 const {fetchLatestVersion}=await import('../dist/lib/version-service.js');
 const {i18n}=await import('../dist/lib/i18n.js');i18n.init('en_US');
 const tool=new OpenCodeTool();tool.isInstalled=()=>true;tool.getVersion=()=> '1.19.5';
 const fetch=globalThis.fetch,confirm=promptHelper.confirm,hint=uiRenderer.renderHint;let prompt;
 globalThis.fetch=async()=>({ok:true,json:async()=>({version:'2.0.0'})});uiRenderer.renderHint=()=>{};
 promptHelper.confirm=async text=>{prompt=text;return false;};
 try{
  assert.equal(tool.npmVersionMajor,1);
  assert.equal(await fetchLatestVersion('opencode-ai',1),null);
  assert.equal(await fetchLatestVersion('other'), '2.0.0');
  await updateTool(tool);assert.doesNotMatch(prompt,/2\.0\.0/);assert.match(prompt,/opencode-ai@1/);
  globalThis.fetch=async()=>({ok:true,json:async()=>({version:'1.20.0'})});
  assert.equal(await fetchLatestVersion('opencode-ai',1),'1.20.0');
 }finally{globalThis.fetch=fetch;promptHelper.confirm=confirm;uiRenderer.renderHint=hint;}
});
test('update menu refuses OpenCode v2 before prompting or executing npm', async()=>{
 const tool=new OpenCodeTool();tool.isInstalled=()=>true;tool.getVersion=()=> '2.0.0';
 const previous=uiRenderer.renderError,confirm=promptHelper.confirm,enter=promptHelper.pressEnter;const errors=[];let release;
 promptHelper.pressEnter=()=>new Promise(resolve=>{release=resolve;});
 uiRenderer.renderError=message=>errors.push(message);
 promptHelper.confirm=()=>{throw Error('must not prompt');};
 try{let done=false;const pending=updateTool(tool).then(()=>{done=true;});await Promise.resolve();assert.match(errors.join('\n'),/1.x only/);assert.equal(done,false);assert.equal(typeof release,'function');release();await pending;assert.equal(done,true);}
 finally{uiRenderer.renderError=previous;promptHelper.confirm=confirm;promptHelper.pressEnter=enter;}
});
