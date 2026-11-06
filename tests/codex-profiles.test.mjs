import {isolateHome} from './helpers/isolated-home.mjs';
import assert from 'node:assert/strict'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import test from 'node:test';
const home=fs.mkdtempSync(path.join(os.tmpdir(), 'codex-profiles-'));isolateHome(home);
const { configManager } = await import('../dist/lib/config.js');
const { CodexTool, mergeCodexProfiles, buildCodexProfileFile } = await import('../dist/lib/tools/codex-tool.js');
const file = path.join(process.env.HOME, '.codex/config.toml');
test.after(() => fs.rmSync(process.env.HOME, { recursive: true, force: true }));
test('Codex profile providers preserve user configuration and escape strings', () => {
 const text = mergeCodexProfiles('[profiles.mine]\nmodel = "x"\n', [{ name: 'work', apiKey: 'sk-"secret', baseUrl: 'https://example.com' }]);
 assert.match(text, /profiles.mine/); assert.match(text, /model_providers.qnaigc-work/); assert.doesNotMatch(text, /profiles.qn-work/);
 assert.match(buildCodexProfileFile('work', 'm'), /model_provider = "qnaigc-work"/);
 assert.throws(() => mergeCodexProfiles('[model_providers.qnaigc-work]\nname = "Mine"\n', [{ name: 'work', apiKey: 'x', baseUrl: 'https://example.com' }]));
});
test('adding profiles extends the existing transaction and restore preserves original bytes', async () => {
 fs.mkdirSync(path.dirname(file), { recursive: true }); const original = '# user config\nmodel = "original"\n'; fs.writeFileSync(file, original);
 const tool = new CodexTool(); await tool.loadConfig('sk-current', 'https://api.qnaigc.com', {});
 configManager.saveProfile('work', 'sk-work', 'china'); await tool.loadConfig('sk-current', 'https://api.qnaigc.com', {});
 const profileFile = path.join(process.env.HOME, '.codex/qn-work.config.toml'); assert.ok(fs.existsSync(profileFile));
 configManager.saveProfile('home', 'sk-home', 'international'); await tool.loadConfig('sk-current', 'https://api.qnaigc.com', {});
 const before = fs.readFileSync(file, 'utf8'); fs.appendFileSync(profileFile, '# external edit\n'); await assert.rejects(tool.unloadConfig()); assert.equal(fs.readFileSync(file, 'utf8'), before);
 fs.writeFileSync(profileFile, buildCodexProfileFile('work', tool.defaultModel, path.join(process.env.HOME, '.codex/model-catalogs/qnaigc.json')));
 await tool.unloadConfig(); assert.equal(fs.readFileSync(file, 'utf8'), original); assert.equal(fs.existsSync(profileFile), false);
});

const {stateStore}=await import('../dist/lib/core/state-store.js');
function reset(){configManager.clearConfig();fs.rmSync(path.join(home,'.codex'),{recursive:true,force:true});}
test('removed helper profiles retain their exported routing until explicit restore',async()=>{
 reset();configManager.saveProfile('work','sk-work','china');const tool=new CodexTool();
 await tool.loadConfig('sk-current','https://api.qnaigc.com',{});
 const exported=path.join(home,'.codex/qn-work.config.toml');const before=fs.readFileSync(exported,'utf8');
 configManager.removeProfile('work');await tool.loadConfig('sk-current','https://api.qnaigc.com',{});
 assert.equal(fs.readFileSync(exported,'utf8'),before);assert.match(fs.readFileSync(file,'utf8'),/model_providers.qnaigc-work/);
 await tool.unloadConfig();assert.equal(fs.existsSync(exported),false);
});
test('catalog directory aliases reload and restore using canonical base targets',async()=>{
 reset();const catalog=path.join(home,'catalog-target');fs.mkdirSync(catalog);fs.mkdirSync(path.join(home,'.codex'));
 fs.symlinkSync(catalog,path.join(home,'.codex/model-catalogs'),'junction');
 const original='# original\nmodel = "user"\n';fs.writeFileSync(file,original);
 const tool=new CodexTool();await tool.loadConfig('first','https://api.qnaigc.com',{});await tool.loadConfig('second','https://api.qnaigc.com',{});
 await tool.unloadConfig();assert.equal(fs.readFileSync(file,'utf8'),original);assert.equal(fs.existsSync(path.join(catalog,'qnaigc.json')),false);
});
test('profile filenames differing only by case fail before any transaction writes',async()=>{
 reset();configManager.saveProfile('work','first','china');configManager.saveProfile('Work','second','international');
 const tool=new CodexTool();await assert.rejects(tool.loadConfig('current','https://api.qnaigc.com',{}),/conflict ignoring case/);
 assert.equal(fs.existsSync(file),false);assert.deepEqual(stateStore.getFileStates('codex'),[]);
});
test('a profile file created after preflight is protected by the transaction snapshot',async t=>{
 reset();configManager.saveProfile('race','profile','china');
 const exported=path.join(home,'.codex/qn-race.config.toml');const original='model = "user-raced"\n';
 const lock=stateStore.withLock.bind(stateStore);let inject=true;
 t.mock.method(stateStore,'withLock',operation=>{if(inject){inject=false;fs.mkdirSync(path.dirname(exported),{recursive:true});fs.writeFileSync(exported,original);}return lock(operation);});
 const tool=new CodexTool();await assert.rejects(tool.loadConfig('current','https://api.qnaigc.com',{}),/already exists/);
 assert.equal(fs.readFileSync(exported,'utf8'),original);assert.equal(fs.existsSync(file),false);assert.deepEqual(stateStore.getFileStates('codex'),[]);
});

test('a matching provider display name does not grant ownership of user credentials',async()=>{
 reset();configManager.saveProfile('work','helper-key','china');
 fs.mkdirSync(path.dirname(file),{recursive:true});
 const original='[model_providers.qnaigc-work]\nname = "Qiniu (work)"\nbase_url = "https://user.example/v1"\nexperimental_bearer_token = "user-key"\nwire_api = "responses"\n';
 fs.writeFileSync(file,original);const tool=new CodexTool();
 await assert.rejects(tool.loadConfig('current','https://api.qnaigc.com',{}),/conflicts with an existing provider/);
 assert.equal(fs.readFileSync(file,'utf8'),original);assert.equal(fs.existsSync(path.join(home,'.codex/auth.json')),false);
 assert.deepEqual(stateStore.getFileStates('codex'),[]);
 assert.throws(()=>mergeCodexProfiles(original,[{name:'work',apiKey:'replacement',baseUrl:'https://api.qnaigc.com'}]),/conflicts/);
});
