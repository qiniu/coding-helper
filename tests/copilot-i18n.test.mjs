import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
process.env.HOME=process.env.USERPROFILE=fs.mkdtempSync(os.tmpdir()+'/copilot-i18n-');
const {i18n}=await import('../dist/lib/i18n.js');
const {CopilotTool}=await import('../dist/lib/tools/copilot-tool.js');
test('Copilot load refusal gives localized actionable guidance',async()=>{
  for(const lang of ['zh_CN','en_US']){i18n.init(lang);await assert.rejects(new CopilotTool().loadConfig(),error=>error.message.includes('coding-helper run copilot')&&!error.message.includes('setup_reason_launch_only'));}
});
