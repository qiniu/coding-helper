import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'models-json-')));
process.env.HOME = process.env.USERPROFILE = home;
const { applyModelsJson, loadModelsJson, unloadModelsJson } = await import('../dist/lib/tools/models-json.js');
const { stateStore } = await import('../dist/lib/core/state-store.js');
const qiniu = (id = 'model-a') => ({ id, vendor: 'Qiniu', apiKey: 'test-key' });
let sequence = 0;
function fixture(text) {
  const file = path.join(home, String(++sequence), 'models.json');
  if (text !== undefined) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
  return file;
}
const read = file => fs.readFileSync(file, 'utf8');
test('parent aliases share restoration state and retain original credentials',()=>{
 const original='{"models":[{"id":"old","vendor":"Other"}]}\n';const real=fixture(original);const alias=path.join(home,'alias-'+sequence);fs.symlinkSync(path.dirname(real),alias,'junction');
 loadModelsJson('alias',real,[qiniu()]);loadModelsJson('alias',path.join(alias,'models.json'),[qiniu('new')]);unloadModelsJson('alias',path.join(alias,'models.json'));
 assert.equal(read(real),original);assert.equal(stateStore.getFileStates('alias').length,0);
});
test('negative zero snapshots remain reloadable and restore original bytes',()=>{
 const original='{"models":[{"id":"foreign","vendor":"Other","temperature":-0}]}\n';const file=fixture(original);
 loadModelsJson('negative-zero',file,[qiniu()]);loadModelsJson('negative-zero',file,[qiniu('new')]);unloadModelsJson('negative-zero',file);assert.equal(read(file),original);
});

test('merge retains other vendors, duplicate entries, and available model order', () => {
  const other = { id: 'foreign', vendor: 'Other', custom: true };
  const config = { models: [other, other, qiniu('old')], availableModels: ['foreign', 'foreign', 'external', 'old'], custom: null };
  const copy = structuredClone(config);
  const next = applyModelsJson(config, [qiniu(), qiniu()]);
  assert.deepEqual(next.models, [other, other, qiniu()]);
  assert.deepEqual(next.availableModels, ['foreign', 'foreign', 'external', 'model-a']);
  assert.deepEqual(config, copy);
  assert.equal(next.custom, null);
});

test('foreign vendor ID collisions fail without modifying the input', () => {
  const input = { models: [{ id: 'model-a', vendor: 'Other' }] };
  assert.throws(() => applyModelsJson(input, [qiniu()]), /another vendor/);
  assert.deepEqual(input.models, [{ id: 'model-a', vendor: 'Other' }]);
});

for (const original of ['{}', '{  "custom": true }\r\n', '{\r\n\t"models": [{"id":"old","vendor":"Qiniu"}],\r\n\t"availableModels": ["old", "extra"]\r\n}\r\n']) {
  test('load/reload/unload restores exact original bytes: ' + JSON.stringify(original), () => {
    const file = fixture(original);
    loadModelsJson('demo', file, [qiniu()]);
    loadModelsJson('demo', file, [qiniu('new')]);
    unloadModelsJson('demo', file);
    assert.equal(read(file), original);
    assert.equal(stateStore.getState('demo', file), undefined);
  });
}

test('new files disappear on unload; a later cycle captures fresh priors', () => {
  const file = fixture();
  loadModelsJson('demo', file, [qiniu()]); unloadModelsJson('demo', file);
  assert.equal(fs.existsSync(file), false);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '{"new":1}');
  loadModelsJson('demo', file, [qiniu()]); unloadModelsJson('demo', file);
  assert.equal(read(file), '{"new":1}');
});

test('unload preserves unrelated edits and external file deletion', () => {
  const file = fixture('{"keep":true}'); loadModelsJson('demo', file, [qiniu()]);
  const changed = JSON.parse(read(file)); changed.keep = false; changed.extra = 1;
  fs.writeFileSync(file, JSON.stringify(changed)); unloadModelsJson('demo', file);
  assert.deepEqual(JSON.parse(read(file)), { keep: false, extra: 1 });
  loadModelsJson('demo', file, [qiniu()]); fs.rmSync(file); assert.throws(() => unloadModelsJson('demo', file), /original file was deleted/); assert.ok(stateStore.getState('demo', file));
  assert.equal(fs.existsSync(file), false);
});

test('unmanaged Qiniu configuration is untouched', () => {
  const file = fixture(JSON.stringify({ models: [qiniu()] }));
  const before = read(file); assert.throws(() => unloadModelsJson('demo', file), /No restoration record/); assert.equal(read(file), before);
});

test('managed field edits block reload and unload, preserving file and state', () => {
  const file = fixture('{}'); loadModelsJson('demo', file, [qiniu()]);
  const state = stateStore.getState('demo', file);
  const changed = JSON.parse(read(file)); changed.models[0].apiKey = 'user-edited';
  const text = JSON.stringify(changed); fs.writeFileSync(file, text);
  assert.throws(() => loadModelsJson('demo', file, [qiniu()]), /changed since loading/);
  assert.throws(() => unloadModelsJson('demo', file), /changed since loading/);
  assert.equal(read(file), text); assert.deepEqual(stateStore.getState('demo', file), state);
});

