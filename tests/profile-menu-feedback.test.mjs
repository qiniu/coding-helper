import assert from 'node:assert/strict';
import test from 'node:test';
import {runPrompt} from './helpers/prompt-pty.mjs';
const source=`import {i18n} from './dist/lib/i18n.js';import {configManager} from './dist/lib/config.js';import {showMainMenu} from './dist/lib/wizard/menus/main-menu.js';configManager.setLang('en_US');i18n.init('en_US');globalThis.fetch=async()=>new Response('{}',{status:401});`;
// 走真实账号菜单与输入，错误提示必须等待确认，返回菜单后可重新操作和正常退出。
test('failed profile creation stays visible until acknowledged and leaves the menu usable',{skip:process.platform==='win32'},async()=>{
 const out=await runPrompt(source+`await showMainMenu();console.log('RESULT',JSON.stringify({exitCode:process.exitCode??0,profiles:configManager.listProfiles().length}));`,[
  [/Connect coding tools[\s\S]*Esc Exit/,'\x1b[B'.repeat(3)+'\r'],
  [/Profiles[\s\S]*Esc back/,'\x1b[B\x1b[B\r'],
  [/Add profile[\s\S]*Esc back/,'\r'],
  ['Profile name','work\r'],
  [/Select API endpoint[\s\S]*Esc back/,'\r'],
  ['API Key','invalid-key\r'],
  [/Profile operation failed\.[\s\S]*Press Enter/,'\r'],
  [/Profiles[\s\S]*Esc back/,'\x1b'],
  [/Connect coding tools[\s\S]*Esc Exit/,'\x1b'],
 ]);
 assert.match(out,/RESULT.*"exitCode":0,"profiles":0/);
 assert.doesNotMatch(out,/invalid-key/);
});
