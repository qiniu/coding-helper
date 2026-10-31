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
