import assert from 'node:assert/strict';
import test from 'node:test';
const { parseQuickArgs, pickApiKey, pickModel, suggestModels } = await import('../dist/lib/core/quick-args.js');
const { modelConfigFor, savedModelFor } = await import('../dist/lib/core/model-mapping.js');
test('quick arguments accept either key/model order and reject ambiguous input', () => {
  assert.deepEqual(parseQuickArgs('claude', ['sk-fake', 'vendor/model']), { tools: ['claude'], apiKey: 'sk-fake', model: 'vendor/model' });
  assert.deepEqual(parseQuickArgs('codex,opencode', ['vendor/model', 'sk-fake']).tools, ['codex', 'opencode']);
  assert.equal(parseQuickArgs('all', []).tools, 'all');
  assert.deepEqual(parseQuickArgs('codex,codex', []).tools,['codex']);
  for (const args of [['sk-a','sk-b'], ['model-a','model-b']]) assert.throws(() => parseQuickArgs('codex', args));
  assert.throws(() => parseQuickArgs(' , ', []));
});

test('explicit key and model options support arbitrary key prefixes without ambiguity', () => {
  const args=parseQuickArgs('opencode',[],{apiKey:'qiniu-key',model:'vendor/model'});
  assert.equal(args.apiKey,'qiniu-key');assert.equal(args.model,'vendor/model');
  assert.equal(parseQuickArgs('opencode',['qiniu-key'],{model:'vendor/model'}).apiKey,'qiniu-key');
  assert.equal(pickApiKey(args,{QINIU_API_KEY:'old-env'},'old-saved').key,'qiniu-key');
  assert.throws(()=>parseQuickArgs('codex',[],{apiKey:''}));
  assert.throws(()=>parseQuickArgs('codex',[],{model:' '}));
  assert.throws(()=>parseQuickArgs('codex',['sk-new'],{apiKey:'sk-old'}),/duplicate_key/);
  assert.equal(parseQuickArgs('codex',[],{apiKey:'qiniu-key',model:'sk-prefixed-model'}).model,'sk-prefixed-model');
});
test('key precedence is explicit argument, environment, then saved configuration', () => {
  assert.equal(pickApiKey({ tools: [], apiKey: 'argument' }, { QINIU_API_KEY: 'env' }, 'saved').key, 'argument');
  assert.deepEqual(pickApiKey({ tools: [] }, { QINIU_API_KEY: ' env ' }, 'saved'), { key: 'env', source: 'env' });
  assert.equal(pickApiKey({ tools: [] }, {}, 'saved').source, 'saved');
  assert.equal(pickApiKey({ tools: [] }, {}, undefined), undefined);
});
test('unknown capability data differs from a known list without tool calling', () => {
  assert.equal(pickModel(undefined, undefined, ['vendor/model'], new Set()).error, 'none_available');
  assert.equal(pickModel('vendor/model', undefined, ['vendor/model'], undefined).model, 'vendor/model');
  assert.equal(pickModel('model', undefined, ['vendor/model'], new Set(['vendor/model'])).corrected, 'model');
  assert.equal(pickModel('model', undefined, ['a/model','b/model'], undefined).error, 'not_available');
  assert.equal(pickModel('vision', undefined, ['vision'], new Set(['other'])).error, 'no_tool_call');
});
test('single-model mapping round trips through every saved model family', () => {
  for (const name of ['claude-code','codex','codebuddy','workbuddy','hermes','opencode','grok','droid']) {
    assert.equal(savedModelFor({ name }, modelConfigFor({ name }, 'chosen-model')), 'chosen-model', name);
  }
  assert.deepEqual(suggestModels('glm-5', ['z-ai/glm-5.2','other']), ['z-ai/glm-5.2']);
});
