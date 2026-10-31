import assert from 'node:assert/strict';import test from 'node:test';import {runPrompt} from './helpers/prompt-pty.mjs';
test('Codex menu and version-refresh redraw fit an 80 by 24 terminal',{skip:process.platform==='win32'},async()=>{
 const source=`import {i18n} from './dist/lib/i18n.js';import {configManager} from './dist/lib/config.js';configManager.setLang('en_US');i18n.init();globalThis.fetch=async()=>{await new Promise(r=>setTimeout(r,200));return new Response(JSON.stringify({version:'1.0.0'}));};const {toolManager}=await import('./dist/lib/tool-manager.js');const {showToolMenu}=await import('./dist/lib/wizard/menus/tool-menu.js');const tool=toolManager.get('codex');tool.getVersion=()=> '1.0.0';tool.isInstalled=()=>true;await showToolMenu(tool);console.log('RESULT done');`;
 const out=await runPrompt(source,[['Select action',''],['Up to date','\x1b']],80,{rows:24,raw:true});
 const frames=out.split('\x1bc').slice(1);assert.equal(frames.length,1);assert.match(out,/Up to date/);assert.doesNotMatch(out,/\^\[/);
 const strip=value=>value.replace(/\x1B(?:[@-Z\\-_a-z]|\[[0-?]*[ -/]*[@-~])/g,'');
 for(const frame of frames){const page=strip(frame).split('Select action')[0];assert.ok(page.split('\n').length+10<=24,page);}
});
