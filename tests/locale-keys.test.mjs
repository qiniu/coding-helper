import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// JSON 里重复的键会被后出现的覆盖，翻译文件不允许重复键
test('locale files have no duplicate keys', () => {
  for (const locale of ['en_US', 'zh_CN']) {
    const keys = [...fs.readFileSync(new URL(`../src/locales/${locale}.json`, import.meta.url), 'utf8').matchAll(/^\s*"([^"]+)"\s*:/gm)].map(m => m[1]);
    const dup = keys.filter((key, i) => keys.indexOf(key) !== i);
    assert.deepEqual(dup, [], `${locale} duplicate keys`);
  }
});

test('dsh config note keeps the Desktop hint', () => {
  for (const locale of ['en_US', 'zh_CN']) {
    const messages = JSON.parse(fs.readFileSync(new URL(`../src/locales/${locale}.json`, import.meta.url), 'utf8'));
    assert.match(messages.dsh_config_note, /Desktop/, locale);
  }
});
