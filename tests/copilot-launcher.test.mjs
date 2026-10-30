import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'copilot-'));process.env.HOME=process.env.USERPROFILE=home;
delete process.env.COPILOT_PROVIDERS_CONFIG;delete process.env.COPILOT_HOME;
const {CopilotTool}=await import('../dist/lib/tools/copilot-tool.js');const {ClaudeCodeTool}=await import('../dist/lib/tools/claude-code-tool.js');const {toolManager}=await import('../dist/lib/tool-manager.js');
test('Copilot injects provider config without writing files',async()=>{const tool=new CopilotTool();assert.equal(tool.launchOnly,true);assert.ok(toolManager.get('copilot'));assert.deepEqual(tool.getLaunchEnv('key','https://api.qnaigc.com/',{defaultModel:'test/model'}),{COPILOT_PROVIDER_BEARER_TOKEN:undefined,COPILOT_PROVIDER_WIRE_MODEL:undefined,COPILOT_PROVIDER_WIRE_API:undefined,COPILOT_PROVIDER_API_KEY_COMMAND:undefined,COPILOT_PROVIDER_TYPE:'openai',COPILOT_PROVIDER_BASE_URL:'https://api.qnaigc.com/v1',COPILOT_PROVIDER_API_KEY:'key',COPILOT_MODEL:'test/model'});await assert.rejects(tool.loadConfig());tool.unloadConfig();assert.deepEqual(fs.readdirSync(home),[]);});
test('empty provider registries are accepted and all alternate routing selectors are reset',()=>{
 const file=path.join(home,'empty-registry.json');fs.writeFileSync(file,'{"providers":[],"models":[]}');process.env.COPILOT_PROVIDERS_CONFIG=file;
 try{assert.equal(new CopilotTool().getLaunchEnv('key','https://api.qnaigc.com',{defaultModel:'test/model'}).COPILOT_PROVIDER_API_KEY,'key');}finally{delete process.env.COPILOT_PROVIDERS_CONFIG;fs.rmSync(file);}
 const env=new ClaudeCodeTool().getLaunchSettings('key','https://api.qnaigc.com',{}).env;for(const key of ['CLAUDE_CODE_USE_ANTHROPIC_AWS','CLAUDE_CODE_USE_MANTLE'])assert.equal(env[key],'');
});
test('Copilot blocks conflicting registry and Claude overrides saved routing for one session',()=>{
 const saved=process.env.COPILOT_PROVIDERS_CONFIG;const file=path.join(home,'registry.json');fs.writeFileSync(file,'{"providers":{"old":{}}}');process.env.COPILOT_PROVIDERS_CONFIG=file;
 try{assert.throws(()=>new CopilotTool().getLaunchEnv('key','https://api.qnaigc.com',{defaultModel:'x'}),/registry takes precedence/);assert.equal(fs.readFileSync(file,'utf8'),'{"providers":{"old":{}}}');}finally{fs.rmSync(file);if(saved===undefined)delete process.env.COPILOT_PROVIDERS_CONFIG;else process.env.COPILOT_PROVIDERS_CONFIG=saved;}
 const tool=new ClaudeCodeTool();const settings=tool.getLaunchSettings('new-key','https://api.qnaigc.com',{});
 assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN,'new-key');for(const key of ['CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY','ANTHROPIC_API_KEY'])assert.equal(settings.env[key],'');
});
test('Claude launcher clears inherited model override and matches selected variables',()=>{const env=new ClaudeCodeTool().getLaunchEnv('key','https://api.qnaigc.com',{claudeCode:{sonnetModel:'test/sonnet'}});assert.equal(env.ANTHROPIC_MODEL,undefined);assert.equal(env.ANTHROPIC_DEFAULT_HAIKU_MODEL,undefined);assert.equal(env.ANTHROPIC_DEFAULT_SONNET_MODEL,'test/sonnet');assert.equal(env.ANTHROPIC_AUTH_TOKEN,'key');assert.deepEqual(fs.readdirSync(home),[]);});
