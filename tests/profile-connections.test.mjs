import {isolateHome} from './helpers/isolated-home.mjs';
import assert from 'node:assert/strict'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import test from 'node:test';
const home=fs.mkdtempSync(path.join(os.tmpdir(), 'profile-connections-'));isolateHome(home);
const { configManager } = await import('../dist/lib/config.js');
const { applyTool } = await import('../dist/lib/core/tool-service.js');
test.after(() => fs.rmSync(process.env.HOME, { recursive: true, force: true }));
test('profile selection, bindings and explicit connections resolve consistently', async () => {
 configManager.saveProfile('work', 'sk-work', 'china'); configManager.saveProfile('home', 'sk-home', 'custom', 'https://gateway.example/proxy');
 configManager.useProfile('work'); configManager.setToolProfile('demo', 'home');
 assert.equal(configManager.getConnection('demo').apiKey, 'sk-home');
 configManager.setApiKey('sk-work-new'); assert.equal(configManager.getProfile('work').apiKey, 'sk-work-new');
 let received; const tool = { name: 'demo', loadConfig: async (...args) => { received = args; } };
 assert.equal((await applyTool(tool)).status, 'success'); assert.equal(received[0], 'sk-home'); assert.equal(received[1], 'https://gateway.example/proxy');
 await applyTool(tool, { apiKey: 'explicit', baseUrl: 'https://explicit.example' }); assert.equal(received[0], 'explicit'); assert.equal(received[1], 'https://explicit.example');
 assert.throws(() => configManager.setToolProfile('demo', 'missing'));
 assert.throws(() => configManager.saveProfile('__proto__', 'bad', 'china'));
 configManager.removeProfile('home'); assert.equal(configManager.getToolProfile('demo'), undefined);
 configManager.reload(); assert.equal(configManager.getActiveProfile(), 'work');
});

