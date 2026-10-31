import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {isolateHome} from './helpers/isolated-home.mjs';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'profile-command-'));isolateHome(home);
const {configManager}=await import('../dist/lib/config.js');
const {toolManager}=await import('../dist/lib/tool-manager.js');
const {profileUseCommand,profileAddCommand}=await import('../dist/commands/profile.js');
test.after(()=>{process.exitCode=undefined;fs.rmSync(home,{recursive:true,force:true});});
function prepare(t){
 configManager.clearConfig();configManager.saveProfile('work','work-key','china');configManager.saveProfile('home','home-key','international');configManager.useProfile('work');
 t.mock.method(console,'log',()=>{});t.mock.method(console,'error',()=>{});process.exitCode=0;
}
test('launch-only assignments save the selected connection and missing models fail explicitly',async t=>{
 prepare(t);await profileUseCommand('home','copilot');
 assert.equal(configManager.getConnection('copilot').apiKey,'home-key');assert.equal(process.exitCode,0);
 await profileUseCommand('home','opencode');assert.equal(process.exitCode,1);assert.equal(configManager.getToolProfile('opencode'),undefined);
 process.exitCode=0;await profileUseCommand('home','copilot,opencode');assert.equal(process.exitCode,2);
});
test('explicit empty selectors and empty custom URLs fail before changing state or requesting credentials',async t=>{
 prepare(t);configManager.setToolProfile('copilot','home');
 const before=fs.readFileSync(configManager.configFile,'utf8');
 t.mock.method(globalThis,'fetch',async()=>assert.fail('must not send a credential'));
 for(const tools of ['', ' ', ',']){await profileUseCommand('home',tools);assert.equal(process.exitCode,1);assert.equal(fs.readFileSync(configManager.configFile,'utf8'),before);}
 for(const baseUrl of ['', ' ']){await profileAddCommand('bad','secret',{baseUrl});assert.equal(process.exitCode,1);assert.equal(fs.readFileSync(configManager.configFile,'utf8'),before);}
});
test('saving an explicitly selected active profile repairs legacy missing top-level credentials',t=>{
 prepare(t);const text=fs.readFileSync(configManager.configFile,'utf8');
 fs.writeFileSync(configManager.configFile,text.replace(/^api_key:.*\n/m,''));configManager.reload();assert.equal(configManager.getApiKey(),undefined);
 configManager.saveSettings('work-key','china',{}, {toolNames:['opencode'],profile:'work'});
 configManager.reload();assert.equal(configManager.getConnection('opencode').apiKey,'work-key');assert.equal(configManager.getActiveProfile(),'work');
 configManager.setEndpoint('custom','https://current.example/proxy');
 configManager.saveSettings('home-key','international',{}, {toolNames:['copilot'],profile:'home',baseUrl:'https://api.modelink.ai'});
 configManager.reload();assert.equal(configManager.baseUrl,'https://current.example/proxy');assert.equal(configManager.getConnection('copilot').apiKey,'home-key');
});
test('a revoked profile cannot be reused to resurrect its key',async t=>{
 prepare(t);configManager.revokeApiKey();const before=fs.readFileSync(configManager.configFile,'utf8');
 await profileUseCommand('work','copilot');assert.equal(process.exitCode,1);assert.equal(fs.readFileSync(configManager.configFile,'utf8'),before);
});

test('adding a profile without --use preserves an existing unnamed connection and tool bindings',async t=>{
 prepare(t);configManager.setToolProfile('copilot','home');
 configManager.saveSettings('legacy-key','china',{}, {toolNames:['opencode']});
 assert.equal(configManager.getActiveProfile(),undefined);
 t.mock.method(globalThis,'fetch',async()=>new Response('{}'));
 await profileAddCommand('new','new-key');
 assert.equal(process.exitCode,0);assert.equal(configManager.getActiveProfile(),undefined);
 assert.equal(configManager.getConnection('opencode').apiKey,'legacy-key');assert.equal(configManager.getToolProfile('copilot'),'home');
 await profileAddCommand('new','new-key',{use:true});assert.equal(configManager.getActiveProfile(),'new');assert.equal(configManager.getConnection().apiKey,'new-key');
});

test('quick @revoked rejects interactive and JSON requests before prompting or network access',async t=>{
 prepare(t);configManager.revokeApiKey();const before=fs.readFileSync(configManager.configFile,'utf8');
 const {quickCommand}=await import('../dist/commands/quick.js');
 const {promptHelper}=await import('../dist/lib/wizard/ui/prompt-helper.js');
 const {uiRenderer}=await import('../dist/lib/wizard/ui/ui-renderer.js');
 const descriptors=[process.stdin,process.stdout].map(stream=>Object.getOwnPropertyDescriptor(stream,'isTTY'));
 for(const stream of [process.stdin,process.stdout])Object.defineProperty(stream,'isTTY',{value:true,configurable:true});
 t.after(()=>{[process.stdin,process.stdout].forEach((stream,i)=>{if(descriptors[i])Object.defineProperty(stream,'isTTY',descriptors[i]);else delete stream.isTTY;});});
 t.mock.method(promptHelper,'password',async()=>assert.fail('revoked profile must not prompt for another key'));
 t.mock.method(globalThis,'fetch',async()=>assert.fail('revoked profile must not send requests'));
 t.mock.method(uiRenderer,'renderError',()=>{});
 for(const json of [false,true]){
  process.exitCode=0;await quickCommand('opencode',['@work'],{json});assert.equal(process.exitCode,1);
  assert.equal(fs.readFileSync(configManager.configFile,'utf8'),before);assert.equal(fs.existsSync(path.join(home,'.config/opencode/opencode.json')),false);
 }
});
