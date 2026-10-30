import assert from 'node:assert/strict';
import test from 'node:test';
import {parseYamlDocument,setYamlValue,getYamlValue,restoreYamlValue,stringifyYamlDocument} from '../dist/lib/core/yaml-edit.js';
test('unsupported collection/custom tags and lossy calendar/binary values fail before editing',()=>{
 for(const source of ['values: !!set {a: null}','values: !!omap [a: 1]','model: !env API_MODEL','when: 0001-01-02\nmodel: old','blob: !!binary NOT_BASE64!'])assert.throws(()=>parseYamlDocument(source),/tags|collections|calendar|binary/);
});
test('sub-millisecond timestamps fail closed instead of losing unrelated precision',()=>{
 for(const stamp of ['2026-01-02T03:04:05.123456Z','2026-01-02T03:04:05.123001+08:00'])assert.throws(()=>parseYamlDocument('when: '+stamp+'\nmodel: old\n'),/precision/);
 const doc=parseYamlDocument('when: 2026-01-02T03:04:05.123000Z\nmodel: old\n');setYamlValue(doc,['model'],'new');assert.equal(getYamlValue(parseYamlDocument(String(doc)),['when']).toISOString(),'2026-01-02T03:04:05.123Z');
});
test('repeated replacement objects serialize without aliases and reopen safely',()=>{
 const shared={enabled:true};const doc=parseYamlDocument('values: {}\n');
 setYamlValue(doc,['values'],{first:shared,second:shared});assert.doesNotMatch(String(doc),/[&*]a\d/);
 assert.deepEqual(getYamlValue(parseYamlDocument(String(doc)),['values']),{first:{enabled:true},second:{enabled:true}});
});
test('implicit null is present and round trips through replacement',()=>{
 const doc=parseYamlDocument('model: {default, custom: true}\n');const before=getYamlValue(doc,['model','default']);assert.equal(before,null);
 setYamlValue(doc,['model','default'],'new');restoreYamlValue(doc,['model','default'],before);
 assert.equal(getYamlValue(parseYamlDocument(String(doc)),['model','default']),null);assert.equal(getYamlValue(doc,['absent']),undefined);
});
test('typed and complex mapping keys are rejected before snapshots can collapse them',()=>{
 for(const text of ['values: {1: first, "1": second}','values: {true: first, "true": second}','values: {? [a, b]: first}'])assert.throws(()=>parseYamlDocument(text),/keys must be strings/);
});
test('YAML edits preserve comments quotes and unrelated maps',()=>{const doc=parseYamlDocument('# top\nmodel:\n  default: "old" # inline\n  other: yes\nmcp:\n  enabled: true\n');setYamlValue(doc,['model','default'],'new');const next=stringifyYamlDocument(doc);assert.match(next,/# top/);assert.match(next,/"new" # inline/);assert.equal(getYamlValue(doc,['mcp','enabled']),true);assert.equal(getYamlValue(doc,['model','other']),'yes');});
test('flow mappings and special values serialize safely',()=>{const doc=parseYamlDocument('model: {default: old, custom: true}\n');setYamlValue(doc,['model','default'],'x\nnew: bad');assert.equal(getYamlValue(parseYamlDocument(String(doc)),['model','default']),'x\nnew: bad');assert.equal(getYamlValue(doc,['model','custom']),true);});
test('invalid YAML duplicate keys and incompatible parents fail closed',()=>{for(const text of ['x: [', 'x: 1\nx: 2', '[1, 2]', 'null'])assert.throws(()=>parseYamlDocument(text));const doc=parseYamlDocument('model: value\n');assert.throws(()=>setYamlValue(doc,['model','default'],'new'),/mapping/);assert.equal(getYamlValue(doc,['model']),'value');});
test('explicit null differs from missing and empty maps are retained',()=>{const doc=parseYamlDocument('model: {}\n');restoreYamlValue(doc,['model','default'],null);assert.equal(getYamlValue(doc,['model','default']),null);restoreYamlValue(doc,['model','default'],undefined);assert.deepEqual(getYamlValue(doc,['model']),{});});


test('anchors and aliases fail closed rather than changing unrelated configuration', () => {
  for (const content of ['model: {default: &shared old}\nother: *shared\n', 'model: &config {default: old}\nother: *config\n']) {
    assert.throws(() => parseYamlDocument(content), /anchors and aliases/);
  }
});

test('changing explicit scalar tags preserves comments and the new value type',()=>{
  for(const source of ['!!bool true','!!int 42','!!null null']){
    const doc=parseYamlDocument('model: '+source+' # keep\n');setYamlValue(doc,['model'],'new/model');
    const output=String(doc);assert.match(output,/# keep/);assert.equal(getYamlValue(parseYamlDocument(output),['model']),'new/model');
  }
});
test('unrelated integers retain precision through serialization',()=>{
  const doc=parseYamlDocument('large: 9007199254740993\nsmall: 12\nmodel: old\n');setYamlValue(doc,['model'],'new');
  const reparsed=parseYamlDocument(String(doc));assert.equal(getYamlValue(reparsed,['large']),9007199254740993n);assert.equal(getYamlValue(reparsed,['small']),12);
});
test('native binary and timestamp scalar snapshots restore their types',()=>{
  const doc=parseYamlDocument('blob: !!binary SGVsbG8=\nwhen: !!timestamp 2026-01-02T03:04:05Z\n');
  for(const key of ['blob','when']){const before=getYamlValue(doc,[key]);assert.ok(key==='blob'?Buffer.isBuffer(before):before instanceof Date);setYamlValue(doc,[key],'changed');restoreYamlValue(doc,[key],before);assert.deepEqual(getYamlValue(parseYamlDocument(String(doc)),[key]),before);}
});
