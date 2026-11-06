import assert from 'node:assert/strict'; import test from 'node:test';
import { runPrompt } from './helpers/prompt-pty.mjs';
const head = `import { menuPrompt } from './dist/lib/wizard/ui/prompts.js';`;
const options = `{message:'MENU_READY',escape:true,items:[{value:'a',label:'Alpha'},{value:'b',label:'Beta'}]}`;
test('real PTY menu arrows select a row in a narrow terminal', { skip: process.platform === 'win32' }, async () => {
 const out = await runPrompt(head + `console.log('RESULT', JSON.stringify(await menuPrompt(${options})));`, [['MENU_READY', '\x1b[B'], ['Beta', '\r']], 32);
 assert.match(out, /RESULT.*"value":"b"/);
});
test('real PTY empty search supports clearing then Esc cancellation', { skip: process.platform === 'win32' }, async () => {
 const out = await runPrompt(head + `console.log('RESULT', JSON.stringify(await menuPrompt({...${options},searchable:true})));`, [['MENU_READY', 'zzzz'], ['zzzz', '\x1b'], ['Alpha', '\x1b']], 40);
 assert.match(out, /RESULT.*"action":"escape"/);
});
test('async details retain concurrent results and object value identity', { skip: process.platform === 'win32' }, async () => {
 const source = head + `const calls = []; const a = {}, b = {}; const result = await menuPrompt({message:'DETAIL_READY',items:[{value:a,label:'Alpha'},{value:b,label:'Beta'}],asyncDetail: async item => { calls.push(item.label); await new Promise(r => setTimeout(r, item.value === a ? 500 : 100)); console.log('LOADED_' + item.label); return 'DETAIL_' + item.label; }}); console.log('RESULT', JSON.stringify(calls));`;
 const out = await runPrompt(source, [['DETAIL_READY', '\x1b[B'], ['LOADED_Alpha', '\x1b[A'], ['DETAIL_Alpha', '\x1b[B'], ['DETAIL_Beta', '\r']]);
 assert.match(out, /RESULT.*\["Alpha","Beta"\]/);
});
test('async details handle inherited-property names and synchronous loader errors', { skip: process.platform === 'win32' }, async () => {
 const out = await runPrompt(head + `console.log('RESULT',JSON.stringify(await menuPrompt({message:'DETAIL_READY',items:[{value:'constructor',label:'Alpha'},{value:'b',label:'Beta'}],asyncDetail:item => { if(item.value === 'constructor') throw Error('optional detail'); return 'DETAIL_Beta'; }})));`, [['DETAIL_READY', '\x1b[B'], ['DETAIL_Beta', '\r']]);
 assert.match(out, /RESULT.*"value":"b"/); assert.doesNotMatch(out, /native code/);
});
test('search accepts supplementary Unicode characters', { skip: process.platform === 'win32' }, async () => {
 const out = await runPrompt(head + `console.log('RESULT',JSON.stringify(await menuPrompt({message:'UNICODE_READY',searchable:true,items:[{value:'a',label:'Alpha'},{value:'b',label:'Beta😀'}]})));`, [['UNICODE_READY','😀'], ['😀','\r']]);
 assert.match(out, /RESULT.*"value":"b"/); assert.match(out, /"query":"😀"/);
 assert.doesNotMatch(out, /Esc.*back/);
});

