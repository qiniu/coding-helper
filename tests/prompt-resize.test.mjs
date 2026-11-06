import assert from 'node:assert/strict';
import test from 'node:test';
import { stripAnsi } from '../dist/utils/string-width.js';
import { runPrompt } from './helpers/prompt-pty.mjs';

const pre=`import {i18n} from './dist/lib/i18n.js';import {uiRenderer} from './dist/lib/wizard/ui/ui-renderer.js';import {logger} from './dist/utils/logger.js';import {menuPrompt,checkPrompt} from './dist/lib/wizard/ui/prompts.js';i18n.init('en_US');uiRenderer.renderPage('STATIC_PAGE');logger.log('CURRENT_MODEL remains visible');const listeners=process.stdout.listenerCount('resize');`;
const resized={resize:{columns:60,rows:24}};

test('an already aborted prompt never creates an input renderer',async()=>{
  const {resumeOnResize}=await import('../dist/lib/wizard/ui/prompt-resize.js');
  let starts=0;const before=process.stdout.listenerCount('resize');
  await assert.rejects(resumeOnResize(async()=>{starts++;return 'unexpected';},AbortSignal.abort('cancelled')),{name:'AbortPromptError'});
  assert.equal(starts,0);assert.equal(process.stdout.listenerCount('resize'),before);
});

test('real PTY resize starts a clean frame and preserves search plus selected model',{skip:process.platform==='win32'},async()=>{
  const source=pre+`const result=await menuPrompt({get message(){return 'MENU_'+process.stdout.columns+'x'+process.stdout.rows;},escape:true,searchable:true,detailPosition:'top',items:Array.from({length:40},(_,i)=>({value:'m'+i,label:'model-'+String(i).padStart(2,'0'),description:'Model capability information\\nTools supported'}))});console.log('RESULT',JSON.stringify(result),'LISTENERS',process.stdout.listenerCount('resize')===listeners);`;
  const raw=await runPrompt(source,[
    [/MENU_140x40[^]*Type search/,'model-2'],
    [/⌕ model-2[^]*Enter confirm/,'\x1b[B'],
    [/❯ +model-21[^]*Enter confirm/,'\x1b[B'],
    [/❯ +model-22[^]*Enter confirm/,resized],
    [/MENU_60x24[^]*❯ +model-22[^]*Enter confirm/,'\r'],
  ],140,{rows:40,raw:true});
  const last=raw.slice(raw.lastIndexOf('\x1Bc'));
  assert.match(last,/STATIC_PAGE/);assert.match(last,/CURRENT_MODEL remains visible/);
  assert.match(last,/MENU_60x24/);assert.match(last,/model-2/);
  assert.match(stripAnsi(raw),/RESULT.*"value":"m22".*"query":"model-2".*LISTENERS true/);
});

test('real PTY resize preserves the vendor tab and focus',{skip:process.platform==='win32'},async()=>{
  const source=pre+`console.log('RESULT',JSON.stringify(await menuPrompt({get message(){return 'TABS_'+process.stdout.columns;},escape:true,items:[{value:'a0',label:'alpha-0'},{value:'b0',label:'beta-0'},{value:'b1',label:'beta-1'}],tabs:[{label:'All',match:()=>true},{label:'Alpha',match:i=>i.value.startsWith('a')},{label:'Beta',match:i=>i.value.startsWith('b')}]})));`;
  const out=await runPrompt(source,[
    [/TABS_140[^]*Esc back/,'\x1b[C'],
    [/TABS_140[^]*alpha-0[^]*Esc back/,'\x1b[C'],
    [/TABS_140[^]*❯ +beta-0[^]*Esc back/,'\x1b[B'],
    [/❯ +beta-1[^]*Esc back/,resized],
    [/TABS_60[^]*❯ +beta-1[^]*Esc back/,'\r'],
  ],140,{rows:40});
  assert.match(out,/RESULT.*"value":"b1"/);
});

test('real PTY resize preserves checked tools and the active checkbox row',{skip:process.platform==='win32'},async()=>{
  const source=pre+`console.log('RESULT',JSON.stringify(await checkPrompt({get message(){return 'CHECK_'+process.stdout.columns;},items:[{value:'a',label:'Item A'},{value:'b',label:'Item B'}]})));`;
  const out=await runPrompt(source,[
    [/CHECK_140[^]*Esc back/,' \x1b[B'],
    [/☑ Item A[^]*❯ ☐ Item B[^]*Esc back/,resized],
    [/CHECK_60[^]*☑ Item A[^]*❯ ☐ Item B[^]*Esc back/,' \x1b[C'],
  ],140,{rows:40});
  assert.match(out,/RESULT \["a","b"\]/);
});

test('real PTY resize keeps pending details without repeating the request',{skip:process.platform==='win32'},async()=>{
  const source=pre+`let calls=0;const result=await menuPrompt({get message(){return 'DETAIL_'+process.stdout.columns;},escape:true,items:[{value:'a',label:'Alpha'}],asyncDetail:async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,700));return 'LOADED_DETAIL';}});console.log('RESULT',result.value,'CALLS',calls);`;
  const out=await runPrompt(source,[
    [/DETAIL_140[^]*Esc back/,resized],
    [/DETAIL_60[^]*LOADED_DETAIL[^]*Esc back/,'\r'],
  ],140,{rows:40});
  assert.match(out,/RESULT a CALLS 1/);
});
