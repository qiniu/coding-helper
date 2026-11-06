import assert from 'node:assert/strict';
import test from 'node:test';
import {runPrompt} from './helpers/prompt-pty.mjs';
import {pty,head,frame} from './helpers/buddy-search-fixture.mjs';
for(const tool of ['codebuddy','workbuddy']){
 test(`${tool} adds through search and removes an existing model without losing off-catalog configuration`,pty,async()=>{
  const source=head(tool,['alpha/one','legacy/missing'])+`const values=await select();assert.deepEqual(values,['legacy/missing','beta/two']);assert.equal(catalog.length,2);assert.equal(requests,1);assert.equal(fs.readFileSync(configManager.configFile,'utf8'),before);console.log('SEARCH_OK');`;
  const out=await runPrompt(source,[[/Currently configured: one · missing[^]*Type search/,'beta/two\x1b[B '],[/Selected 3:[^]*Type search/,'\x1b'],[frame,'alpha/one\x1b[B '],[/Selected 2: missing · two[^]*Type search/,'\r']],120,{rows:42});
  assert.match(out,/SEARCH_OK/);assert.match(out,/☑.*legacy\/missing/);assert.doesNotMatch(out,/Reuse the previous/);
 });
 test(`${tool} can cancel a changed search draft without saving any settings`,pty,async()=>{
  const source=head(tool,['alpha/one'])+`assert.equal(await select(),null);assert.equal(fs.readFileSync(configManager.configFile,'utf8'),before);console.log('CANCEL_OK');`;
  const out=await runPrompt(source,[[frame,'beta/two\x1b[B '],[/Selected 2:[^]*Type search/,'\x1b'],[frame,'no-match'],[/⌕ no-match[^]*Type search/,'\x1b'],[frame,'\x1b']],110,{rows:40});assert.match(out,/CANCEL_OK/);
 });

}

test('multi-model selection survives vendor tabs and clearing the search',pty,async()=>{
 const source=head('workbuddy')+`const result=await select();assert.deepEqual(result,['alpha/one','beta/two']);assert.equal(requests,1);console.log('TABS_OK');`;
 const out=await runPrompt(source,[[frame,'alpha/one\x1b[B '],[/Selected 1:[^]*Type search/,'\x1b'],[frame,'\x1b[C'],[/Selected 1:[^]*☑.*alpha\/one[^]*Type search/,'\x1b[C'],[/Selected 1:[^]*☐.*beta\/two[^]*Type search/,'\x1b[B '],[/Selected 2:[^]*Type search/,'no-match'],[/⌕ no-match[^]*Type search/,'\x1b'],[/Selected 2:[^]*Type search/,'\r']],120,{rows:42});assert.match(out,/TABS_OK/);
});

test('custom model additions deduplicate and remain searchable for removal',pty,async()=>{
 const source=head('codebuddy')+`assert.deepEqual(await select(),['vendor/b','vendor/a']);assert.equal(fs.readFileSync(configManager.configFile,'utf8'),before);console.log('CUSTOM_OK');`;
 const out=await runPrompt(source,[[frame,'vendor/a,vendor/b,vendor/a\x1b[B '],[/Selected 2:[^]*Type search/,'\x1b'],[frame,'vendor/a\x1b[B '],[/Selected 1: b[^]*Type search/,' '],[/Selected 2: b · a[^]*Type search/,'\r']],120,{rows:42});assert.match(out,/CUSTOM_OK/);
});

test('show-all retains custom additions and an empty selection cannot continue',pty,async()=>{
 const source=head('codebuddy')+`assert.deepEqual(await select(),['alpha/one']);console.log('ALL_OK');`;
 const out=await runPrompt(source,[[frame,'vendor/new\x1b[B '],[/Selected 1:[^]*Type search/,'\x1b'],[frame,'\x1b[F '],[/Selected 1:[^]*Only models with tool calls[^]*Type search/,'vendor/new\x1b[B '],[/Selected 0:[^]*Type search/,'\t\x1b'],[frame,'alpha/one\x1b[B '],[/Selected 1: one[^]*Type search/,'\r']],120,{rows:42});assert.match(out,/ALL_OK/);
});

test('multi picker keeps the page tidy: no stale key hint in the title and no custom row for a plain word with matches',pty,async()=>{
 const source=head('codebuddy',['alpha/one'])+`assert.deepEqual(await select(),['alpha/one']);console.log('TIDY_OK');`;
 const out=await runPrompt(source,[[frame,'beta'],[/⌕ beta[^]*Type search/,'\x1b'],[/Selected 1:[^]*Type search/,'\r']],120,{rows:42});
 assert.match(out,/TIDY_OK/);
 assert.doesNotMatch(out,/space to select/);
 // 「当前已配置」放在「下一步」的说明区，且只出现在列表上方
 assert.match(out,/Currently configured: one[^]*Next →/);
 const searching=out.slice(out.indexOf('⌕ beta'));
 assert.doesNotMatch(searching.slice(0,searching.indexOf('Type search')),/Use custom model ID/);
});

