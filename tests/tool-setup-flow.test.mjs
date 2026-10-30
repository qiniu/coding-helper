import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
process.env.HOME=process.env.USERPROFILE=fs.mkdtempSync(os.tmpdir()+'/setup-flow-');
const {setupTool}=await import('../dist/lib/wizard/flows/tool-setup-flow.js');
const {promptHelper}=await import('../dist/lib/wizard/ui/prompt-helper.js');
const {uiRenderer}=await import('../dist/lib/wizard/ui/ui-renderer.js');
const {configManager}=await import('../dist/lib/config.js');
const {i18n}=await import('../dist/lib/i18n.js');
test('auth reload for a launch-only extension never calls the configuration writer',async()=>{
 const {authCommand}=await import('../dist/commands/auth.js');const {toolManager}=await import('../dist/lib/tool-manager.js');
 const originalArgs=process.argv,hint=uiRenderer.renderHint;let shown=false;
 toolManager.register({name:'launch-only-test',displayName:'Test',launchOnly:true,loadConfig:()=>assert.fail('must not write')});
 process.argv=['node','helper','auth','reload','launch-only-test'];uiRenderer.renderHint=()=>{shown=true;};
 try{await authCommand('reload');assert.equal(shown,true);}finally{process.argv=originalArgs;uiRenderer.renderHint=hint;}
});
test('launch-only initialization reports ready without attempting config writes',async()=>{
 const get=configManager.getApiKey,enter=promptHelper.pressEnter;const names=['renderHeader','renderHint','renderSuccess','renderError'];const originals=Object.fromEntries(names.map(n=>[n,uiRenderer[n]]));const messages=[];
 for(const name of names)uiRenderer[name]=value=>messages.push([name,value]);configManager.getApiKey=()=> 'test-token';promptHelper.pressEnter=async()=>{};
 try{for(const lang of ['en_US','zh_CN']){i18n.init(lang);messages.length=0;await setupTool({displayName:'GitHub Copilot CLI',name:'copilot',launchOnly:true,runModelConfigFlow:async()=>true,loadConfig:async()=>assert.fail('must not load')});assert.ok(messages.some(([kind,value])=>kind==='renderHint'&&value.includes('coding-helper run')));assert.ok(messages.some(([kind])=>kind==='renderSuccess'));assert.equal(messages.some(([kind])=>kind==='renderError'),false);}
 messages.length=0;await setupTool({launchOnly:true,runModelConfigFlow:async()=>false});assert.equal(messages.length,0);
 }finally{Object.assign(uiRenderer,originals);configManager.getApiKey=get;promptHelper.pressEnter=enter;}
});
