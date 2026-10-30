import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'codex-safe-'));process.env.HOME=process.env.USERPROFILE=home;
const {CodexTool}=await import('../dist/lib/tools/codex-tool.js');const tool=new CodexTool();const dir=path.join(home,'.codex');fs.mkdirSync(dir);const config=path.join(dir,'config.toml'),auth=path.join(dir,'auth.json');
test('Codex preserves CRLF through appended provider definitions and reload',async()=>{
 const original='model="old"\r\n[mcp_servers.demo]\r\ncommand="node"\r\n';fs.writeFileSync(config,original);fs.writeFileSync(auth,'{}');
 await tool.loadConfig('key','https://api.qnaigc.com',{});assert.doesNotMatch(fs.readFileSync(config,'utf8'),/(?<!\r)\n/);
 await tool.loadConfig('next','https://api.qnaigc.com',{});await tool.unloadConfig();assert.equal(fs.readFileSync(config,'utf8'),original);
});
test('Codex preserves skills array tables and replaces equivalent managed provider definitions',async()=>{
 const {parse}=await import('smol-toml');
 for(const provider of ['[model_providers]\nqnaigc={name="old",base_url="https://old.test",wire_api="responses"}\n','model_providers.qnaigc.name="old"\nmodel_providers.qnaigc.base_url="https://old.test"\n','model_providers={qnaigc={name="old"},other={name="keep"}}\n']){
  const original=provider+'[[skills.config]]\npath="/tmp/test-skill"\nenabled=false\n';
  fs.writeFileSync(config,original);fs.writeFileSync(auth,'{}');await tool.loadConfig('key','https://api.qnaigc.com',{});
  const next=parse(fs.readFileSync(config,'utf8'));assert.equal(next.model_providers.qnaigc.base_url,'https://api.qnaigc.com/bypass/openai/v1');assert.deepEqual(next.skills.config,[{path:'/tmp/test-skill',enabled:false}]);
  await tool.unloadConfig();assert.equal(fs.readFileSync(config,'utf8'),original);
 }
});
test('Codex removes obsolete active selector and uses file API auth while preserving originals', async()=>{
 const {parse}=await import('smol-toml');
 const original='profile = "work"\ncli_auth_credentials_store="ephemeral"\nforced_login_method="chatgpt"\n[profiles.work]\nmodel = "other-model"\nmodel_provider = "other"\n[model_providers.other]\nbase_url = "https://example.test"\n';
 fs.writeFileSync(config,original);fs.writeFileSync(auth,'{}');
 await tool.loadConfig('key','https://api.qnaigc.com',{});
 const loaded=parse(fs.readFileSync(config,'utf8'));
 assert.equal(loaded.profile,undefined);assert.equal(loaded.model_provider,'qnaigc');assert.equal(loaded.cli_auth_credentials_store,'file');assert.equal(loaded.forced_login_method,'api');assert.deepEqual(loaded.profiles.work,{model:'other-model',model_provider:'other'});
 await tool.unloadConfig();assert.equal(fs.readFileSync(config,'utf8'),original);
});
test('Codex preserves legal multiline sandbox settings and strings through load and unload', async()=>{
 const original='sandbox_permissions = [\n  "disk-full-read-access",\n]\nnotes = """\n[not_a_table]\nkeep=true\n"""\n[mcp_servers.demo]\nargs = [\n  "a", "b",\n]\n';
 fs.writeFileSync(config,original);fs.writeFileSync(auth,'{}');
 await tool.loadConfig('key','https://api.qnaigc.com',{});
 const applied=fs.readFileSync(config,'utf8');assert.ok(applied.includes('sandbox_permissions = [\n  "disk-full-read-access",\n]'));assert.ok(applied.includes('notes = """\n[not_a_table]\nkeep=true\n"""'));
 await tool.unloadConfig();assert.equal(fs.readFileSync(config,'utf8'),original);
});
test('Codex keeps MCP and original auth, restores exact bytes and rejects corrupt secondary JSON',async()=>{const original='# keep\nmodel = "old"\n[mcp_servers.demo]\ncommand = "node"\n';fs.writeFileSync(config,original);fs.writeFileSync(auth,'{ "OPENAI_API_KEY": null, "tokens": {"keep":1} }');await tool.loadConfig('key','https://api.qnaigc.com',{});assert.match(fs.readFileSync(config,'utf8'),/mcp_servers.demo/);assert.deepEqual(JSON.parse(fs.readFileSync(auth,'utf8')).tokens,{keep:1});await tool.unloadConfig();assert.equal(fs.readFileSync(config,'utf8'),original);assert.equal(fs.readFileSync(auth,'utf8'),'{ "OPENAI_API_KEY": null, "tokens": {"keep":1} }');fs.writeFileSync(auth,'{broken');await assert.rejects(tool.loadConfig('key','https://api.qnaigc.com',{}));assert.equal(fs.readFileSync(config,'utf8'),original);});

test('Codex deleted original blocks unload and keeps the restoration record',async()=>{
  const {stateStore}=await import('../dist/lib/core/state-store.js');stateStore.clear();fs.writeFileSync(config,'model = "original"\n');fs.writeFileSync(auth,'{}');
  await tool.loadConfig('key','https://api.qnaigc.com',{});const applied=fs.readFileSync(config,'utf8');const states=stateStore.getFileStates(tool.name);
  fs.rmSync(config);await assert.rejects(tool.unloadConfig(),/changed/);assert.deepEqual(stateStore.getFileStates(tool.name),states);
  fs.writeFileSync(config,applied);await tool.unloadConfig();assert.equal(fs.readFileSync(config,'utf8'),'model = "original"\n');
});

test('Codex legacy uninstall refuses unchanged credentials without restoration state',async()=>{
 const {stateStore}=await import('../dist/lib/core/state-store.js');stateStore.clear();const original='model_provider = "qnaigc"\n[model_providers.qnaigc]\nbase_url = "https://api.qnaigc.com"\n';fs.writeFileSync(config,original);fs.writeFileSync(auth,'{"OPENAI_API_KEY":"legacy-key"}');
 await assert.rejects(tool.unloadConfig(),/No restoration record.*unchanged/);assert.equal(fs.readFileSync(config,'utf8'),original);assert.equal(fs.readFileSync(auth,'utf8'),'{"OPENAI_API_KEY":"legacy-key"}');
});
