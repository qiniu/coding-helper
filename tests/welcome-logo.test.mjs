import assert from 'node:assert/strict'; import test from 'node:test'; import { runPrompt } from './helpers/prompt-pty.mjs';
// 首次向导首页：终端够高时显示完整 Logo；不够高时退回一行标题。两种情况下进度、欢迎卡片、语言选项与操作提示都必须在一屏内
const source = `import chalk from 'chalk';import {i18n} from './dist/lib/i18n.js';import {runLanguageFlow} from './dist/lib/wizard/flows/language-flow.js';chalk.level=3;i18n.init('zh_CN');
console.log('RESULT', await runLanguageFlow({current:1,total:6}));`;
const strip = text => text.replace(/\x1B(?:[@-Z\\-_a-z]|\[[0-?]*[ -/]*[@-~])/g, '');

async function welcome(columns, rows) {
  const raw = await runPrompt(source, [[/Esc/, '\r']], columns, { rows, raw: true });
  // 只看最后一次清屏后、选择语言之前的画面
  const page = strip(raw.slice(raw.lastIndexOf('\x1Bc') + 2)).split('? 请选择语言')[0] + '? 请选择语言';
  const lines = strip(raw.slice(raw.lastIndexOf('\x1Bc') + 2)).split(/\r?\n/);
  const used = lines.findIndex(line => line.includes('Esc')) + 1;
  return { page, used, raw: strip(raw) };
}

for (const [columns, rows, logo] of [[100, 40, true], [100, 24, false], [60, 34, true], [60, 29, false]]) {
  test(`welcome page at ${columns}x${rows} ${logo ? 'shows' : 'falls back from'} the pixel logo and keeps everything on one screen`, { skip: process.platform === 'win32' }, async () => {
    const { page, used, raw } = await welcome(columns, rows);
    assert.equal(/[▀▄█]/.test(page), logo, page);
    if (!logo) assert.match(page, /QINIU Coding Helper/);
    for (const text of ['1 / 6', '欢迎使用', '中文', 'English', 'Esc']) assert.ok(raw.includes(text), `${text} missing`);
    assert.ok(used > 0 && used < rows, `page uses ${used} of ${rows} rows`);
    assert.match(raw, /RESULT true/);
  });
}
