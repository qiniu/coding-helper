import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {isolateHome} from './helpers/isolated-home.mjs';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'rebaseline-failure-'));isolateHome(home);
const {ClaudeCodeTool}=await import('../dist/lib/tools/claude-code-tool.js');
const {stateStore}=await import('../dist/lib/core/state-store.js');
const {applyTool}=await import('../dist/lib/core/tool-service.js');
const {safeToolFailureReason}=await import('../dist/lib/wizard/ui/tool-results.js');
const {isExternallyModified}=await import('../dist/lib/core/rebaseline.js');
const {backupsRoot,previewWrites}=await import('../dist/lib/core/safe-write.js');
const tool=new ClaudeCodeTool(),file=path.join(home,'.claude/settings.json');
const connection={apiKey:'fixture-new',baseUrl:'https://api.qnaigc.com',models:{claudeCode:{sonnetModel:'vendor/main'}}};
async function switched(){
 stateStore.clear();fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'{"env":{"KEEP":"original"}}\n');
 await tool.loadConfig('fixture-old',connection.baseUrl,connection.models);
 const config=JSON.parse(fs.readFileSync(file,'utf8'));Object.assign(config.env,{ANTHROPIC_BASE_URL:'https://external.example/anthropic',ANTHROPIC_AUTH_TOKEN:'external-fixture'});fs.writeFileSync(file,JSON.stringify(config));
 assert.equal(isExternallyModified(tool),true);
 return {content:fs.readFileSync(file,'utf8'),records:stateStore.getFileStates(tool.name)};
}
test.after(()=>fs.rmSync(home,{recursive:true,force:true}));
test('failed rebaseline load preserves existing recovery records and unrelated new records',async t=>{
 const before=await switched();t.mock.method(tool,'loadConfig',async()=>{stateStore.setState('other',{priors:{keep:'other'}});throw Error('permission denied');});
 const result=await applyTool(tool,connection);assert.equal(result.status,'failed');assert.match(result.reason,/permission denied/);
 assert.deepEqual(stateStore.getFileStates(tool.name),before.records);assert.deepEqual(stateStore.getState('other'),{priors:{keep:'other'}});assert.equal(fs.readFileSync(file,'utf8'),before.content);
});
test('symlink rejection preserves recovery records and a repaired path can retry and restore', {skip:process.platform==='win32'},async()=>{
 const before=await switched(),target=file+'.target';fs.renameSync(file,target);fs.symlinkSync(target,file);
 try{
  const result=await applyTool(tool,connection);assert.equal(result.status,'failed');assert.deepEqual(stateStore.getFileStates(tool.name),before.records);assert.equal(fs.readFileSync(target,'utf8'),before.content);assert.ok(fs.lstatSync(file).isSymbolicLink());
 }finally{fs.unlinkSync(file);fs.renameSync(target,file);}
 assert.equal((await applyTool(tool,connection)).status,'success');await tool.unloadConfig();assert.equal(fs.readFileSync(file,'utf8'),before.content);
});
test('failed legacy rebaseline restores the complete original legacy record',async()=>{
 stateStore.clear();const fake={name:'legacy-fixture',isConfigured:()=>false,loadConfig:async()=>{throw Error('load failed');}};const record={priors:{route:'legacy'},applied:{keep:'snapshot'}};stateStore.setState(fake.name,record);
 assert.equal((await applyTool(fake,connection)).status,'failed');assert.deepEqual(stateStore.getState(fake.name),record);
});
test('failed load keeps the new partial-write journal instead of overwriting it with old records',async t=>{
 await switched();const fresh={priors:{keep:'new-baseline'},pending:{before:'external',after:'partial',applied:{keep:'new-applied'}}};
 t.mock.method(tool,'loadConfig',async()=>{stateStore.setState(tool.name,fresh,file);fs.writeFileSync(file,'partial');throw Error('interrupted write');});
 assert.equal((await applyTool(tool,connection)).status,'failed');assert.deepEqual(stateStore.getState(tool.name,file),fresh);assert.equal(fs.readFileSync(file,'utf8'),'partial');
});
test('concurrent file changes without a new journal request archive recovery instead of restoring stale records',async t=>{
 await switched();t.mock.method(tool,'loadConfig',async()=>{fs.writeFileSync(file,'concurrent edit');throw Error('load failed');});
 const result=await applyTool(tool,connection);assert.equal(result.status,'failed');assert.equal(result.reason,'rebaseline_recovery_failed');assert.equal(safeToolFailureReason(result.reason),result.reason);assert.equal(fs.readFileSync(file,'utf8'),'concurrent edit');assert.deepEqual(stateStore.getFileStates(tool.name),[]);
});
test('failure to restore recovery records reports a safe recovery error and retains the archive',async t=>{
 await switched();const before=new Set(fs.readdirSync(backupsRoot()));t.mock.method(tool,'loadConfig',async()=>{throw Error('load failed');});t.mock.method(stateStore,'restoreToolRecords',()=>{throw Error('private storage error');});
 const result=await applyTool(tool,connection);assert.equal(result.status,'failed');assert.equal(result.reason,'rebaseline_recovery_failed');assert.equal(safeToolFailureReason(result.reason),result.reason);assert.ok(fs.readdirSync(backupsRoot()).some(name=>!before.has(name)&&name.startsWith('rebaseline-')));
});
test('failed rebaseline preview leaves files, journals and archive directories unchanged',async t=>{
 const before=await switched(),state=path.join(home,'.coding-helper/state.json'),saved=fs.readFileSync(state,'utf8'),archives=fs.readdirSync(backupsRoot());t.mock.method(tool,'loadConfig',async()=>{throw Error('load failed');});
 await previewWrites(async()=>assert.equal((await applyTool(tool,connection)).status,'failed'));
 assert.equal(fs.readFileSync(file,'utf8'),before.content);assert.equal(fs.readFileSync(state,'utf8'),saved);assert.deepEqual(fs.readdirSync(backupsRoot()),archives);
});

test('a missing managed routing file does not authorize discarding prior recovery records',async()=>{
 const before=await switched();fs.rmSync(file);
 assert.equal(isExternallyModified(tool),false);
 assert.equal((await applyTool(tool,connection)).status,'failed');
 assert.deepEqual(stateStore.getFileStates(tool.name),before.records);
 assert.equal(fs.existsSync(file),false);
});


test('restoring archived records cannot replace another tool recovery record',()=>{
 stateStore.clear();const other={priors:{keep:'protected'}};stateStore.setState('other',other);
 assert.throws(()=>stateStore.restoreToolRecords('requested',{other:{priors:{keep:'replacement'}}}),/another tool/);
 assert.deepEqual(stateStore.getState('other'),other);assert.equal(stateStore.restoreToolRecords('requested',{}),false);
});
