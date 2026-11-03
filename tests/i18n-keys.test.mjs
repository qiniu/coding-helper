import assert from 'node:assert/strict'; import fs from 'node:fs'; import path from 'node:path'; import test from 'node:test';
// 源码中以字面量调用的翻译键必须在中英文文件里都存在，避免界面直接显示键名（例如 rebase 时误删翻译）
const root = new URL('..', import.meta.url).pathname;
const locales = Object.fromEntries(['zh_CN', 'en_US'].map(name => [name, JSON.parse(fs.readFileSync(path.join(root, 'src/locales', name + '.json'), 'utf8'))]));
function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : entry.name.endsWith('.ts') ? [path.join(dir, entry.name)] : []); }

test('every literal translation key used in src exists in both locales', () => {
  const missing = [];
  for (const file of files(path.join(root, 'src'))) {
    for (const [, key] of fs.readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([a-z][a-z0-9_]*)'/g)) {
      for (const [name, table] of Object.entries(locales)) if (!Object.hasOwn(table, key)) missing.push(`${name}: ${key} (${path.relative(root, file)})`);
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});