test('unmatched explicit custom values take priority over suggestions', {skip:process.platform==='win32'},async()=>{
 const out=await runPrompt(head+`console.log('RESULT',JSON.stringify(await menuPrompt({message:'CUSTOM_READY',searchable:true,items:[{value:'known',label:'Known'}],suggest:()=>[{value:'known',label:'Known'}],customLabel:q=>'Use '+q})));`,[['CUSTOM_READY','vendor/new'],['vendor/new','\r']]);assert.match(out,/"action":"custom"/);assert.match(out,/"query":"vendor\/new"/);
});
// 搜索框闪烁光标：空输入时在占位文字起始处，输入后跟在搜索词末尾，清空后回到占位文字前；退出时恢复终端光标
test('real PTY search box shows a blinking cursor before the placeholder, after the query and after clearing', { skip: process.platform === 'win32' }, async () => {
 const src = head + `console.log('RESULT', JSON.stringify(await menuPrompt({message:'SEARCH_READY',escape:true,searchable:true,placeholder:'TYPE_HERE',items:[{value:'qwen',label:'qwen-max'},{value:'k',label:'kimi'}]})));`;
 const raw = await runPrompt(src, [[/TYPE_HERE[^]*TYPE_HERE/, 'q'], [/⌕ q /, 'w'], [/⌕ qw /, '\x7f'], [/⌕ q /, '\x7f'], [/⌕ {1,2}TYPE_HERE[^]*⌕ {1,2}TYPE_HERE/, '\x1b']], 60, { raw: true });
 const sgr = '(?:\\x1b\\[[\\d;]*m)*';
 const cursor = '\\x1b\\[(?:4\\d|10\\d)[\\d;]*m \\x1b\\[49m';
 // 第一次出现搜索词的搜索行（列表里的 qwen-max 不算）
 const typed = raw.search(new RegExp(`⌕${sgr} ${sgr}q`)), cleared = raw.lastIndexOf('TYPE_HERE');
 assert.ok(typed > 0, 'query never rendered');
 // 空输入：亮与灭两帧都出现（会闪烁），光标位于占位文字之前
 const before = raw.slice(0, typed);
 assert.match(before, new RegExp(`⌕${sgr} ${cursor}${sgr}TYPE_HERE`));
 assert.match(before, new RegExp(`⌕${sgr}  ${sgr}TYPE_HERE`));
 // 输入后：光标跟在搜索词末尾
 assert.match(raw, new RegExp(`qw${sgr}${cursor}`));
 // 清空后：光标回到占位文字之前
 assert.match(raw.slice(typed), new RegExp(`⌕${sgr} (?:${cursor})?${sgr}TYPE_HERE`));
 assert.ok(cleared > typed);
 // Esc 退出后恢复终端光标
 assert.ok(raw.slice(cleared).includes('\x1B[?25h'), 'cursor not restored');
 assert.match(raw, /RESULT.*"action":"escape"/);
});
// 长列表：打开时当前项居中并带 ▪ 标记，列表下方提示上下还有几项，PgUp / PgDn / Home / End 翻页
const longMenu = head + `import {i18n} from './dist/lib/i18n.js';i18n.init('zh_CN');const items=Array.from({length:40},(_,i)=>({value:'m'+i,label:'model-'+String(i).padStart(2,'0'),current:i===20}));console.log('RESULT',JSON.stringify(await menuPrompt({message:'LONG_READY',escape:true,pageSize:10,default:'m20',items})));`;
const lastMenuFrame = text => text.slice(text.lastIndexOf('? LONG_READY'));
test('real PTY long menu centers the current item, marks it and shows how many rows are hidden', { skip: process.platform === 'win32' }, async () => {
 const out = await runPrompt(longMenu, [[/下面还有[^]*返回/, '\r']], 60, { rows: 24 });
 const frame = lastMenuFrame(out.slice(0, out.lastIndexOf('✔')));
 assert.match(frame, /❯▪ model-20/);
 // 当前项在 10 行窗口的中间：model-15 … model-24
 assert.match(frame, /model-15[^]*model-24/);
 assert.ok(!frame.includes('model-14') && !frame.includes('model-25'), frame);
 assert.match(frame, /↑ 上面还有 15 个 +↓ 下面还有 15 个/);
 assert.match(frame, /PgUp\/PgDn 翻页/);
 assert.match(out, /RESULT \{"value":"m20"/);
});
for (const [name, keys, value] of [['PageDown', '\x1b[6~', 'm30'], ['PageUp', '\x1b[5~', 'm10'], ['Home', '\x1b[H', 'm0'], ['End', '\x1b[F', 'm39']]) {
 test(`real PTY long menu ${name} jumps to ${value}`, { skip: process.platform === 'win32' }, async () => {
  const out = await runPrompt(longMenu, [[/下面还有[^]*返回/, keys], [new RegExp(`❯ ? ?model-${value.slice(1).padStart(2, '0')}`), '\r']], 60, { rows: 24 });
  assert.match(out, new RegExp(`RESULT \\{"value":"${value}"`));
 });
}
// 不超出一页的短菜单：不显示「还有几个」，也不提示翻页键
test('real PTY short menu shows no overflow hint or page keys', { skip: process.platform === 'win32' }, async () => {
 const out = await runPrompt(head + `import {i18n} from './dist/lib/i18n.js';i18n.init('zh_CN');console.log('RESULT',JSON.stringify(await menuPrompt({message:'SHORT_READY',escape:true,items:[{value:'a',label:'Alpha'},{value:'b',label:'Beta'}]})));`, [[/返回/, '\r']], 60);
 assert.ok(!/还有|PgUp/.test(out), out);
});
