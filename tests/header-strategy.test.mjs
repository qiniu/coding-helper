import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// 隔离 HOME，避免读到本机配置
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'header-strategy-'));
process.env.HOME = home; process.env.USERPROFILE = home;
const { default: chalk } = await import('chalk');
const { uiRenderer, PAGE_BODY_ROWS } = await import('../dist/lib/wizard/ui/ui-renderer.js');
const { logger } = await import('../dist/utils/logger.js');
const { stripAnsi, visibleWidth } = await import('../dist/utils/string-width.js');

function withTerminal(columns, rows, fn) {
  const saved = ['columns', 'rows', 'isTTY'].map(name => [name, Object.getOwnPropertyDescriptor(process.stdout, name)]);
  const level = chalk.level, log = logger.log, newLine = logger.newLine, write = process.stdout.write;
  const lines = [];
  try {
    chalk.level = 3;
    for (const [name, value] of [['columns', columns], ['rows', rows], ['isTTY', true]]) Object.defineProperty(process.stdout, name, { value, configurable: true });
    logger.log = line => lines.push(line ?? ''); logger.newLine = () => lines.push('');
    process.stdout.write = () => true;
    return fn(lines);
  } finally {
    chalk.level = level; logger.log = log; logger.newLine = newLine; process.stdout.write = write;
    for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(process.stdout, name, descriptor); else delete process.stdout[name]; }
  }
}

test('every page header falls back full → compact mark → title by remaining rows', () => {
  // 不同页面传入的 bodyRows：默认页、欢迎页、模型选择页、长列表
  for (const bodyRows of [PAGE_BODY_ROWS, 14, 28, 40]) {
    for (const [columns, rows] of [[100, 60], [100, 40], [80, 24], [60, 30], [40, 20]]) {
      withTerminal(columns, rows, lines => {
        const mode = uiRenderer.headerMode({ bodyRows });
        uiRenderer.renderHeader({ bodyRows });
        const plain = lines.map(stripAnsi).join('\n');
        const used = lines.length;
        assert.ok(lines.every(line => visibleWidth(line) <= columns), `${columns}x${rows} body ${bodyRows} width`);
        if (mode === 'title') {
          assert.match(plain, /QINIU Coding Helper/);
          assert.ok(!uiRenderer.compactLogoFits(bodyRows), 'title only when the compact mark cannot fit');
        } else {
          assert.match(plain, /[▀▄█]/, `${columns}x${rows} body ${bodyRows} keeps the pixel mark`);
          assert.ok(used + bodyRows + 1 <= rows, `${columns}x${rows} body ${bodyRows}: header ${used} rows leaves room for the page`);
        }
      });
    }
  }
});

test('compact mark is used on any page, not only the welcome page', () => {
  withTerminal(80, 24, () => {
    // 80×24：主菜单（11 行）与欢迎页（14 行）放不下完整 Logo，但放得下紧凑牛头；默认 18 行的页面空间不足，退回一行标题
    assert.equal(uiRenderer.headerMode({ bodyRows: 11 }), 'compact');
    assert.equal(uiRenderer.headerMode({ bodyRows: 14 }), 'compact');
    assert.equal(uiRenderer.headerMode({}), 'title');
  });
  withTerminal(100, 40, () => {
    // 40 行终端的模型选择页：整页约 28 行，用紧凑牛头而不是一行文字
    assert.equal(uiRenderer.headerMode({ bodyRows: 28 }), 'compact');
    assert.equal(uiRenderer.headerMode({}), 'full');
  });
  withTerminal(80, 30, lines => {
    uiRenderer.renderHeader('opencode');
    assert.match(lines.map(stripAnsi).join('\n'), /› opencode/i);
  });
});

test('locale files have no duplicate keys', () => {
  for (const locale of ['en_US', 'zh_CN']) {
    const keys = [...fs.readFileSync(new URL(`../src/locales/${locale}.json`, import.meta.url), 'utf8').matchAll(/^\s*"([^"]+)"\s*:/gm)].map(m => m[1]);
    const dup = keys.filter((key, i) => keys.indexOf(key) !== i);
    assert.deepEqual(dup, [], `${locale} duplicate keys`);
  }
  const zh = JSON.parse(fs.readFileSync(new URL('../src/locales/zh_CN.json', import.meta.url), 'utf8'));
  const en = JSON.parse(fs.readFileSync(new URL('../src/locales/en_US.json', import.meta.url), 'utf8'));
  assert.match(zh.dsh_config_note, /Desktop/);
  assert.match(en.dsh_config_note, /Desktop/);
});
