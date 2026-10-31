import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreModel, closestModels, resolveModelId, parseModelQuery, vendorOf } from '../dist/lib/core/model-search.js';
const IDS = ['deepseek/deepseek-v4-flash', 'qwen/qwen3.7-plus', 'z-ai/glm-5.2', 'moonshotai/kimi-k3', 'minimax/minimax-m3', 'openai/gpt-5.4'];
const model = (id, context = 200000, vision = false) => ({ id, context, toolCall: true, vision });
const matches = (q, models = IDS.map((id) => model(id))) => models
  .map((m) => ({ id: m.id, score: scoreModel(m, q) }))
  .filter((x) => x.score !== undefined)
  .sort((a, b) => a.score - b.score)
  .map((x) => x.id);

// ---- 模型搜索 ----

test('search ignores - / . and spaces', () => {
  assert.deepEqual(matches('glm5'), ['z-ai/glm-5.2']);
  assert.deepEqual(matches('k3'), ['moonshotai/kimi-k3']);
  assert.deepEqual(matches('v4flash'), ['deepseek/deepseek-v4-flash']);
  assert.deepEqual(matches('glm 5.2'), ['z-ai/glm-5.2']);
});

test('search understands Chinese vendor names', () => {
  assert.deepEqual(matches('智谱'), ['z-ai/glm-5.2']);
  assert.deepEqual(matches('千问'), ['qwen/qwen3.7-plus']);
  assert.deepEqual(matches('月之暗面'), ['moonshotai/kimi-k3']);
  assert.deepEqual(matches('深度求索'), ['deepseek/deepseek-v4-flash']);
  assert.equal(vendorOf('z-ai/glm-5.2'), 'glm');
});

test('search filters by context size and vision', () => {
  const list = [model('a/small', 128000), model('a/big', 1000000), model('a/eye', 256000, true)];
  assert.deepEqual(matches('200k', list).sort(), ['a/big', 'a/eye']);
  assert.deepEqual(matches('1m', list), ['a/big']);
  assert.deepEqual(matches('看图', list), ['a/eye']);
  assert.deepEqual(matches('vision 1m', list), []);
  assert.deepEqual(parseModelQuery('glm 200k 看图'), { words: ['glm'], minContext: 200000, vision: true });
});

test('ranking: prefix match, then recommended, then recently used', () => {
  const prefix = scoreModel(model('x/qwen-max'), 'qwen');
  const inside = scoreModel(model('x/coder-qwen'), 'qwen', { recommended: true, recent: true });
  assert.ok(prefix < inside);
  const rec = scoreModel(model('x/qwen-a'), 'qwen', { recommended: true });
  const recent = scoreModel(model('x/qwen-b'), 'qwen', { recent: true });
  const plain = scoreModel(model('x/qwen-c'), 'qwen');
  assert.ok(rec < recent && recent < plain);
});

test('no match: closest models and vendor prefix completion', () => {
  assert.equal(matches('glm9x').length, 0);
  assert.equal(closestModels(IDS, 'glm9')[0], 'z-ai/glm-5.2');
  assert.equal(closestModels(IDS, 'xyz').length, 3);
  assert.equal(resolveModelId('glm-5.2', IDS), 'z-ai/glm-5.2');
  assert.equal(resolveModelId('kimi-k3', IDS), 'moonshotai/kimi-k3');
  assert.equal(resolveModelId('my/own', IDS), 'my/own');
  assert.equal(resolveModelId('unknown-1', IDS), 'unknown-1');
});

test('resolution preserves exact IDs and ambiguous names', () => {
 assert.equal(resolveModelId('model', ['a/model','model']), 'model');
 assert.equal(resolveModelId('model', ['a/model','b/model']), 'model');
 assert.equal(resolveModelId('model', ['b/model','a/model']), 'model');
 assert.equal(closestModels(IDS, 'moonshotai/kim-k3', 1)[0], 'moonshotai/kimi-k3');
});

test('visible names and tool/reasoning filters preserve capability and context constraints',()=>{
 const models=[{id:'a/tool',name:'Friendly tool',context:256000,toolCall:true,vision:false,reasoning:true},{id:'a/plain',context:128000,toolCall:false,vision:false,reasoning:false}];
 assert.deepEqual(matches('工具调用',models),['a/tool']);assert.deepEqual(matches('思考 200k',models),['a/tool']);assert.deepEqual(matches('thinking 1m',models),[]);assert.deepEqual(matches('Friendly',models),['a/tool']);
});

test('exact model IDs outrank recommended models sharing their prefix',()=>{
 assert.ok(scoreModel(model('openai/gpt-5'),'openai/gpt-5')<scoreModel(model('openai/gpt-5.4'),'openai/gpt-5',{recommended:true,recent:true}));
});
