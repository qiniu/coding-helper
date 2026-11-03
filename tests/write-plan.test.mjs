import assert from 'node:assert/strict'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import test from 'node:test';
import { isolateHome } from './helpers/isolated-home.mjs'; import { runPrompt } from './helpers/prompt-pty.mjs';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'write-plan-'));isolateHome(home);
const {configManager}=await import('../dist/lib/config.js');
const {safeWriteFile}=await import('../dist/lib/core/safe-write.js');
const {previewWritePlan,commitWritePlan}=await import('../dist/lib/wizard/ui/write-plan.js');
test.after(()=>fs.rmSync(home,{recursive:true,force:true}));
const file=path.join(home,'client/settings.json');
const tool={name:'demo',displayName:'Demo',supportsPreview:true,checkModel:async model=>model==='bad'?'incompatible':undefined,loadConfig:async(key,url,models)=>safeWriteFile(file,JSON.stringify({key,url,model:models.toolModels.demo}))};
const item={tool,main:'good',models:{toolModels:{demo:'good'}},changes:[],connection:{apiKey:'sk-captured',endpoint:'custom',baseUrl:'https://captured.example'}};
test('write-plan preview and rejected validation leave every real file unchanged',async()=>{
 const preview=await previewWritePlan([item]);assert.equal(preview.value[0].status,'success');assert.equal(preview.changes.length,1);assert.deepEqual(fs.readdirSync(home),[]);
 const results=await commitWritePlan([{...item,main:'bad'}]);assert.equal(results[0].status,'failed');assert.deepEqual(fs.readdirSync(home),[]);
});
test('write plan uses captured connection and persists only successful settings',async()=>{
 configManager.saveProfile('active','sk-current','china');configManager.useProfile('active');
 const results=await commitWritePlan([item,{...item,models:{toolModels:{failed:'failed-model'}},tool:{...tool,name:'failed',loadConfig:async()=>{throw Error('credential secret');}}}]);
 assert.deepEqual(results.map(r=>r.status),['success','failed']);assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).key,'sk-captured');
 assert.equal(configManager.getApiKey(),'sk-current');assert.equal(configManager.getActiveProfile(),'active');assert.equal(configManager.getModels().toolModels.demo,'good');assert.equal(configManager.getModels().toolModels.failed,undefined);
});
test('real PTY confirmation cancel leaves helper and clients untouched', {skip:process.platform==='win32'},async()=>{
 const out=await runPrompt(`import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {configManager} from './dist/lib/config.js';import {safeWriteFile} from './dist/lib/core/safe-write.js';import {confirmAndWrite} from './dist/lib/wizard/ui/write-plan.js';const file=path.join(os.homedir(),'client.json');const tool={name:'demo',displayName:'Demo',supportsPreview:true,loadConfig:async()=>safeWriteFile(file,'{"key":"sk-secret"}')};console.log('RESULT',await confirmAndWrite('CONFIRM_READY',[{tool,changes:[],connection:{apiKey:'sk-secret',endpoint:'china',baseUrl:'https://example.com'}}]));console.log('CLIENT',fs.existsSync(file));console.log('SAVED',fs.existsSync(configManager.configFile));`,[['CONFIRM_READY','\x1b']]);assert.match(out,/RESULT.*back/);assert.match(out,/CLIENT.*false/);assert.match(out,/SAVED.*false/);assert.equal(out.includes('sk-secret'),false);
});
test('unsupported preview retains its safe diagnostic and never invokes the writer',async()=>{
 let invoked=false;const unsupported={...tool,name:'unsupported',supportsPreview:false,loadConfig:async()=>{invoked=true}};
 const preview=await previewWritePlan([item,{...item,tool:unsupported}]);assert.equal(preview.value[1].reason,'setup_preview_unsupported');assert.equal(invoked,false);
});
test('completed slot plans can clear one override while retaining another',async()=>{
 configManager.setModels({slotModels:{demo:{review:'old',memory:'keep'}}});
 await commitWritePlan([{...item,models:{toolModels:{demo:'good'},slotModels:{demo:{memory:'keep'}}}}]);
 assert.deepEqual(configManager.getModels().slotModels.demo,{memory:'keep'});
});
test('invalid confirmation stays editable and commits only after a corrected preview', {skip:process.platform==='win32'},async()=>{
 const source=`import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {safeWriteFile,isPreview} from './dist/lib/core/safe-write.js';import {configManager} from './dist/lib/config.js';import {confirmAndWrite} from './dist/lib/wizard/ui/write-plan.js';const file=path.join(os.homedir(),'client.json');let writes=0;const tool={name:'demo',displayName:'Demo',supportsPreview:true,checkModel:async model=>model==='bad'?'incompatible':undefined,loadConfig:async()=>{if(!isPreview())writes++;safeWriteFile(file,'{}')}};const item={tool,main:'bad',changes:[],connection:{apiKey:'sk-fake',endpoint:'china',baseUrl:'https://example.com'}};const results=await confirmAndWrite('EDIT_READY',[item],[],{edit:async plan=>{console.log('BEFORE_EDIT',fs.existsSync(file),fs.existsSync(configManager.configFile));return {...plan,main:'good'};}});console.log('RESULT',JSON.stringify(results.map(r=>r.status)));console.log('WRITES',writes);`;
 const out=await runPrompt(source,[['Esc 返回','\x1b[A'.repeat(3)+'\r'],['Esc 返回','\x1b[A'.repeat(2)+'\r']]);assert.match(out,/BEFORE_EDIT false false/);assert.match(out,/RESULT.*\["success"\]/);assert.match(out,/WRITES 1/);
});
test('mixed preview failure never reports a completed write', {skip:process.platform==='win32'},async()=>{
 const source=`import {safeWriteFile} from './dist/lib/core/safe-write.js';import {confirmAndWrite} from './dist/lib/wizard/ui/write-plan.js';const connection={apiKey:'sk-fake',endpoint:'china',baseUrl:'https://example.com'};const good={name:'demo',displayName:'Demo',supportsPreview:true,loadConfig:async()=>safeWriteFile(process.env.HOME+'/client.json','{}')};const bad={name:'unsupported',displayName:'Unsupported',loadConfig:async()=>{throw Error('must not run')}};console.log('RESULT',await confirmAndWrite('MIX_READY',[{tool:good,changes:[],connection},{tool:bad,changes:[],connection}]));`;
 const out=await runPrompt(source,[['Esc 返回','\x1b']]);assert.doesNotMatch(out,/已写入 Demo|Configuration written to Demo/);assert.match(out,/RESULT.*back/);
});

