import assert from 'node:assert/strict';import test from 'node:test';import {runPrompt} from './helpers/prompt-pty.mjs';
for(const entry of ['default','init'])test(`${entry} exits when tool selection is cancelled`,{skip:process.platform==='win32'},async()=>{
 const source=`globalThis.fetch=async()=>new Response('{}');const {createProgram}=await import('./dist/lib/command.js');await createProgram().parseAsync(['node','helper',...${entry==='init'?"['init']":"[]"}]);console.log('RESULT done');`;
 const out=await runPrompt(source,[['请选择语言','\r'],['请选择 API 线路','\r'],['请输入您的 API Key','qiniu-test-key\r'],[/选择要配置的工具[\s\S]*?Esc 返回/,'\x1b']]);assert.match(out,/RESULT done/);assert.doesNotMatch(out,/初始化完成|接入编码工具|账号与线路|更多…/);
});
