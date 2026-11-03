import assert from 'node:assert/strict'; import test from 'node:test'; import { runPrompt } from './helpers/prompt-pty.mjs';
// 安装检测抛错（PATH、权限、探测命令异常）时，「我的工具」回车与工具页都不能打断菜单
test('My tools Enter and the tool page survive an install detection that throws', { skip: process.platform === 'win32' }, async () => {
  const source = `import {i18n} from './dist/lib/i18n.js';import {toolManager} from './dist/lib/tool-manager.js';import {showMainMenu} from './dist/lib/wizard/menus/main-menu.js';i18n.init('en_US');
const tool={name:'probe-broken',displayName:'Broken Probe',command:'broken-probe',installCommand:'npm i -g broken-probe',isInstalled(){throw new Error('EACCES probe');},getVersion(){throw new Error('EACCES version');},isConfigured:()=>false,launchOnly:false,runModelConfigFlow:async()=>false,loadConfig:async()=>{},unloadConfig:async()=>{}};
toolManager.getAll=()=>[tool];toolManager.get=name=>name===tool.name?tool:undefined;
await showMainMenu();console.log('RESULT done');`;
  const out = await runPrompt(source, [[/Esc Exit/i, '\x1b[B\x1b[B\r'], [/Broken Probe[\s\S]*?Esc back/, '\r'], [/Broken Probe Configuration[\s\S]*?Esc back/, '\x1b'], [/Broken Probe[\s\S]*?Esc back/, '\x1b'], [/Esc Exit/i, '\x1b']], 100, { rows: 40 });
  assert.match(out, /RESULT done/); assert.doesNotMatch(out, /EACCES/);
});
