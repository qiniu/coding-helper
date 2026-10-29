import assert from 'node:assert/strict';
import test from 'node:test';

import { getModelCapabilities } from '../dist/lib/market-model-service.js';

function createModel(overrides = {}) {
  return {
    id: 'vendor/test-model',
    name: 'Test Model',
    description: '',
    features: ['工具调用', '深度思考'],
    model_constraints: {
      context_length: 128000,
      max_tokens: 4096,
      max_completion_tokens: 4096,
      max_default_completion_tokens: 4096,
      max_chain_of_thought_length: 0,
    },
    architecture: {
      input_modalities: ['text', 'image'],
      output_modalities: ['text'],
      function_calling: { supported: true },
      schema_output: { supported: false },
      reasoning: { supported: true },
      content_cache: { supported: false },
    },
    issuer: { name: 'Vendor', avatar: '', model_page: '' },
    ...overrides,
  };
}

const fullCapabilities = {
  toolCall: true,
  images: true,
  reasoning: true,
  maxInputTokens: 128000,
  maxOutputTokens: 4096,
};

const defaultCapabilities = {
  toolCall: false,
  images: false,
  reasoning: false,
  maxInputTokens: 200000,
  maxOutputTokens: 8192,
};

test('getModelCapabilities preserves capabilities and limits for complete models', () => {
  assert.deepEqual(getModelCapabilities(createModel()), fullCapabilities);
});

test('getModelCapabilities keeps feature flags when architecture reports no support', () => {
  const model = createModel();
  model.architecture.function_calling.supported = false;
  model.architecture.reasoning.supported = false;

  assert.deepEqual(getModelCapabilities(model), fullCapabilities);
});

for (const features of [null, undefined, [], ['文本生成']]) {
  test(`getModelCapabilities falls back to architecture for features=${JSON.stringify(features)}`, () => {
    assert.deepEqual(getModelCapabilities(createModel({ features })), fullCapabilities);
  });
}

test('getModelCapabilities falls back to architecture when features is omitted', () => {
  const model = createModel();
  delete model.features;

  assert.deepEqual(getModelCapabilities(model), fullCapabilities);
});

for (const architecture of [null, undefined, {}]) {
  test(`getModelCapabilities preserves feature flags for architecture=${JSON.stringify(architecture)}`, () => {
    assert.deepEqual(getModelCapabilities(createModel({ architecture })), {
      ...fullCapabilities,
      images: false,
    });
  });
}

test('getModelCapabilities returns defaults when capability and constraint fields are omitted', () => {
  assert.deepEqual(getModelCapabilities({ id: 'vendor/minimal-model' }), defaultCapabilities);
});

test('getModelCapabilities returns defaults when capability and constraint fields are null', () => {
  assert.deepEqual(getModelCapabilities(createModel({
    features: null,
    architecture: null,
    model_constraints: null,
  })), defaultCapabilities);
});

for (const architecture of [
  {},
  { input_modalities: null, function_calling: null, reasoning: null },
  { input_modalities: [], function_calling: {}, reasoning: {} },
  { input_modalities: ['text'], function_calling: { supported: false }, reasoning: { supported: false } },
]) {
  test(`getModelCapabilities returns false for unsupported architecture=${JSON.stringify(architecture)}`, () => {
    assert.deepEqual(getModelCapabilities(createModel({ features: [], architecture })), {
      ...fullCapabilities,
      toolCall: false,
      images: false,
      reasoning: false,
    });
  });
}

for (const model_constraints of [
  null,
  undefined,
  {},
  { context_length: null, max_tokens: null },
  { context_length: 0, max_tokens: 0 },
  { context_length: -1, max_tokens: -1 },
]) {
  test(`getModelCapabilities preserves default limits for constraints=${JSON.stringify(model_constraints)}`, () => {
    assert.deepEqual(getModelCapabilities(createModel({ model_constraints })), {
      ...fullCapabilities,
      maxInputTokens: 200000,
      maxOutputTokens: 8192,
    });
  });
}

test('getModelCapabilities defaults each missing limit independently', () => {
  assert.deepEqual(getModelCapabilities(createModel({
    model_constraints: { context_length: 128000 },
  })), { ...fullCapabilities, maxOutputTokens: 8192 });
  assert.deepEqual(getModelCapabilities(createModel({
    model_constraints: { max_tokens: 4096 },
  })), { ...fullCapabilities, maxInputTokens: 200000 });
});
