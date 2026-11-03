import assert from 'node:assert/strict';
import test from 'node:test';
import {runPrompt} from './helpers/prompt-pty.mjs';
import {pty,head,frame} from './helpers/buddy-search-fixture.mjs';
for(const tool of ['codebuddy','workbuddy']){
 test(`${tool} adds through search and removes an existing model without losing off-catalog configuration`,pty,async()=>{
  const source=head(tool,['alpha/one','legacy/missing'])+`const values=await select();assert.deepEqual(values,['legacy/missing','beta/two']);assert.equal(catalog.length,2);assert.equal(requests,1);assert.equal(fs.readFileSync(configManager.configFile,'utf8'),before);console.log('SEARCH_OK');`;
  const out=await runPrompt(source,[[/Currently configured: alpha\/one, legacy\/missing[^]*Type search/,'beta/two\r'],[/Selected 3:[^]*Type search/,'alpha/one\r'],[/Selected 2: legacy\/missing, beta\/two[^]*Type search/,'\r']],120,{rows:42});
  assert.match(out,/SEARCH_OK/);assert.match(out,/☑.*legacy\/missing/);assert.doesNotMatch(out,/Reuse the previous/);
 });
 test(`${tool} can cancel a changed search draft without saving any settings`,pty,async()=>{
  const source=head(tool,['alpha/one'])+`assert.equal(await select(),null);assert.equal(fs.readFileSync(configManager.configFile,'utf8'),before);console.log('CANCEL_OK');`;
  const out=await runPrompt(source,[[frame,'beta/two\r'],[/Selected 2:[^]*Type search/,'no-match'],[/⌕ no-match[^]*Type search/,'\x1b'],[frame,'\x1b']],110,{rows:40});assert.match(out,/CANCEL_OK/);
 });

}

test('multi-model selection survives vendor tabs and clearing the search',pty,async()=>{
 const source=head('workbuddy')+`const result=await select();assert.deepEqual(result,['alpha/one','beta/two']);assert.equal(requests,1);console.log('TABS_OK');`;
 const out=await runPrompt(source,[[frame,'alpha/one\r'],[/Selected 1:[^]*Type search/,'\x1b[C'],[/Selected 1:[^]*☑.*alpha\/one[^]*Type search/,'\x1b[C'],[/Selected 1:[^]*☐.*beta\/two[^]*Type search/,'\x1b[B\r'],[/Selected 2:[^]*Type search/,'no-match'],[/⌕ no-match[^]*Type search/,'\x1b'],[/Selected 2:[^]*Type search/,'\t']],120,{rows:42});assert.match(out,/TABS_OK/);
});

test('custom model additions deduplicate and remain searchable for removal',pty,async()=>{
 const source=head('codebuddy')+`assert.deepEqual(await select(),['vendor/b','vendor/a']);assert.equal(fs.readFileSync(configManager.configFile,'utf8'),before);console.log('CUSTOM_OK');`;
 const out=await runPrompt(source,[[frame,'vendor/a,vendor/b,vendor/a\r'],[/Selected 2:[^]*Type search/,'vendor/a\r'],[/Selected 1: vendor\/b[^]*Type search/,'vendor/a\r'],[/Selected 2: vendor\/b, vendor\/a[^]*Type search/,'\t']],120,{rows:42});assert.match(out,/CUSTOM_OK/);
});

test('show-all retains custom additions and an empty selection cannot continue',pty,async()=>{
 const source=head('codebuddy')+`assert.deepEqual(await select(),['alpha/one']);console.log('ALL_OK');`;
 const out=await runPrompt(source,[[frame,'vendor/new\r'],[/Selected 1:[^]*Type search/,'\x1b[F\r'],[/Selected 1:[^]*Only models with tool calls[^]*Type search/,'vendor/new\r'],[/Selected 0:[^]*Type search/,'\talpha/one\r'],[/Selected 1: alpha\/one[^]*Type search/,'\r']],120,{rows:42});assert.match(out,/ALL_OK/);
});
