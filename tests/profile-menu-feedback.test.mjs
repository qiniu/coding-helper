import assert from 'node:assert/strict';
import test from 'node:test';
import {runPrompt} from './helpers/prompt-pty.mjs';
const source=`import {i18n} from './dist/lib/i18n.js';import {configManager} from './dist/lib/config.js';import {showMainMenu} from './dist/lib/wizard/menus/main-menu.js';configManager.setLang('en_US');i18n.init('en_US');globalThis.fetch=async()=>new Response('{}',{status:401});`;
// 走真实账号菜单与输入，错误提示必须等待确认，返回菜单后可重新操作和正常退出。
test('failed profile creation stays visible until acknowledged and leaves the menu usable',{skip:process.platform==='win32'},async()=>{
 const out=await runPrompt(source+`await showMainMenu();console.log('RESULT',JSON.stringify({exitCode:process.exitCode??0,profiles:configManager.listProfiles().length}));`,[
  [/Connect coding tools[\s\S]*Esc Exit/,'\x1b[B'.repeat(3)+'\r'],
  [/Profiles[\s\S]*Esc back/,'\x1b[B\x1b[B\r'],
  [/New profile[\s\S]*Esc back/,'\r'],
  ['Profile name','work\r'],
  [/Select API endpoint[\s\S]*Esc back/,'\r'],
  ['API Key','invalid-key\r'],
  [/API Key validation failed[\s\S]*Press Enter/,'\r'],
  [/New profile[\s\S]*Esc back/,'\x1b'],
  [/Account & endpoint[\s\S]*Esc back/,'\x1b'],
  [/Connect coding tools[\s\S]*Esc Exit/,'\x1b'],
 ]);
 assert.match(out,/RESULT.*"exitCode":0,"profiles":0/);
 assert.doesNotMatch(out,/invalid-key/);
});

// 没有 Key 的配置档（如当前配置档执行过 auth revoke）不能在菜单里设为当前，否则会把连接切到空 Key
test('a profile without a key cannot be set as current from the profiles menu',{skip:process.platform==='win32'},async()=>{
 const setup=`configManager.saveProfile('empty','sk-empty00000000000000','china');configManager.useProfile('empty');configManager.revokeApiKey();configManager.saveProfile('home','sk-home000000000000000','china');configManager.useProfile('home');`;
 const pick=text=>{const screen=text.slice(text.lastIndexOf('? Select action'));const rows=screen.split('\n').filter(line=>/^\s*(❯)?\s*[●○]\s/.test(line));return '\x1b[B'.repeat(Math.max(0,rows.findIndex(line=>line.includes('empty'))))+'\r';};
 const out=await runPrompt(source+setup+`await showMainMenu();console.log('RESULT',JSON.stringify({active:configManager.getActiveProfile(),keySet:!!configManager.getApiKey()}));`,[
  [/Connect coding tools[\s\S]*Esc Exit/,'\x1b[B'.repeat(3)+'\r'],
  [/Profiles[\s\S]*Esc back/,'\x1b[B\x1b[B\r'],
  [/New profile[\s\S]*Esc back/,pick],
  // 「设为当前」显示未设置 Key 且不可选，光标停在下一项
  [/Profile empty[\s\S]*Use this profile\s+API Key not set\s*\n\s*❯\s+Test connection[\s\S]*Esc back/,'\x1b'],
  [/New profile[\s\S]*Esc back/,'\x1b'],
  [/Account & endpoint[\s\S]*Esc back/,'\x1b'],
  [/Connect coding tools[\s\S]*Esc Exit/,'\x1b'],
 ],100,{rows:40});
 assert.match(out,/RESULT.*"active":"home","keySet":true/);
 assert.doesNotMatch(out,/sk-empty|sk-home/);
});
