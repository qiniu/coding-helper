import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOpenClawLoadOperations,
  buildOpenClawProviderConfig,
  buildOpenClawModelRef,
  buildOpenClawUnloadOperations,
} from '../dist/lib/tools/openclaw-tool.js';

test('buildOpenClawProviderConfig creates an OpenAI-compatible Qiniu provider', () => {
  assert.deepEqual(buildOpenClawProviderConfig('https://api.qnaigc.com/', 'openai/gpt-5.2'), {
    baseUrl: 'https://api.qnaigc.com/v1',
    apiKey: '${QINIU_API_KEY}',
    api: 'openai-completions',
    models: [
      {
        id: 'openai/gpt-5.2',
        name: 'openai/gpt-5.2',
      },
    ],
  });
});

test('buildOpenClawModelRef prefixes selected Qiniu model with provider id', () => {
  assert.equal(buildOpenClawModelRef('openai/gpt-5.2'), 'qnaigc/openai/gpt-5.2');
});

test('buildOpenClawLoadOperations writes env, provider, default model, and allowlist alias', () => {
  assert.deepEqual(buildOpenClawLoadOperations('qiniu-key', 'https://api.qnaigc.com', 'openai/gpt-5.2'), [
    ['config', 'set', 'env.QINIU_API_KEY', '"qiniu-key"', '--strict-json'],
    ['config', 'set', 'models.mode', '"merge"', '--strict-json'],
    ['config', 'set', 'models.providers.qnaigc', '{"baseUrl":"https://api.qnaigc.com/v1","apiKey":"${QINIU_API_KEY}","api":"openai-completions","models":[{"id":"openai/gpt-5.2","name":"openai/gpt-5.2"}]}', '--strict-json'],
    ['config', 'set', 'agents.defaults.model.primary', '"qnaigc/openai/gpt-5.2"', '--strict-json'],
    ['config', 'set', 'agents.defaults.models["qnaigc/openai/gpt-5.2"]', '{"alias":"Qiniu"}', '--strict-json'],
  ]);
});

test('buildOpenClawUnloadOperations removes only helper-managed Qiniu settings', () => {
  assert.deepEqual(buildOpenClawUnloadOperations('qnaigc/openai/gpt-5.2'), [
    ['config', 'unset', 'env.QINIU_API_KEY'],
    ['config', 'unset', 'models.providers.qnaigc'],
    ['config', 'unset', 'agents.defaults.model.primary'],
    ['config', 'unset', 'agents.defaults.models["qnaigc/openai/gpt-5.2"]'],
  ]);

  assert.deepEqual(buildOpenClawUnloadOperations('openai/gpt-5.2'), [
    ['config', 'unset', 'env.QINIU_API_KEY'],
    ['config', 'unset', 'models.providers.qnaigc'],
  ]);
});
