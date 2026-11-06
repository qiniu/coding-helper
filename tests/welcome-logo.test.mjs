import assert from 'node:assert/strict'; import test from 'node:test'; import { runPrompt } from './helpers/prompt-pty.mjs';
// 首次向导首页：常见短终端也显示官方七牛标志；极小窗口才退回文字，保持选项与操作提示在一屏内。
const source = `import chalk from 'chalk';import {i18n} from './dist/lib/i18n.js';import {runLanguageFlow} from './dist/lib/wizard/flows/language-flow.js';chalk.level=3;i18n.init('zh_CN');
console.log('RESULT', await runLanguageFlow({current:1,total:6}));`;
const strip = text => text.replace(/\x1B(?:[@-Z\\-_a-z]|\[[0-?]*[ -/]*[@-~])/g, '');

async function welcome(columns, rows) {
  const raw = await runPrompt(source, [[/Esc/, '\r']], columns, { rows, raw: true });
  // 只看最后一次清屏后、选择语言之前的画面
  const page = strip(raw.slice(raw.lastIndexOf('\x1Bc') + 2)).split('? 请选择语言')[0] + '? 请选择语言';
  const lines = strip(raw.slice(raw.lastIndexOf('\x1Bc') + 2)).split(/\r?\n/);
  const used = lines.findIndex(line => line.includes('Esc')) + 1;
  return { page, used, raw: strip(raw), colored: raw };
}

for (const [columns, rows, logo] of [[100, 40, true], [100, 24, true], [60, 34, true], [60, 29, true], [100, 22, false]]) {
  test(`welcome page at ${columns}x${rows} ${logo ? 'shows' : 'falls back from'} the pixel logo and keeps everything on one screen`, { skip: process.platform === 'win32' }, async () => {
    const { page, used, raw, colored } = await welcome(columns, rows);
    assert.equal(/[▀▄█]/.test(page), logo, page);
    if (!logo) assert.match(page, /QINIU Coding Helper/);
    if (logo) assert.match(colored, /38;2;41;168;225m/, 'official Qiniu blue is missing');
    for (const text of ['1 / 6', '欢迎使用', '中文', 'English', 'Esc']) assert.ok(raw.includes(text), `${text} missing`);
    assert.ok(used > 0 && used < rows, `page uses ${used} of ${rows} rows`);
    assert.match(raw, /RESULT true/);
  });
}
