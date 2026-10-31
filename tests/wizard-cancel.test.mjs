import assert from 'node:assert/strict';import test from 'node:test';import {runPrompt} from './helpers/prompt-pty.mjs';
for(const entry of ['default','init'])for(const stage of ['language','endpoint','key'])test(`${entry} cancellation at ${stage} exits before main menu`,{skip:process.platform==='win32'},async()=>{
 const source=`import {createProgram} from './dist/lib/command.js';await createProgram().parseAsync(['node','helper',...${entry==='init'?"['init']":"[]"}]);console.log('RESULT done');`;
 const steps=[['请选择语言',stage==='language'?'\x1b':'\r']];if(stage!=='language')steps.push(['请选择 API 线路',stage==='endpoint'?'\x1b':'\r']);if(stage==='key')steps.push(['请输入您的 API Key','\x1b']);
 const out=await runPrompt(source,steps);assert.match(out,/RESULT done/);assert.doesNotMatch(out,/接入编码工具|账号与线路|更多…/);const label={language:'请选择语言',endpoint:'请选择 API 线路',key:'请输入您的 API Key'}[stage];assert.equal(out.includes('✔ '+label),false);
});
