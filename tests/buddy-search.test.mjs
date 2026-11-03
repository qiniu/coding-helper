import assert from 'node:assert/strict';
import test from 'node:test';
import {runPrompt} from './helpers/prompt-pty.mjs';
import {pty,head,frame} from './helpers/buddy-search-fixture.mjs';
import {stripAnsi} from '../dist/utils/string-width.js';
for(const tool of ['codebuddy','workbuddy']){
 test(`${tool} tool details open the same search and write the complete model set`,pty,async()=>{
  const source=head(tool,['alpha/one'])+`import {showToolMenu} from './dist/lib/wizard/menus/tool-menu.js';import {promptHelper} from './dist/lib/wizard/ui/prompt-helper.js';import {safeWriteFile,isPreview} from './dist/lib/core/safe-write.js';const tool=toolManager.get(name);tool.isInstalled=()=>true;tool.isConfigured=()=>true;tool.getVersion=()=>null;tool.npmPackageName=undefined;let writes=0;tool.loadConfig=async(key,url,models)=>{if(!isPreview())writes++;safeWriteFile(process.env.HOME+'/client.json',JSON.stringify(models));};promptHelper.pressEnter=async()=>console.log('WRITE_ACK');await showToolMenu(tool);assert.equal(writes,1);assert.deepEqual(JSON.parse(fs.readFileSync(process.env.HOME+'/client.json','utf8'))[field],['alpha/one','beta/two']);assert.deepEqual(configManager.getModels()[field],['alpha/one','beta/two']);console.log('MENU_OK');`;
  const out=await runPrompt(source,[[/Select action[^]*Esc back/,'\r'],[/Currently configured: alpha\/one[^]*Type search/,'beta/two\r'],[/Selected 2:[^]*Type search/,'\r'],[/\? Confirm[^]*Esc back/,'\r'],[/WRITE_ACK[^]*Select action[^]*Esc back/,'\x1b']],120,{rows:42});assert.match(out,/MENU_OK/);
 });
}
test('resize retains the selected model basket and the next search',pty,async()=>{
 const source=head('codebuddy')+`const listeners=process.stdout.listenerCount('resize');assert.deepEqual(await select(),['alpha/one','beta/two']);assert.equal(process.stdout.listenerCount('resize'),listeners);console.log('RESIZE_OK');`;
 const raw=await runPrompt(source,[[frame,'alpha/one\r'],[/Selected 1:[^]*Type search/,'beta/two'],[/⌕ beta\/two[^]*Type search/,{resize:{columns:60,rows:24}}],[/Selected 1:[^]*⌕ beta\/two[^]*Type search/,'\r'],[/Selected 2:[^]*Type search/,'\t']],120,{rows:42,raw:true});
 assert.match(stripAnsi(raw),/RESIZE_OK/);assert.match(raw.slice(raw.lastIndexOf('\x1Bc')),/alpha\/one/);
});

test('confirmation edit preserves all draft models and the captured connection',pty,async()=>{
 const source=head('workbuddy',['alpha/one'])+`import {editToolModels} from './dist/lib/wizard/flows/model-slots-flow.js';const tool=toolManager.get(name);const plan=await editToolModels(tool);assert.deepEqual(plan.models[field],['alpha/one','beta/two']);configManager.setEndpoint('international');const revised=await editToolModels(tool,plan);assert.deepEqual(revised.models[field],plan.models[field]);assert.equal(revised.connection.baseUrl,plan.connection.baseUrl);console.log('DRAFT_OK');`;
 const out=await runPrompt(source,[[frame,'beta/two\r'],[/Selected 2:[^]*Type search/,'\r'],[/Currently configured: alpha\/one[^]*Selected 2:[^]*Type search/,'\r']],120,{rows:42});assert.match(out,/DRAFT_OK/);
});