const {isQiniuBaseUrl}=await import('../dist/lib/endpoints.js');
const {setupCommand}=await import('../dist/commands/setup.js');
const {toolManager}=await import('../dist/lib/tool-manager.js');
const {promptHelper}=await import('../dist/lib/wizard/ui/prompt-helper.js');
const {uiRenderer}=await import('../dist/lib/wizard/ui/ui-renderer.js');
const {marketModelService}=await import('../dist/lib/market-model-service.js');
const {modelService}=await import('../dist/lib/model-service.js');
test('setup probes each resolved connection and writes using the same key and URL',async t=>{
 configManager.clearConfig();
 configManager.saveProfile('a','private-a','custom','https://a.example/proxy');
 configManager.saveProfile('b','private-b','custom','https://b.example/proxy');
 const received=[];
 for(const name of ['a','b']) {
  configManager.setToolProfile(`probe-${name}`,name);
  toolManager.register({name:`probe-${name}`,displayName:name,loadConfig:async(key,url)=>received.push([key,url])});
 }
 const probes=[];t.mock.method(globalThis,'fetch',async(url,options)=>{
  probes.push([url,options.headers.Authorization]);
  return new Response(JSON.stringify(url.endsWith('/v1/models')?{data:[{id:'model'}]}:{choices:[]}));
 });
 const output=[];t.mock.method(console,'log',text=>output.push(text));
 const previous=process.exitCode;t.after(()=>{process.exitCode=previous;});
 await setupCommand({tools:'probe-a,probe-b',json:true});
 assert.equal(process.exitCode,0);
 assert.deepEqual(received,[['private-a','https://a.example/proxy'],['private-b','https://b.example/proxy']]);
 assert.equal(probes.length,4);
 for(const [url,key]of probes)assert.ok(key===`Bearer private-${new URL(url).hostname[0]}`);
 const json=JSON.parse(output[0]);assert.equal(json.accounts.length,2);
 assert.equal(output[0].includes('private-'),false);
});
test('bound adapter errors redact their resolved key before any renderer receives them',async()=>{
 configManager.setToolProfile('fails','a');
 const result=await applyTool({name:'fails',loadConfig:async key=>{throw Error(`bad YAML api_key: ${key}`);}});
 assert.equal(result.status,'failed');assert.equal(result.reason,'bad YAML api_key: [REDACTED]');
});
test('all credential-dependent model flows use the bound connection without a global key',async t=>{
 configManager.clearConfig();configManager.saveProfile('bound','bound-only','custom','https://models.example/proxy');
 for(const name of ['opencode','hermes','codebuddy','workbuddy','claude-code'])configManager.setToolProfile(name,'bound');
 for(const method of ['renderHeader','renderHint','renderSuccess','renderWarning'])t.mock.method(uiRenderer,method,()=>{});
 t.mock.method(promptHelper,'confirm',async()=>true);
 t.mock.method(promptHelper,'searchSelect',async()=> 'model');
 t.mock.method(promptHelper,'pickModel',async options=>{received.push([options.connection.baseUrl,options.connection.apiKey]);return {model:'model'};});
 t.mock.method(promptHelper,'checkbox',async()=> ['model']);
 const received=[];
 const fetch=async(url,key)=>{received.push([url,key]);return [{id:'model',name:'Model',features:[]}];};
 t.mock.method(marketModelService,'fetchModels',fetch);t.mock.method(modelService,'fetchModels',fetch);
 const {runGenericModelSelectionFlow}=await import('../dist/lib/wizard/flows/generic-model-selection-flow.js');
 assert.equal(await runGenericModelSelectionFlow('opencode','OpenCode'),'model');
 for(const [name,fn]of [['hermes','runHermesModelSelectionFlow'],['codebuddy','runCodeBuddyModelSelectionFlow'],['workbuddy','runWorkBuddyModelSelectionFlow']]){
  const module=await import(`../dist/lib/wizard/flows/${name}-model-selection-flow.js`);assert.ok(await module[fn]());
 }
 const {runModelSelectionFlow}=await import('../dist/lib/wizard/flows/model-selection-flow.js');assert.equal(await runModelSelectionFlow(),true);
 assert.equal(received.length,8);for(const connection of received)assert.deepEqual(connection,['https://models.example/proxy','bound-only']);
});
test('explicit quick-save clears successful bindings and active profile; revoke removes active stored key',()=>{
 configManager.clearConfig();configManager.saveProfile('work','old','china');configManager.saveProfile('home','bound','custom','https://bound.example');
 configManager.useProfile('work');configManager.setToolProfile('opencode','home');configManager.setToolProfile('grok','home');
 configManager.saveSettings('replacement','china',{}, {toolNames:['opencode']});
 assert.equal(configManager.getActiveProfile(),undefined);assert.equal(configManager.getConnection('opencode').apiKey,'replacement');assert.equal(configManager.getConnection('grok').apiKey,'bound');
 assert.equal(isQiniuBaseUrl('https://bound.example/v1'),true);
 configManager.useProfile('work');configManager.revokeApiKey();configManager.reload();
 assert.equal(configManager.getApiKey(),undefined);assert.equal(configManager.getProfile('work').apiKey,'');
 configManager.useProfile('work');assert.equal(!!configManager.getConnection().apiKey,false);
});

test('tool configuration details display the bound key and endpoint together',async t=>{
 configManager.clearConfig();configManager.setApiKey('global-key');configManager.setEndpoint('china');
 configManager.saveProfile('bound','private-bound-key','custom','https://details.example/proxy');configManager.setToolProfile('details','bound');
 for(const method of ['renderHeader','renderTitle'])t.mock.method(uiRenderer,method,()=>{});
 const items=[];t.mock.method(uiRenderer,'renderConfigItem',(label,value)=>items.push([label,value]));t.mock.method(promptHelper,'pressEnter',async()=>{});
 const {viewConfig}=await import('../dist/lib/wizard/menus/tool-menu.js');
 await viewConfig({name:'details',displayName:'Details',renderModelConfigSummary(){},isInstalled:()=>false,getVersion:()=>null});
 assert.equal(items[0][1],'https://details.example/proxy');assert.equal(items[1][1],uiRenderer.maskApiKey('private-bound-key'));
 assert.equal(JSON.stringify(items).includes('private-bound-key'),false);
});
