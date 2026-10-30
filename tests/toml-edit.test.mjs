import assert from 'node:assert/strict';
import test from 'node:test';
import {parse} from 'smol-toml';
import * as toml from '../dist/lib/core/toml-edit.js';
test('mixed endings fail closed without deleting adjacent statements',()=>{
 const original='model="old"\nkeep=true\r\n';
 for(const edit of [s=>toml.upsertTopLevelTomlKey(s,'model','"new"'),s=>toml.removeTopLevelTomlKey(s,'model')])assert.throws(()=>edit(original),/Mixed/);
});
test('quoted keys and equals signs in unrelated keys work semantically',()=>{
 const source='"a=b" = true\n"model" = "old"\n[models]\n\'default\' = "old"\n';
 const root=toml.upsertTopLevelTomlKey(source,'model','"new"');assert.equal(parse(root).model,'new');assert.equal(parse(root)['a=b'],true);
 assert.equal(toml.getTopLevelTomlValue(root,'model'),'"new"');assert.equal(parse(toml.removeTopLevelTomlKey(root,'model')).model,undefined);
 const table=toml.upsertTomlTableKey(source,'models','default','"new"');assert.equal(parse(table).models.default,'new');assert.equal(toml.getTomlTableValue(table,'models','default'),'"new"');
});
test('readers reject array-table scopes and DEL is escaped',()=>{
 assert.equal(toml.getTopLevelTomlValue('[[other]]\nmodel="nested"','model'),undefined);
 assert.equal(toml.getTomlTableValue('[models]\nx=1\n[[other]]\ndefault="wrong"','models','default'),undefined);
 const encoded=toml.escapeTomlString('a\x7fb');assert.equal(parse('key="'+encoded+'"').key,'a\x7fb');assert.ok(!encoded.includes('\x7f'));
});
test('all removal operations preserve CRLF including multiline values', () => {
  const source='model = "old"\r\nkeep = [\r\n  1, 2,\r\n]\r\n[managed]\r\nx = 1\r\ny = 2\r\n[other]\r\nz = 3\r\n';
  assert.equal(toml.removeTopLevelTomlKey(source,'model'), source.replace('model = "old"\r\n',''));
  assert.equal(toml.removeTomlTableKey(source,'managed','x'),source.replace('x = 1\r\n',''));
  assert.equal(toml.removeTomlTable(source,'managed'),source.replace('[managed]\r\nx = 1\r\ny = 2\r\n',''));
  assert.equal(toml.removeTomlTable(source,'other'),source.slice(0,source.indexOf('[other]')));
  assert.equal(toml.removeTomlTableKey('[empty]\r\nx=1\r\n[keep]\r\ny=2\r\n','empty','x'),'[keep]\r\ny=2\r\n');
});
test('CRLF survives insertion of missing root keys, table keys and tables', () => {
  const source = '# keep\r\n[existing]\r\nx = 1\r\n';
  const root = toml.upsertTopLevelTomlKey(source, 'model', '"new"');
  assert.equal(root, '# keep\r\nmodel = "new"\r\n\r\n[existing]\r\nx = 1\r\n');
  const table = toml.upsertTomlTableKey(source, 'existing', 'other', 'true');
  assert.equal(table, '# keep\r\n[existing]\r\nx = 1\r\nother = true\r\n');
  const added = toml.upsertTomlTableKey(source, 'new', 'key', '2');
  assert.equal(added, '# keep\r\n[existing]\r\nx = 1\r\n\r\n[new]\r\nkey = 2\r\n');
  for (const result of [root, table, added, toml.normalizeToml(source)]) {
    assert.doesNotMatch(result, /(?<!\r)\n/);
    assert.equal(parse(result).existing.x, 1);
  }
});
test('TOML edits preserve unrelated comments and nested MCP configuration',()=>{const s='# keep\nmodel = "old"\n\n[mcp_servers.demo]\ncommand = "node" # keep\n';const n=toml.upsertTopLevelTomlKey(s,'model','"new"');assert.equal(parse(n).model,'new');assert.ok(n.endsWith('[mcp_servers.demo]\ncommand = "node" # keep\n'));});
test('table helpers edit and remove only requested table keys',()=>{const s='[models]\ndefault = "old"\nkeep = true\n[other]\nx = 1\n';const n=toml.upsertTomlTableKey(s,'models','default','"qiniu"');assert.equal(parse(n).models.default,'qiniu');assert.equal(parse(toml.removeTomlTableKey(n,'models','default')).models.keep,true);assert.deepEqual(parse(toml.removeTomlTable(n,'models')),{other:{x:1}});});
test('special characters in strings cannot inject TOML',()=>{const value='x"\nnew = "bad\t\\';const s=toml.upsertTopLevelTomlKey('','model','"'+toml.escapeTomlString(value)+'"');assert.equal(parse(s).model,value);});
test('invalid and duplicate values fail closed',()=>{for(const s of ['x = ', 'x=1\nx=2'])assert.throws(()=>toml.upsertTopLevelTomlKey(s,'model','"new"'));});
test('inline comments and CRLF are retained when replacing managed keys',()=>{const before='  model  = "old#value"  # keep\r\n[other]\r\nx=1\r\n';const after=toml.upsertTopLevelTomlKey(before,'model','"new"');assert.equal(after,'  model  = "new"  # keep\r\n[other]\r\nx=1\r\n');});
test('special headers are refused and multiline arrays preserve unrelated data',()=>{const text='[managed]\nx=1\n["other]table"]\nkeep=true\n';assert.throws(()=>toml.removeTomlTable(text,'managed'),/Unsupported/);assert.deepEqual(parse(toml.removeTomlTable('array = [\n  [1,2],\n]\n[managed]\nx=1\n','managed')),{array:[[1,2]]});});
test('array table elements are never selected implicitly and unrelated arrays stay intact', () => {
  const source = '[[models]]\nx=1\n[[models]]\nx=2\n';
  for(const edit of [s=>toml.upsertTomlTableKey(s,'models','x','3'),s=>toml.removeTomlTable(s,'models')]) assert.throws(()=>edit(source),/Array table/);
  assert.deepEqual(parse(toml.upsertTopLevelTomlKey(source,'x','1')),{x:1,models:[{x:1},{x:2}]});
});
test('multiline string table-looking content and arrays stay byte intact', () => {
  const source = 'text = """\n[managed]\nx = 3\n"""\narray = [\n  [1,2],\n]\n[managed]\nx=1\n';
  const changed=toml.upsertTopLevelTomlKey(source,'model','"new"');
  assert.equal(parse(changed).text,parse(source).text);
  assert.ok(changed.startsWith(source.slice(0,source.lastIndexOf('[managed]'))));
  const removed=toml.removeTomlTable(source,'managed');
  assert.equal(removed,source.slice(0,source.lastIndexOf('[managed]')));
});


test('quoted and spaced table names resolve to the same semantic path', () => {
  const source = '["models"]\ndefault = "old"\n[model . "qiniu"]\nmodel = "old"\n["model.qiniu"]\nkeep = true\n';
  const changed = toml.upsertTomlTableKey(source, 'models', 'default', '"new"');
  assert.equal(parse(changed).models.default, 'new');
  const removed = toml.removeTomlTable(changed, 'model.qiniu');
  assert.equal(parse(removed).model, undefined);
  assert.equal(parse(removed)['model.qiniu'].keep, true);
  assert.equal(toml.tomlTableName('[models."qiniu/x"]'), 'models."qiniu/x"');
});
