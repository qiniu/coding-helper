import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// 隔离 HOME：所有读写都落在临时目录
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-helper-safe-write-'));
process.env.HOME = home;
process.env.USERPROFILE = home;

const { stateStore } = await import('../dist/lib/core/state-store.js');
const { readJsonObjectStrict, safeWriteFile, backupsRoot, formatJsonLike } = await import('../dist/lib/core/safe-write.js');
test('legacy directory-alias records migrate on write and conflicting originals fail closed',()=>{
 const dir=path.join(home,'legacy-state'),alias=path.join(home,'legacy-alias');fs.mkdirSync(dir);fs.symlinkSync(dir,alias,'junction');
 const realFile=path.join(dir,'config.json'),aliasFile=path.join(alias,'config.json');const file=path.join(home,'.coding-helper','state.json');fs.mkdirSync(path.dirname(file),{recursive:true});
 const original={priors:{model:'original'}};const legacy={version:1,tools:{[JSON.stringify(['legacy',aliasFile])]:original}};fs.writeFileSync(file,JSON.stringify(legacy));
 assert.deepEqual(stateStore.getPriors('legacy',realFile),original.priors);stateStore.recordPriors('legacy',{model:'managed'},realFile);assert.deepEqual(stateStore.getPriors('legacy',aliasFile),original.priors);assert.equal(stateStore.getFileStates('legacy').length,1);
 legacy.tools[JSON.stringify(['legacy',realFile])]={priors:{model:'different'}};const conflict=JSON.stringify(legacy);fs.writeFileSync(file,conflict);
 assert.throws(()=>stateStore.recordPriors('legacy',{model:'overwrite'},realFile),/Conflicting restoration/);assert.equal(fs.readFileSync(file,'utf8'),conflict);stateStore.clear();
});
test('restoration state resolves parent aliases even before the file exists',()=>{
 const real=path.join(home,'real-parent'),alias=path.join(home,'alias-parent');fs.mkdirSync(real);fs.symlinkSync(real,alias,'junction');
 const realFile=path.join(real,'nested','config.json'),aliasFile=path.join(alias,'nested','config.json');
 stateStore.recordPriors('alias-state',{model:'original'},realFile);stateStore.recordPriors('alias-state',{model:'managed'},aliasFile);
 assert.deepEqual(stateStore.getPriors('alias-state',aliasFile),{model:'original'});assert.equal(stateStore.getFileStates('alias-state').length,1);stateStore.markRemoved('alias-state',aliasFile);assert.equal(stateStore.getState('alias-state',realFile),undefined);
});

test('safeWriteFile backs up the original under ~/.coding-helper/backups', () => {
  const file = path.join(home, 'some-config.json');
  fs.writeFileSync(file, 'before\n');
  safeWriteFile(file, 'after\n');
  assert.equal(fs.readFileSync(file, 'utf-8'), 'after\n');
  assert.equal(backupsRoot(), path.join(home, '.coding-helper', 'backups'));
  const [session] = fs.readdirSync(backupsRoot());
  const manifest = JSON.parse(fs.readFileSync(path.join(backupsRoot(), session, 'manifest.json'), 'utf-8'));
  const entry = manifest.files.find((item) => item.source === file);
  assert.ok(entry);
  assert.equal(fs.readFileSync(entry.backup, 'utf-8'), 'before\n');
  // 同一次运行内同一文件只备份一次，备份保留最初的内容
  safeWriteFile(file, 'again\n');
  assert.equal(fs.readFileSync(entry.backup, 'utf-8'), 'before\n');
});

test('readJsonObjectStrict throws on invalid JSON instead of returning an empty object', () => {
  const file = path.join(home, 'broken.json');
  fs.writeFileSync(file, '{ "a": 1,, }');
  assert.throws(() => readJsonObjectStrict(file));
  assert.deepEqual(readJsonObjectStrict(path.join(home, 'missing.json')), {});
});

test('JSON is written in the style of the original file', () => {
  assert.equal(formatJsonLike('{"a":1}\n', { a: 1, b: 2 }), '{"a":1,"b":2}\n');
  assert.equal(formatJsonLike('{\n    "a": 1\n}', { a: 1 }), '{\n    "a": 1\n}');
  assert.equal(formatJsonLike('{\n\t"a": 1\n}\n', { a: 1 }), '{\n\t"a": 1\n}\n');
  assert.equal(formatJsonLike(undefined, { a: 1 }), '{\n  "a": 1\n}\n');
});