test('selected summary stays on one line, uses short names and folds the rest',async()=>{
 const {i18n}=await import('../dist/lib/i18n.js');const {selectionSummary}=await import('../dist/lib/wizard/flows/model-pick-flow.js');const {visibleWidth}=await import('../dist/utils/string-width.js');
 i18n.init('en_US');
 const ids=['z-ai/glm-5.2','deepseek/deepseek-v3.2','qwen/qwen3-max','other/qwen3-max','moonshotai/kimi-k2','openai/gpt-5','minimax/minimax-m2'];
 assert.equal(selectionSummary(ids.slice(0,2)),'Selected 2: glm-5.2 · deepseek-v3.2');
 // 短名重复时保留完整 ID，避免看不出是哪家的
 assert.match(selectionSummary(ids),/qwen\/qwen3-max · other\/qwen3-max/);
 for(const width of [12,24,30,50,80]){
  const text=selectionSummary(ids,width,undefined,true);
  assert.ok(visibleWidth(text)<=width,`${width}: ${text}`);
  if(width>=50)assert.match(text,/← to view all/);
  const names=(text.split(': ')[1]??'').split('+')[0];
  const shown=names.trim()?(names.match(/·/g)?.length??0)+1:0;
  if(text.includes('+'))assert.match(text,new RegExp(`\\+${ids.length-shown} more`));
 }
 assert.equal(selectionSummary([]),'Selected 0: —');
});

test('the Selected tab lists only chosen models and removes them in place',pty,async()=>{
 const source=head('codebuddy',['alpha/one'])+`assert.deepEqual(await select(),['beta/two']);console.log('TAB_OK');`;
 const out=await runPrompt(source,[[frame,'beta/two\x1b[B '],[/Selected 2:[^]*Type search/,'\x1b'],[frame,'\x1b[D'],[/ Selected 2 [^]*Type search/,'\x1b[B '],[/Selected 1: two[^]*Type search/,'\r']],120,{rows:42});
 assert.match(out,/TAB_OK/);
 const tab=out.slice(out.lastIndexOf(' Selected 2 '));
 assert.match(tab.slice(0,tab.indexOf('Type search')),/☑ alpha\/one/);
});

for (const tool of ['codebuddy', 'workbuddy']) {
 test(`${tool} keeps search, focus and scroll position while toggling the last search result`, pty, async () => {
  const source = head(tool) + `catalog.splice(0, catalog.length, ...Array.from({length:24}, (_,i) => ({id:'alpha/model-'+String(i).padStart(2,'0'),name:'Model '+i,features:['工具调用'],issuer:{name:'Alpha'}})));assert.deepEqual(await select(),['alpha/model-22']);assert.equal(fs.readFileSync(configManager.configFile,'utf8'),before);console.log('FOCUS_OK');`;
  const out = await runPrompt(source, [
   [frame, 'model-\x1b[F '],
   [/Selected 1:[^]*⌕ model-[^]*❯[^\r\n]*☑ alpha\/model-23[^]*Type search/, ' '],
   [/Selected 0:[^]*⌕ model-[^]*❯[^\r\n]*☐ alpha\/model-23[^]*Type search/, '\x1b[A '],
   [/Selected 1:[^]*⌕ model-[^]*❯[^\r\n]*☑ alpha\/model-22[^]*Type search/, '\r'],
  ], 80, {rows:24});
  assert.match(out, /FOCUS_OK/);
 });
}

test('toggling an unfiltered model keeps its row instead of jumping to Next', pty, async () => {
 const source = head('codebuddy') + `assert.deepEqual(await select(),['beta/two']);console.log('ROW_OK');`;
 const out = await runPrompt(source, [
  [frame, '\x1b[F\x1b[A '],
  [/Selected 1:[^]*❯[^\r\n]*☑ beta\/two[^]*Type search/, ' '],
  [/Selected 0:[^]*❯[^\r\n]*☐ beta\/two[^]*Type search/, ' '],
  [/Selected 1:[^]*❯[^\r\n]*☑ beta\/two[^]*Type search/, '\r'],
 ], 110, {rows:32});
 assert.match(out, /ROW_OK/);
});

test('removing the last Selected row focuses the previous model', pty, async () => {
 const source = head('workbuddy',['alpha/one','beta/two']) + `assert.deepEqual(await select(),['alpha/one']);console.log('NEIGHBOR_OK');`;
 const out = await runPrompt(source, [
  [frame, '\x1b[D'],
  [/ Selected 2 [^]*Type search/, '\x1b[F '],
  [/Selected 1:[^]*❯[^\r\n]*☑ alpha\/one[^]*Type search/, '\r'],
 ], 110, {rows:32});
 assert.match(out, /NEIGHBOR_OK/);
});

test('Enter confirms existing choices without toggling the focused unselected model', pty, async () => {
 const source = head('codebuddy', ['alpha/one']) + `assert.deepEqual(await select(),['alpha/one']);console.log('ENTER_OK');`;
 const out = await runPrompt(source, [[frame, 'beta/two'], [/⌕ beta\/two[^]*Type search/, '\r']], 120, {rows:42});
 assert.match(out, /ENTER_OK/);
});
