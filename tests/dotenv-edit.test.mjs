import assert from 'node:assert/strict';
import test from 'node:test';
import {setDotenvValue} from '../dist/lib/core/dotenv-edit.js';
test('colon duplicate credentials and backslash quote ambiguity fail closed',()=>{
 assert.throws(()=>setDotenvValue('QINIU_API_KEY=old\nQINIU_API_KEY: stale\n','QINIU_API_KEY','new'),/Duplicate/);
 const content='OTHER="text'+String.fromCharCode(92).repeat(2)+'"\nQINIU_API_KEY=hidden\nend"\n';
 assert.throws(()=>setDotenvValue(content,'QINIU_API_KEY','new'),/multiline/);
});
test('single-line quoted credentials accept inline comments and colon assignments',()=>{
 assert.equal(setDotenvValue('QINIU_API_KEY="old" # token\nOTHER=keep\n','QINIU_API_KEY','new'),'QINIU_API_KEY=new\nOTHER=keep\n');
 assert.equal(setDotenvValue("QINIU_API_KEY: 'old' # token\r\n",'QINIU_API_KEY','new'),'QINIU_API_KEY=new\r\n');
});
test('dotenv preserves unrelated lines and replaces one exported key',()=>{assert.equal(setDotenvValue('# keep\nOTHER=value\nexport QINIU_API_KEY=old\n','QINIU_API_KEY','new-key'),'# keep\nOTHER=value\nQINIU_API_KEY=new-key\n');});
test('dotenv rejects duplicate variables, multiline values and injected keys',()=>{for(const content of ['QINIU_API_KEY=a\nQINIU_API_KEY=b\n','QINIU_API_KEY="first\nsecond"\n'])assert.throws(()=>setDotenvValue(content,'QINIU_API_KEY','new'));for(const value of ['x\nOTHER=bad','x\rOTHER=bad','$(touch bad)'])assert.throws(()=>setDotenvValue('','QINIU_API_KEY',value));assert.throws(()=>setDotenvValue('','KEY\nBAD','value'));});


test('target-looking lines inside other multiline values are never edited', () => {
  for (const quote of ['"', "'", String.fromCharCode(96)]) {
    const content = 'OTHER=' + quote + 'first\nQINIU_API_KEY=old\nlast' + quote + '\n';
    assert.throws(() => setDotenvValue(content, 'QINIU_API_KEY', 'new-key'), /multiline/);
  }
});

test('dotenv extended keys and escaped quotes cannot hide multiline assignments',()=>{
  for(const content of ["OTHER-KEY='line\nQINIU_API_KEY=old\nend'\n",'OTHER.KEY="line\nQINIU_API_KEY=old\nend"\n',"OTHER='escaped\\'line\nQINIU_API_KEY=old\nend'\n",'OTHER-KEY: "line\nQINIU_API_KEY=old\nend"\n'])assert.throws(()=>setDotenvValue(content,'QINIU_API_KEY','new'),/multiline/);
});
test('CR-only dotenv is refused while CRLF preserves unrelated assignments',()=>{
  assert.throws(()=>setDotenvValue('QINIU_API_KEY=old\rOTHER=keep\r','QINIU_API_KEY','new'),/CR-only/);
  assert.equal(setDotenvValue('QINIU_API_KEY=old\r\nOTHER=keep\r\n','QINIU_API_KEY','new'),'QINIU_API_KEY=new\r\nOTHER=keep\r\n');
});
