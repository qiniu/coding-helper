import assert from 'node:assert/strict';
import test from 'node:test';

import { getModelCapabilities } from '../dist/lib/market-model-service.js';

test('getModelCapabilities tolerates features: null (international image models)', () => {
  // 回归：海外线路 openai/gpt-image-2.5-* 返回 features: null，选择模型时曾抛
  // "Cannot read properties of null (reading 'includes')"
  const caps = getModelCapabilities({
    id: 'openai/gpt-image-2.5-flare',
    features: null,
    model_constraints: { context_length: 0, max_tokens: 0 },
    architecture: {
      input_modalities: ['text', 'image'],
      function_calling: { supported: false },
      reasoning: { supported: false },
    },
  });
  assert.deepEqual(caps, {
    toolCall: false,
    images: true,
    reasoning: false,
    maxInputTokens: 200000,
    maxOutputTokens: 8192,
  });
});

test('getModelCapabilities tolerates missing architecture and constraints', () => {
  const caps = getModelCapabilities({ id: 'x', features: ['工具调用'] });
  assert.equal(caps.toolCall, true);
  assert.equal(caps.images, false);
  assert.equal(caps.reasoning, false);
  assert.equal(caps.maxInputTokens, 200000);
});


test('getModelCapabilities keeps complete model capabilities and limits', () => {
  const caps = getModelCapabilities({
    features: ['工具调用', '深度思考'],
    model_constraints: { context_length: 64000, max_tokens: 4096 },
    architecture: {
      input_modalities: ['text', 'image'],
      function_calling: { supported: false },
      reasoning: { supported: false },
    },
  });
  assert.deepEqual(caps, { toolCall: true, images: true, reasoning: true, maxInputTokens: 64000, maxOutputTokens: 4096 });
});

test('getModelCapabilities uses architecture when features are absent', () => {
  const caps = getModelCapabilities({
    architecture: { function_calling: { supported: true }, reasoning: { supported: true } },
  });
  assert.deepEqual(caps, { toolCall: true, images: false, reasoning: true, maxInputTokens: 200000, maxOutputTokens: 8192 });
});

// 可选能力信息使用短预算；请求超时必须中止网络并释放计时器，不能阻塞基础模型选择 30 秒。
test('optional market metadata honors an abortable short request budget', async t => {
  const { marketModelService } = await import('../dist/lib/market-model-service.js');
  marketModelService.clearCache();
  let aborted = false;
  t.mock.method(globalThis, 'fetch', async (_url, {signal}) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, {once:true});
  }));
  await assert.rejects(marketModelService.fetchModels('https://example.com', 'fake', {timeoutMs:20}), {name:'AbortError'});
  assert.equal(aborted, true);
});
