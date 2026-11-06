import assert from 'node:assert/strict'; import test from 'node:test'; import { runPrompt } from './helpers/prompt-pty.mjs';
const head = `import { checkPrompt, secretPrompt, textPrompt } from './dist/lib/wizard/ui/prompts.js';`;
test('real PTY secret entry masks pasted credentials and Esc cancels', { skip: process.platform === 'win32' }, async () => {
 const out = await runPrompt(head + `const v = await secretPrompt({message:'SECRET_READY',escape:true}); console.log('RESULT', v === undefined ? 'cancel' : v.length);`, [['SECRET_READY', 'sk-test-credential-123456789'], [String('sk-test-credential-123456789'.length), '\x1b']]);
 assert.match(out, /RESULT.*cancel/); assert.equal(out.includes('sk-test-credential-123456789'), false); assert.doesNotMatch(out, /sk-t|6789|credential/); assert.doesNotMatch(out, /✔ SECRET_READY/);
});
test('real PTY text cancellation differs from confirming an empty value', { skip: process.platform === 'win32' }, async () => {
 const out = await runPrompt(head + `console.log('RESULT', JSON.stringify(await textPrompt({message:'TEXT_READY'})) ?? 'cancel');`, [['TEXT_READY', '\x1b']]); assert.match(out, /RESULT.*cancel/);
});
test('real PTY checkbox Esc returns undefined without choosing an item', { skip: process.platform === 'win32' }, async () => {
 const out = await runPrompt(head + `console.log('RESULT', JSON.stringify(await checkPrompt({message:'CHECK_READY',items:[{value:'a',label:'Alpha'},{value:'b',label:'Beta'}]})) ?? 'cancel');`, [['CHECK_READY', '\x1b']]); assert.match(out, /RESULT.*cancel/);
});

test('Select all includes unspecified preferences and preserves excluded selections', { skip: process.platform === 'win32' }, async () => {
 const out = await runPrompt(head + `console.log('RESULT',JSON.stringify(await checkPrompt({message:'CHECK_READY',items:[{value:'a',label:'Alpha'},{value:'b',label:'Beta'},{value:'c',label:'Excluded',preferred:false,checked:true}]})));`, [['CHECK_READY','\x1b[A'], ['❯ ☐',' '], ['❯ ☑','\x1b[C']]);
 assert.match(out, /RESULT.*\["a","b","c"\]/);
});

for (const [label, checked, allowEmpty] of [
 ['all selected', [true, true], false],
 ['partly selected', [true, false], false],
 ['empty allowed', [false, false], true],
]) {
 test(`Enter on Select all confirms the current selection: ${label}`, {skip:process.platform==='win32'}, async () => {
  const items = ['a','b'].map((value,i) => ({value,label:value,checked:checked[i]}));
  const out = await runPrompt(head + `console.log('RESULT',JSON.stringify(await checkPrompt({message:'CHECK_READY',allowEmpty:${allowEmpty},items:${JSON.stringify(items)}})));`, [
   ['CHECK_READY','\x1b[A'], [/❯ [☐☑]/,'\r'],
  ]);
  assert.match(out, new RegExp('RESULT.*'+JSON.stringify(items.filter(item=>item.checked).map(item=>item.value)).replace(/[\[\]]/g,'\\$&')));
 });
}

test('Enter on an empty Select all row warns; Space selects all and Enter continues', {skip:process.platform==='win32'}, async () => {
 const out = await runPrompt(head + `import {i18n} from './dist/lib/i18n.js';i18n.init('en_US');console.log('RESULT',JSON.stringify(await checkPrompt({message:'CHECK_READY',items:[{value:'a',label:'Alpha'},{value:'b',label:'Beta'}]})));`, [
  ['CHECK_READY','\x1b[A'], ['❯ ☐','\r'], ['Select at least one',' '], ['❯ ☑','\r'],
 ]);
 assert.match(out,/RESULT.*\["a","b"\]/);
});

test('Space on Select all still clears selections without submitting', {skip:process.platform==='win32'}, async () => {
 const out = await runPrompt(head + `console.log('RESULT',JSON.stringify(await checkPrompt({message:'CHECK_READY',allowEmpty:true,items:[{value:'a',label:'Alpha',checked:true},{value:'b',label:'Beta',checked:true}]})));`, [
  ['CHECK_READY','\x1b[A'], ['❯ ☑',' '], ['❯ ☐','\r'],
 ]);
 assert.match(out,/RESULT.*\[\]/);
});
test('text cursor follows Left and Home while editing a default value', { skip: process.platform === 'win32' }, async () => {
 const out = await runPrompt(head + `console.log('RESULT',JSON.stringify(await textPrompt({message:'TEXT_READY',default:'abc'})));`, [['TEXT_READY','\x1b[D'], ['abc','X'], ['abXc','\r']], 80, {raw:true});
 assert.match(out, /ab\x1b\[(?:48;5;45|48;2;25;194;240)mc/);
 assert.match(out, /RESULT.*"abXc"/);
});
test('large checkbox lists window rows around the active item', { skip: process.platform === 'win32' }, async () => {
 const out = await runPrompt(head + `console.log('RESULT',JSON.stringify(await checkPrompt({message:'CHECK_READY',items:Array.from({length:32},(_,i)=>({value:i,label:'Item-'+i}))})));`, [['CHECK_READY','\x1b[A'], ['❯ ☐','\x1b[B'.repeat(30)], ['Item-29',' '], ['☑ Item-29','\x1b[C']], 80, {rows:18});
 assert.match(out, /RESULT.*\[29\]/);
 // 初始帧必须容纳标题、全选、列表窗口、继续与提示。
 const firstFrame = out.slice(0,out.indexOf('? CHECK_READY',out.indexOf('? CHECK_READY')+1));
 assert.ok(firstFrame.split('\n').length <= 18, firstFrame);
});

test('typing letters in a checklist never toggles items', { skip: process.platform === 'win32' }, async () => {
 // 字母不是快捷键：打 "claude"（含 a）或 n 都不改变勾选，→ 继续时只带上原本勾选的项
 const out = await runPrompt(head + `console.log('RESULT',JSON.stringify(await checkPrompt({message:'CHECK_READY',allowEmpty:true,items:[{value:'a',label:'Alpha'},{value:'b',label:'Beta',checked:true}]})));`, [['CHECK_READY','claude' + 'n' + '\x1b[C']]);
 assert.match(out, /RESULT.*\["b"\]/);
});
