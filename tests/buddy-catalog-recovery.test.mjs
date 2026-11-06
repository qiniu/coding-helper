import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isolateHome } from './helpers/isolated-home.mjs';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'buddy-catalog-'));isolateHome(home);
const {CodeBuddyTool}=await import('../dist/lib/tools/codebuddy-tool.js');
const {WorkBuddyTool}=await import('../dist/lib/tools/workbuddy-tool.js');
const {marketModelService}=await import('../dist/lib/market-model-service.js');
const {modelService}=await import('../dist/lib/model-service.js');
const {previewWrites}=await import('../dist/lib/core/safe-write.js');
test.after(()=>fs.rmSync(home,{recursive:true,force:true}));
for (const [Tool,dir,field] of [[CodeBuddyTool,'.codebuddy','codeBuddyModels'],[WorkBuddyTool,'.workbuddy','workbuddyModels']]) {
 for (const offline of [false,true]) test(`${Tool.name} ${offline?'manual':'standard catalog'} recovery previews, writes and restores`,async t=>{
  t.mock.method(marketModelService,'fetchModels',async()=>{throw Error('unavailable');});
  t.mock.method(modelService,'fetchModels',async()=>{if(offline)throw Error('unavailable');return[{id:'vendor/a'},{id:'vendor/b'}];});
  const tool=new Tool();const file=path.join(home,dir,'models.json');const models={[field]:['vendor/a','vendor/b']};
  const preview=await previewWrites(()=>tool.loadConfig('fixture','https://api.qnaigc.com',models));
  assert.ok(preview.changes.length, JSON.stringify({preview,config:tool.getConfig()}));assert.equal(fs.existsSync(file),false);
  await tool.loadConfig('fixture','https://api.qnaigc.com',models);
  const document=JSON.parse(fs.readFileSync(file,'utf8'));const written=Array.isArray(document)?document:document.models;
  assert.deepEqual(written.map(m=>m.id),models[field]);
  for(const m of written){assert.equal(m.supportsImages,false);assert.equal(m.supportsToolCall,true);assert.equal(m.maxInputTokens,200000);assert.equal(m.maxOutputTokens,8192);}
  await tool.unloadConfig();assert.equal(fs.existsSync(file),false);
 });
}


for (const [Tool, dir, field] of [[CodeBuddyTool, '.codebuddy', 'codeBuddyModels'], [WorkBuddyTool, '.workbuddy', 'workbuddyModels']]) {
 for (const status of [401, 402, 403]) for (const deniedEndpoint of ['market', 'standard']) {
  test(`${Tool.name} rejects ${status} from ${deniedEndpoint} without writing credentials or recovery records`, async t => {
   marketModelService.clearCache(); modelService.clearCache();
   const calls = [];
   t.mock.method(globalThis, 'fetch', async url => {
    calls.push(url);
    return new Response('', { status: deniedEndpoint === 'market' || url.endsWith('/v1/models') ? status : 404 });
   });
   const tool = new Tool(), file = path.join(home, dir, 'models.json'), state = path.join(home, '.coding-helper/state.json');
   const read = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
   const before = [read(file), read(state)];
   await assert.rejects(tool.loadConfig('expired-fixture', 'https://api.qnaigc.com', { [field]: ['vendor/a'] }), { message: `HTTP ${status}` });
   assert.deepEqual([read(file), read(state)], before);
   assert.equal(calls.length, deniedEndpoint === 'market' ? 1 : 2);
  });
 }
}