test('stateStore keeps the first recorded prior values', () => {
  stateStore.clear();
  stateStore.recordPriors('demo', { a: 1 });
  stateStore.recordPriors('demo', { a: 2, b: 3 });
  assert.deepEqual(stateStore.getPriors('demo'), { a: 1, b: 3 });
  stateStore.markRemoved('demo');
  assert.equal(stateStore.getPriors('demo'), undefined);
});

test('strict JSON rejects empty and whitespace-only existing files', () => {
  const file = path.join(home, 'empty.json');
  for (const content of ['', ' \n\t']) {
    fs.writeFileSync(file, content);
    assert.throws(() => readJsonObjectStrict(file), /Cannot parse/);
    assert.equal(fs.readFileSync(file, 'utf8'), content);
  }
});

test('backups keep distinct flattened paths and manifest contents', async () => {
  const { backupFile } = await import('../dist/lib/core/safe-write.js');
  const first = path.join(home, 'a', 'b.json');
  const second = path.join(home, 'a__b.json');
  fs.mkdirSync(path.dirname(first), { recursive: true });
  fs.writeFileSync(first, 'first');
  fs.writeFileSync(second, 'second');
  const a = backupFile(first);
  const b = backupFile(second);
  assert.notEqual(a, b);
  assert.equal(fs.readFileSync(a, 'utf8'), 'first');
  assert.equal(fs.readFileSync(b, 'utf8'), 'second');
  const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(a), 'manifest.json'), 'utf8'));
  assert.ok(manifest.files.some(entry => entry.source === first && entry.backup === a));
  assert.ok(manifest.files.some(entry => entry.source === second && entry.backup === b));
});

test('writes and removals reject symlinks without replacing the link or target', async () => {
  const { atomicWriteFile, writeJsonOrRemove } = await import('../dist/lib/core/safe-write.js');
  const target = path.join(home, 'target.json');
  const link = path.join(home, 'linked.json');
  fs.writeFileSync(target, '{"keep":true}');
  fs.symlinkSync(target, link);
  for (const operation of [() => atomicWriteFile(link, '{}'), () => safeWriteFile(link, '{}'), () => writeJsonOrRemove(link, {})]) {
    assert.throws(operation, /symbolic link/);
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
    assert.equal(fs.readFileSync(target, 'utf8'), '{"keep":true}');
  }
  const dangling = path.join(home, 'dangling.json');
  fs.symlinkSync(path.join(home, 'absent-target.json'), dangling);
  assert.throws(() => atomicWriteFile(dangling, '{}'), /symbolic link/);
  assert.equal(fs.lstatSync(dangling).isSymbolicLink(), true);
});

test('state priors are scoped to tool and resolved configuration path', () => {
  stateStore.clear();
  const a = path.join(home, 'xdg-a', 'opencode.json');
  const b = path.join(home, 'xdg-b', 'opencode.json');
  stateStore.recordPriors('opencode', { model: 'a' }, a);
  stateStore.recordPriors('opencode', { model: 'b' }, b);
  stateStore.recordPriors('opencode', { model: 'changed' }, a);
  assert.deepEqual(stateStore.getPriors('opencode', a), { model: 'a' });
  assert.deepEqual(stateStore.getPriors('opencode', b), { model: 'b' });
  stateStore.markRemoved('opencode', b);
  assert.equal(stateStore.getPriors('opencode', b), undefined);
  assert.deepEqual(stateStore.getPriors('opencode', a), { model: 'a' });
});

test('corrupt or unsupported state is rejected without erasing restoration data', () => {
  const file = path.join(home, '.coding-helper', 'state.json');
  for (const content of ['', '{broken', '{}', '{"version":2,"tools":{}}', '{"version":1,"tools":[]}', '{"version":1,"tools":{"a":null}}']) {
    fs.writeFileSync(file, content);
    assert.throws(() => stateStore.recordPriors('new-tool', { model: 'new' }), /state|parse/i);
    assert.equal(fs.readFileSync(file, 'utf8'), content);
  }
  stateStore.clear();
});

