import assert from 'node:assert/strict'; import test from 'node:test'; import { runPrompt } from './helpers/prompt-pty.mjs';
// 安装命令在真实终端里执行：成功后重新检测；失败时显示退出码且不进入配置
const tool = (command) => `import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {i18n} from './dist/lib/i18n.js';import {installTool} from './dist/lib/wizard/menus/tool-menu.js';i18n.init('en_US');
const marker=path.join(os.homedir(),'installed');const tool={name:'demo',displayName:'Demo CLI',command:'demo-cli',installCommand:${JSON.stringify(command)},isInstalled:()=>fs.existsSync(marker),getVersion:()=>'1.2.3'};
console.log('RESULT',await installTool(tool));`;

test('Enter installs a missing CLI and reports the detected version', { skip: process.platform === 'win32' }, async () => {
  const out = await runPrompt(tool(`node -e "require('fs').writeFileSync(require('path').join(require('os').homedir(),'installed'),'')"`), [[/Install Demo CLI\?[\s\S]*?Esc back/, '\r'], [/Press Enter to continue/, '\r']], 100, { rows: 30 });
  assert.match(out, /Demo CLI v1\.2\.3 installed/); assert.match(out, /RESULT true/);
});

test('a failing install shows the exit status and returns false', { skip: process.platform === 'win32' }, async () => {
  const out = await runPrompt(tool('node -e "process.exit(3)"'), [[/Install Demo CLI\?[\s\S]*?Esc back/, '\r'], [/Press Enter/, '\r']], 100, { rows: 30 });
  assert.match(out, /exit status: 3/); assert.match(out, /RESULT false/);
});

test('Esc leaves without running the install command', { skip: process.platform === 'win32' }, async () => {
  const out = await runPrompt(tool('node -e "process.exit(9)"'), [[/Install Demo CLI\?[\s\S]*?Esc back/, '\x1b']], 100, { rows: 30 });
  assert.match(out, /RESULT false/); assert.doesNotMatch(out, /exit status/);
});
