import assert from 'node:assert/strict'; import fs from 'node:fs'; import test from 'node:test';
// 主菜单标语：数字统一用阿拉伯数字，数量取自已注册工具（文案里不写死数字）
const zh = JSON.parse(fs.readFileSync(new URL('../src/locales/zh_CN.json', import.meta.url), 'utf8'));
const en = JSON.parse(fs.readFileSync(new URL('../src/locales/en_US.json', import.meta.url), 'utf8'));
const { toolManager } = await import('../dist/lib/tool-manager.js');
const { i18n, t } = await import('../dist/lib/i18n.js');

test('header tagline uses digits consistently and matches the registered tool count', () => {
  const count = String(toolManager.getAll().length);
  assert.match(zh.header_tagline, /\{\{count\}\}/);
  assert.match(en.header_tagline, /\{\{count\}\}/);
  assert.doesNotMatch(zh.header_tagline, /[一二三四五六七八九十]个/);
  i18n.init('zh_CN');
  assert.equal(t('header_tagline', { count }), `${count} 款编程助手，1 个七牛`);
  i18n.init('en_US');
  assert.equal(t('header_tagline', { count }), `${count} coding assistants, one Qiniu`);
});