test('failed manifest update cannot be bypassed by retrying the same write', () => {
  const file = path.join(home, 'manifest-retry.json');
  fs.writeFileSync(file, 'original');
  const write = fs.writeFileSync;
  const rename = fs.renameSync;
  fs.writeFileSync = (target, ...args) => {
    if (String(target).includes('manifest.json')) throw new Error('manifest unavailable');
    return write(target, ...args);
  };
  fs.renameSync = (source, target) => {
    if (String(target).endsWith('manifest.json')) throw new Error('manifest unavailable');
    return rename(source, target);
  };
  try {
    assert.throws(() => safeWriteFile(file, 'changed'), /manifest unavailable/);
    assert.throws(() => safeWriteFile(file, 'changed'), /manifest unavailable/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'original');
  } finally { fs.writeFileSync = write; fs.renameSync = rename; }
  safeWriteFile(file, 'changed');
  assert.equal(fs.readFileSync(file, 'utf8'), 'changed');
});

test('state operations respect an existing lock and release locks after errors', () => {
  stateStore.clear();
  const lock = path.join(home, '.coding-helper', 'state.lock');
  fs.writeFileSync(lock, 'another-process');
  try {
    assert.throws(() => stateStore.recordPriors('demo', { model: 'lost' }), /holds/);
    assert.equal(fs.readFileSync(lock, 'utf8'), 'another-process');
  } finally { fs.rmSync(lock); }
  assert.throws(() => stateStore.withLock(() => { throw new Error('callback failed'); }), /callback failed/);
  assert.equal(fs.existsSync(lock), false);
  stateStore.withLock(() => stateStore.setState('demo', { priors: { model: 'old' }, applied: { model: 'new' } }));
  assert.deepEqual(stateStore.getState('demo'), { priors: { model: 'old' }, applied: { model: 'new' } });
});

test('safe write detects external edits after backup but before the atomic rename', () => {
  const file = path.join(home, 'last-moment-edit.json');
  fs.writeFileSync(file, 'original');
  const original = fs.copyFileSync;
  fs.copyFileSync = (source, ...args) => {
    const result = original(source, ...args);
    if (source === file) fs.writeFileSync(file, 'external-edit');
    return result;
  };
  try {
    assert.throws(() => safeWriteFile(file, 'managed', 0o600, { content: 'original' }), /changed before writing/);
  } finally { fs.copyFileSync = original; }
  assert.equal(fs.readFileSync(file, 'utf8'), 'external-edit');
  assert.equal(fs.readdirSync(home).some(name => name.includes('last-moment-edit.json.tmp-')), false);
});

test('strict snapshot parses exactly the guarded text from a single read', async () => {
  const { readJsonSnapshot } = await import('../dist/lib/core/safe-write.js');
  const file = path.join(home, 'snapshot.json');
  fs.writeFileSync(file, '{"version":1}');
  const read = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = (target, ...args) => {
    const result = read(target, ...args);
    if (String(target) === file) { reads++; fs.writeFileSync(file, '{"version":2}'); }
    return result;
  };
  try {
    assert.deepEqual(readJsonSnapshot(file), { content: '{"version":1}', value: { version: 1 } });
    assert.equal(reads, 1);
  } finally { fs.readFileSync = read; }
});

test('removal preserves directories and directory symlink targets', async () => {
  const { writeJsonOrRemove } = await import('../dist/lib/core/safe-write.js');
  const dir = path.join(home, 'owned-by-user');
  fs.mkdirSync(dir);
  const alias = path.join(home, 'user-directory-link');
  fs.symlinkSync(dir, alias, process.platform === 'win32' ? 'junction' : 'dir');
  for (const parent of [dir, alias]) {
    const file = path.join(parent, 'settings.json');
    safeWriteFile(file, '{}');
    writeJsonOrRemove(file, {}, { content: '{}' });
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.statSync(dir).isDirectory(), true);
    assert.equal(fs.statSync(alias).isDirectory(), true);
    assert.equal(fs.lstatSync(alias).isSymbolicLink(), true);
  }
});

test('state preserves pending journals and rejects malformed journals', () => {
  stateStore.clear();
  const entry = { priors: { model: 'original' }, applied: { model: 'committed' },
    pending: { before: 'before', after: 'after', applied: { model: 'next' } } };
  stateStore.setState('journal', entry);
  assert.deepEqual(stateStore.getState('journal'), entry);
  const file = path.join(home, '.coding-helper', 'state.json');
  for (const pending of [null, {}, { before: false, after: '{}', applied: {} }, { before: null, after: 1, applied: {} }, { before: null, after: '{}', applied: [] }]) {
    const text = JSON.stringify({ version: 1, tools: { journal: { ...entry, pending } } });
    fs.writeFileSync(file, text);
    assert.throws(() => stateStore.getState('journal'), /parse|state/i);
    assert.equal(fs.readFileSync(file, 'utf8'), text);
  }
  stateStore.clear();
});