test('confirmation without an editor has no inactive tool menu rows',{skip:process.platform==='win32'},async()=>{
 const source=`import {i18n} from './dist/lib/i18n.js';import {isPreview,safeWriteFile} from './dist/lib/core/safe-write.js';import {confirmAndWrite} from './dist/lib/wizard/ui/write-plan.js';i18n.init('en_US');let writes=0;const tool={name:'demo',displayName:'DEMO_ENTRY',supportsPreview:true,loadConfig:async()=>{if(!isPreview())writes++;safeWriteFile(process.env.HOME+'/client.json','{}');}};const results=await confirmAndWrite('NO_EDIT_READY',[{tool,changes:[{label:'Model',after:'new'}],connection:{apiKey:'fake',baseUrl:'https://example.com',endpoint:'china'}}]);console.log('WRITES',writes);`;
 const out=await runPrompt(source,[[/Confirm[\s\S]*?Esc back/,'\x1b[A\x1b[A\r']]);assert.match(out,/WRITES 1/);assert.doesNotMatch(out,/^[ \t]*(?:❯[ \t]*)?DEMO_ENTRY[ \t]*$/m);
});
test('tool names cannot collide with confirmation actions',{skip:process.platform==='win32'},async()=>{
 const source=`import {i18n} from './dist/lib/i18n.js';import {isPreview,safeWriteFile} from './dist/lib/core/safe-write.js';import {confirmAndWrite} from './dist/lib/wizard/ui/write-plan.js';i18n.init('en_US');let writes=0,edits=0;const tool={name:'write',displayName:'write',supportsPreview:true,loadConfig:async()=>{if(!isPreview())writes++;safeWriteFile(process.env.HOME+'/client.json','{}');}};await confirmAndWrite('CONTROL_READY',[{tool,changes:[],connection:{apiKey:'fake',baseUrl:'https://example.com',endpoint:'china'}}],[],{edit:async item=>{edits++;return item;}});console.log('COUNTS',writes,edits);`;
 const out=await runPrompt(source,[[/Confirm[\s\S]*?Esc back/,'\x1b[A\x1b[A\r']]);assert.match(out,/COUNTS 1 0/);
});