for (const text of ['', '{broken', '[]', '{"models":null}', '{"models":[null]}', '{"availableModels":false}']) {
  test('invalid config is never overwritten: ' + JSON.stringify(text), () => {
    const file = fixture(text); assert.throws(() => loadModelsJson('demo', file, [qiniu()]));
    assert.equal(read(file), text); assert.equal(stateStore.getState('demo', file), undefined);
  });
}

test('state and original values are independent for different paths and tools', () => {
  const a = fixture('{"a":1}'); const b = fixture('{"b":2}');
  loadModelsJson('codebuddy', a, [qiniu()]); loadModelsJson('workbuddy', b, [qiniu()]);
  unloadModelsJson('codebuddy', a);
  assert.equal(read(a), '{"a":1}'); assert.ok(stateStore.getState('workbuddy', b));
  unloadModelsJson('workbuddy', b); assert.equal(read(b), '{"b":2}');
});

test('write failure rolls back state; last-moment edit and symlink remain intact', () => {
  const file = fixture('{"keep":1}'); const copy = fs.copyFileSync;
  fs.copyFileSync = (source, ...args) => { const result = copy(source, ...args); if (source === file) fs.writeFileSync(file, '{"keep":2}'); return result; };
  try { assert.throws(() => loadModelsJson('demo', file, [qiniu()]), /changed before writing/); }
  finally { fs.copyFileSync = copy; }
  assert.equal(read(file), '{"keep":2}'); assert.ok(stateStore.getState('demo', file).pending);
  const link = file + '.link'; fs.symlinkSync(file, link);
  assert.throws(() => loadModelsJson('demo', link, [qiniu()]), /symbolic link/);
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
});

test('incomplete restoration records fail closed', () => {
  const file = fixture('{}'); stateStore.setState('demo', { priors: {} }, file);
  assert.throws(() => loadModelsJson('demo', file, [qiniu()]), /incomplete/);
  assert.throws(() => unloadModelsJson('demo', file), /incomplete/); assert.equal(read(file), '{}');
});

test('unload can retry when state cleanup fails after restoring the file', () => {
  const file = fixture('{ "original": 1 }'); loadModelsJson('demo', file, [qiniu()]);
  const remove = stateStore.markRemoved;
  stateStore.markRemoved = () => { throw new Error('cleanup failed'); };
  try { assert.throws(() => unloadModelsJson('demo', file), /cleanup failed/); }
  finally { stateStore.markRemoved = remove; }
  assert.equal(read(file), '{ "original": 1 }'); assert.ok(stateStore.getState('demo', file));
  unloadModelsJson('demo', file); assert.equal(stateStore.getState('demo', file), undefined);
});

for (const interruption of ['before-write', 'after-write']) {
  test('recover model catalog interrupted reload: ' + interruption, () => {
    const file = fixture('{}'); loadModelsJson('journal', file, [qiniu('old')]);
    const set = stateStore.setState; let count = 0;
    stateStore.setState = function (...args) {
      count++;
      if (interruption === 'after-write' && count === 2) throw Error('interrupted');
      const result = set.apply(this, args);
      if (interruption === 'before-write' && count === 1) throw Error('interrupted');
      return result;
    };
    try { assert.throws(() => loadModelsJson('journal', file, [qiniu('new')]), /interrupted/); } finally { stateStore.setState = set; }
    unloadModelsJson('journal', file); assert.equal(read(file), '{}');
    assert.equal(stateStore.getState('journal', file), undefined);
  });
}
test('model catalog post-rename failure keeps a recoverable journal', () => {
  const file = fixture('{}'); const rename = fs.renameSync; let once = true;
  fs.renameSync = (from, to) => { const result = rename(from, to); if (to === file && once) { once = false; throw Error('after rename'); } return result; };
  try { assert.throws(() => loadModelsJson('journal', file, [qiniu()]), /after rename/); } finally { fs.renameSync = rename; }
  unloadModelsJson('journal', file); assert.equal(read(file), '{}');
});

test('semantically identical catalogs still restore original formatting',()=>{
  const original='{\r\n "models" : [{"id":"model-a","vendor":"Qiniu","apiKey":"test-key"}],\r\n "availableModels": ["model-a"]\r\n}\r\n';
  const file=fixture(original);loadModelsJson('format',file,[qiniu()]);assert.notEqual(read(file),original);unloadModelsJson('format',file);assert.equal(read(file),original);
});
test('ambiguous post-rename content retains original and pending journal',()=>{
  const file=fixture('{"original":true}');const rename=fs.renameSync;let once=true;
  fs.renameSync=(from,to)=>{const result=rename(from,to);if(to===file&&once){once=false;fs.writeFileSync(file,'{"external":true}');throw Error('post rename edit');}return result;};
  try{assert.throws(()=>loadModelsJson('ambiguous',file,[qiniu()]),/post rename edit/);}finally{fs.renameSync=rename;}
  assert.equal(read(file),'{"external":true}');const saved=stateStore.getState('ambiguous',file);assert.equal(saved.priors.content,'{"original":true}');assert.ok(saved.pending);assert.throws(()=>unloadModelsJson('ambiguous',file),/journal retained/);
});
