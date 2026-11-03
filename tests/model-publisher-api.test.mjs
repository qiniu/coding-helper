import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { runPrompt } from './helpers/prompt-pty.mjs';

const model = (id, publisher, tags = []) => ({
  id, name: id, issuer: { name: publisher }, hot_tags: tags, features: ['工具调用'],
  model_constraints: { context_length: 256000, max_tokens: 16000 },
});
const clean = text => text.replace(/\x1B(?:[@-Z\\-_a-z]|\[[0-?]*[ -/]*[@-~])/g, '');
const frame = text => text.slice(text.lastIndexOf('? 选择模型'));

// 使用真实 HTTP 请求与真实 PTY，验证分类取自当前连接的接口响应，切换分类后只保留对应发布方。
test('picker requests market metadata and dynamically filters by API publisher', { skip: process.platform === 'win32' }, async t => {
  const calls = [];
  const server = createServer((req, res) => {
    calls.push({ url: req.url, auth: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({status: true, data: [
      model('anthropic/claude', 'Anthropic'),
      model('gemini', 'Google'),
      // 即使 ID 是 openai/，也必须按接口的发布方归类，而不是按名称猜测。
      model('openai/gpt-5.4', 'NorthStar Labs', ['热门']),
    ]}));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const source = `import {configManager} from './dist/lib/config.js';import {i18n} from './dist/lib/i18n.js';import {pickModel} from './dist/lib/wizard/flows/model-pick-flow.js';i18n.init('zh_CN');configManager.getConnection=()=>({apiKey:'fake-category-key',baseUrl:'${url}',endpoint:'custom'});console.log('RESULT',JSON.stringify(await pickModel({tools:[]})));`;
  const frames = [];
  const grab = keys => text => { frames.push(frame(text)); return keys; };
  const out = await runPrompt(source, [
    [/切换厂商[^]*搜索/, grab('\x1b[C')],
    [/❯ +anthropic\/claude[^]*搜索/, grab('\x1b[C')],
    [/❯ +gemini[^]*搜索/, grab('\x1b[C')],
    [/❯ +openai\/gpt-5\.4[^]*搜索/, grab('\r')],
  ], 120, { rows: 32 });
  assert.deepEqual(calls, [{url:'/v1/market/models', auth:'Bearer fake-category-key'}]);
  assert.match(frames[0], /全部 +Anthropic +Google +NorthStar Labs/);
  assert.doesNotMatch(frames[0], /DeepSeek|Qwen|MiniMax|推荐/);
  assert.match(frames[0], /NorthStar Labs · 256K 上下文/);
  assert.match(frames[0], /热门/);
  // 接口热门模型排在首位，固定本地名单不再影响推荐标记。
  assert.match(frames[0], /❯ +openai\/gpt-5\.4/);
  for (const [index, included, excluded] of [[1,'anthropic/claude','gemini'],[2,'gemini','anthropic/claude'],[3,'openai/gpt-5.4','gemini']]) {
    const list = frames[index].slice(frames[index].indexOf('⌕'));
    assert.ok(list.includes(included), list);
    assert.ok(!list.includes(excluded), list);
  }
  assert.match(out, /RESULT.*"model":"openai\/gpt-5.4"/);
});

test('standard catalog categories use owned_by, with namespaces and unknown publishers as fallbacks', { skip: process.platform === 'win32' }, async () => {
  const source = `import {configManager} from './dist/lib/config.js';import {i18n} from './dist/lib/i18n.js';import {marketModelService} from './dist/lib/market-model-service.js';import {modelService} from './dist/lib/model-service.js';import {pickModel} from './dist/lib/wizard/flows/model-pick-flow.js';i18n.init('zh_CN');configManager.getConnection=()=>({apiKey:'fake',baseUrl:'https://example.com',endpoint:'custom'});marketModelService.fetchModels=async()=>{throw Error('404')};modelService.fetchModels=async()=>[{id:'opaque',owned_by:'Actual Provider'},{id:'namespace/model'},{id:'unknown'}];console.log('RESULT',JSON.stringify(await pickModel({tools:[]})));`;
  const out = await runPrompt(source, [[/切换厂商[^]*搜索/, '\x1b']], 120, {rows:30});
  assert.match(out, /全部 +Actual Provider +namespace +未知发布方/);
  assert.doesNotMatch(out, /DeepSeek|MiniMax|推荐/);
});

test('missing API limits stay unknown instead of showing configuration defaults', { skip: process.platform === 'win32' }, async () => {
  const source = `import {configManager} from './dist/lib/config.js';import {i18n} from './dist/lib/i18n.js';import {marketModelService} from './dist/lib/market-model-service.js';import {pickModel} from './dist/lib/wizard/flows/model-pick-flow.js';i18n.init('zh_CN');configManager.getConnection=()=>({apiKey:'fake',baseUrl:'https://example.com',endpoint:'custom'});marketModelService.fetchModels=async()=>[{id:'openai/gpt-5.4',issuer:{name:'API Publisher'},features:['工具调用']}];console.log('RESULT',JSON.stringify(await pickModel({tools:[]})));`;
  const out = await runPrompt(source, [[/切换厂商[^]*搜索/, '\x1b']], 100, {rows:30});
  assert.match(out, /API Publisher · — 上下文 · 最大输出 —/);
  assert.doesNotMatch(out, /200K|最大输出 8K|推荐|OpenAI/);
});

// 大量发布方时分类仍占一行，选中最后一个发布方后其标签可见，列表与操作提示也都保留。
test('many API publishers scroll horizontally in a narrow terminal', { skip: process.platform === 'win32' }, async () => {
  const models = Array.from({length:22}, (_, i) => model(`p${i}/model`, `Publisher-${String(i).padStart(2,'0')}`));
  const source = `import {configManager} from './dist/lib/config.js';import {i18n} from './dist/lib/i18n.js';import {marketModelService} from './dist/lib/market-model-service.js';import {pickModel} from './dist/lib/wizard/flows/model-pick-flow.js';i18n.init('zh_CN');configManager.getConnection=()=>({apiKey:'fake',baseUrl:'https://example.com',endpoint:'custom'});marketModelService.fetchModels=async()=>${JSON.stringify(models)};console.log('RESULT',JSON.stringify(await pickModel({tools:[]})));`;
  const frames = [];
  const steps = [[/切换厂商[^]*搜索/, text => {frames.push(frame(text)); return '\x1b[C';}]];
  for (let i=0;i<22;i++) steps.push([new RegExp(`❯ +p${i}/model[^]*搜索`), text => {frames.push(frame(text));return i===21?'\x1b':'\x1b[C';}]);
  await runPrompt(source, steps, 60, {rows:24});
  for (const text of frames) {
    const tabs = text.split(/\r?\n/).find(line => /‹|›|全部|Publisher-/.test(line) && !/上下文/.test(line));
    assert.ok(tabs, text);
    assert.ok(clean(tabs).length <= 60, tabs);
    assert.ok(text.split(/\r?\n/).length < 24, text);
    assert.match(text, /❯/);
  }
  const last = frames.at(-1);
  assert.match(last.slice(last.indexOf('⌕')), /Publisher-21/);
});
