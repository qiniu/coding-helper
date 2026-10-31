import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import test from 'node:test';import {isolateHome} from './helpers/isolated-home.mjs';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'claude-default-slots-'));isolateHome(home);test.after(()=>fs.rmSync(home,{recursive:true,force:true}));
const {configManager}=await import('../dist/lib/config.js');const {ClaudeCodeTool}=await import('../dist/lib/tools/claude-code-tool.js');const {runModelSelectionFlow}=await import('../dist/lib/wizard/flows/model-selection-flow.js');const {promptHelper}=await import('../dist/lib/wizard/ui/prompt-helper.js');
test('restoring Claude defaults clears its slot overrides before reload and launch',async t=>{
 const file=path.join(home,'.claude/settings.json');const original='{"env":{"KEEP":"yes"}}\n';fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,original);
 configManager.setModels({claudeCode:{sonnetModel:'main',opusModel:'main',useDefaultModels:false},slotModels:{'claude-code':{fallback:'old-fast',subagent:'old-sub'},grok:{summary:'keep'}}});
 const tool=new ClaudeCodeTool();await tool.loadConfig('fake','https://api.qnaigc.com',configManager.getModels());assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).env.ANTHROPIC_DEFAULT_HAIKU_MODEL,'old-fast');
 t.mock.method(promptHelper,'confirm',async()=>false);await runModelSelectionFlow();const models=configManager.getModels();assert.equal(models.claudeCode.useDefaultModels,true);assert.equal(models.slotModels?.['claude-code'],undefined);assert.deepEqual(models.slotModels.grok,{summary:'keep'});
 await tool.loadConfig('fake','https://api.qnaigc.com',models);const env=JSON.parse(fs.readFileSync(file,'utf8')).env;for(const key of ['ANTHROPIC_DEFAULT_HAIKU_MODEL','ANTHROPIC_SMALL_FAST_MODEL','CLAUDE_CODE_SUBAGENT_MODEL']){assert.equal(env[key],undefined);assert.equal(tool.getLaunchEnv('fake','https://api.qnaigc.com',models)[key],undefined);}
 tool.unloadConfig();assert.equal(fs.readFileSync(file,'utf8'),original);
});
