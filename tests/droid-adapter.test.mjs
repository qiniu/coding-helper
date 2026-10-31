import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-droid-')));
process.env.HOME = process.env.USERPROFILE = home;
delete process.env.KIMI_CODE_HOME; delete process.env.GROK_HOME;
const { DroidTool } = await import('../dist/lib/tools/droid-tool.js');
test('Droid preserves unrelated custom IDs and same-route known metadata offline',async()=>{
 const {applyDroidSettings}=await import('../dist/lib/tools/droid-tool.js');
 const original={customModels:[{model:'vision',displayName:'Qiniu: vision',baseUrl:'https://api.qnaigc.com/v1',apiKey:'old',maxContextLimit:11904,maxOutputTokens:4096,noImageSupport:false},{model:'personal',displayName:'Personal',baseUrl:'https://other.test'}],sessionDefaultSettings:{model:'custom:Personal-1'}};
 const next=applyDroidSettings(original,'https://api.qnaigc.com','new','vision',{contextWindow:128000,maxOutputTokens:8192,verified:false});
 assert.equal(next.customModels[0].apiKey,'new');assert.equal(next.customModels[0].maxContextLimit,11904);assert.equal(next.customModels[0].maxOutputTokens,4096);assert.equal(next.customModels[0].noImageSupport,false);assert.deepEqual(next.customModels[1],original.customModels[1]);assert.deepEqual(next.sessionDefaultSettings,{model:'custom:Qiniu:-vision-0',specModeModel:'custom:Qiniu:-vision-0'});
 const added=applyDroidSettings(next,'https://api.qnaigc.com','new','another');assert.deepEqual(added.customModels.slice(0,2),next.customModels);assert.equal(added.customModels.length,3);
});
test('Droid platform installers and load notes match user actions',async()=>{
 const {getDroidInstallCommand}=await import('../dist/lib/tools/droid-tool.js');const {i18n}=await import('../dist/lib/i18n.js');
 assert.match(getDroidInstallCommand('win32'),/powershell.*cli\/windows/);assert.match(getDroidInstallCommand('linux'),/pipefail/);
 for(const locale of ['zh_CN','en_US']){i18n.init(locale);const notes=new DroidTool().getLoadConfigNotes();assert.equal(notes.length,1);assert.match(notes[0],/\/model/);assert.match(notes[0],/Qiniu:/);}
});
test('Droid reserves output capacity and carries image support while selecting Qiniu session defaults',async()=>{
 const {applyDroidSettings}=await import('../dist/lib/tools/droid-tool.js');
 const original={sessionDefaultSettings:{model:'existing'}};
 for(const image of [true,false]){const next=applyDroidSettings(original,'https://api.qnaigc.com','key','test/model',{contextWindow:32768,maxOutputTokens:8192,modalities:{input:image?['text','image']:['text'],output:['text']}});assert.equal(next.customModels[0].maxContextLimit,24576);assert.equal(next.customModels[0].maxOutputTokens,8192);assert.equal(next.customModels[0].noImageSupport,!image);assert.deepEqual(next.sessionDefaultSettings,{model:'custom:Qiniu:-test/model-0',specModeModel:'custom:Qiniu:-test/model-0'});}
 for(const maxOutputTokens of [8192,16384]){const result=applyDroidSettings(original,'https://api.qnaigc.com','key','test/model',{contextWindow:8192,maxOutputTokens});assert.equal(result.customModels[0].maxOutputTokens,4096);assert.equal(result.customModels[0].maxContextLimit,4096);}
 assert.throws(()=>applyDroidSettings(original,'https://api.qnaigc.com','key','test/model',{contextWindow:1,maxOutputTokens:1}),/positive input/);
});
const { marketModelService } = await import('../dist/lib/market-model-service.js');
const { toolManager } = await import('../dist/lib/tool-manager.js');
const { hasSavedToolModelConfig } = await import('../dist/lib/wizard/menus/tool-menu.js');
const tool = new DroidTool(); tool.getVersion = () => null;
marketModelService.fetchModels = async () => [];
const files = [".factory/settings.json"].map(file => path.join(home, file));
const originals = ["{ \"customModels\": [{\"model\":\"mine\",\"displayName\":\"Mine\",\"baseUrl\":\"https://api.qnaigc.com/v1\"}], \"custom\":true }"];
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
const read = file => fs.readFileSync(file, 'utf8');
const load = (key = 'test-key') => tool.loadConfig(key, 'https://api.qnaigc.com', { toolModels: { [tool.name]: 'test/model' } });
test('droid is registered and recognizes saved generic model selection', () => {
  assert.ok(toolManager.get(tool.name));
  assert.equal(hasSavedToolModelConfig(tool, { toolModels: { [tool.name]: 'test/model' } }), true);
});
test('droid restores bytes and refuses corrupt or changed config', async () => {
  files.forEach((file, i) => write(file, originals[i]));
  await load(); await load('second-key');
  assert.equal(JSON.parse(read(files[0])).customModels[0].displayName, 'Mine'); assert.equal(JSON.parse(read(files[0])).sessionDefaultSettings.model, 'custom:Qiniu:-test/model-1');
  await tool.unloadConfig(); files.forEach((file, i) => assert.equal(read(file), originals[i]));
  write(files[0], "{broken");
  await assert.rejects(load()); assert.equal(read(files[0]), "{broken");
  write(files[0], originals[0]); await load();
  const applied = read(files[0]); write(files[0], applied + ' ');
  await assert.rejects(load(), /changed/); assert.throws(() => tool.unloadConfig(), /changed/);
  assert.equal(read(files[0]), applied + ' '); write(files[0], applied);
  await tool.unloadConfig();
  files.forEach(file => fs.rmSync(file));
  await load(); await tool.unloadConfig(); files.forEach(file => assert.equal(fs.existsSync(file), false));
});

test('unload without a restoration record preserves every existing target and reports recovery guidance', () => {
  files.forEach(file => fs.rmSync(file, {force:true}));
  assert.doesNotThrow(() => tool.unloadConfig());
  for (const file of files) {
    write(file, 'legacy credential bytes');
    assert.throws(() => tool.unloadConfig(), /No restoration record.*Configuration is unchanged.*manually/);
    assert.equal(read(file), 'legacy credential bytes');
    fs.rmSync(file);
  }
});
