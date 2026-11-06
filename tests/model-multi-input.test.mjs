import assert from 'node:assert/strict';
import test from 'node:test';
import {runPrompt} from './helpers/prompt-pty.mjs';
import {head,frame,pty} from './helpers/buddy-search-fixture.mjs';
for (const tool of ['codebuddy','workbuddy']) {
 for (const paste of [false,true]) test(`${tool}: ${paste?'pasted':'typed'} multi-term search does not select the focused 128K model`,pty,async()=>{
  const source=head(tool)+`catalog.splice(0,catalog.length,{id:'alpha/small',features:['工具调用','深度思考'],model_constraints:{context_length:128000}},{id:'beta/large',features:['工具调用','深度思考'],model_constraints:{context_length:256000}});assert.deepEqual(await select(),['beta/large']);assert.equal(fs.readFileSync(configManager.configFile,'utf8'),before);console.log('OK');`;
  const keys=paste?'\x1b[200~thinking 200k\x1b[201~':'thinking 200k';
  const out=await runPrompt(source,[[frame,keys],[/Selected 0:[^]*⌕ thinking 200k[^]*Type search/,'\x1b[B '],[/Selected 1: large[^]*Type search/,'\r']],120,{rows:42,raw:true});
  assert.match(out,/OK/);
  assert.ok(out.includes('\x1b[?2004h')&&out.includes('\x1b[?2004l'));
 });
 for (const selected of [[],['alpha/one']]) test(`${tool}: Enter activates filter controls with ${selected.length} selected`,pty,async()=>{
  const source=head(tool,selected)+`assert.equal(await select(),null);assert.equal(fs.readFileSync(configManager.configFile,'utf8'),before);console.log('OK');`;
  const out=await runPrompt(source,[[frame,'\x1b[F\r'],[/Only models with tool calls[^]*Type search/,'\r'],[/Show all[^]*Type search/,'\x1b']],120,{rows:42});
  assert.match(out,/OK/);
 });
}
test('bracketed paste after browsing never toggles or accepts, and resize retains search mode',pty,async()=>{
 const source=head('workbuddy',['alpha/one'])+`assert.deepEqual(await select(),['alpha/one']);console.log('OK');`;
 const out=await runPrompt(source,[[frame,'\x1b[B\x1b[200~thinking\n200k\x1b[201~'],[/Selected 1:[^]*⌕ thinking 200k[^]*Type search/,{resize:{columns:90,rows:32}}],[/⌕ thinking 200k[^]*Type search/,' '],[/⌕ thinking 200k  [^]*Type search/,'\x1b'],[frame,'\r']],120,{rows:42});
 assert.match(out,/OK/);
});
