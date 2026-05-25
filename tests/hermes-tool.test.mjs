import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import yaml from 'js-yaml';

import {
  applyHermesConfigPermissions,
  buildHermesConfig,
  removeManagedHermesConfig,
} from '../dist/lib/tools/hermes-tool.js';
import {
  HERMES_MANUAL_MODEL_VALUE,
  buildHermesModelChoices,
} from '../dist/lib/wizard/flows/hermes-model-selection-flow.js';
import { toolManager } from '../dist/lib/tool-manager.js';

test('buildHermesConfig writes Qiniu custom endpoint and preserves unrelated config', () => {
  const existing = [
    'terminal:',
    '  backend: docker',
    'model:',
    '  provider: openrouter',
    '  default: anthropic/claude-sonnet-4-5',
    '  base_url: https://openrouter.ai/api/v1',
    '  api_key: sk-old',
    '  context_length: 200000',
    'display:',
    '  skin: minimal',
    '',
  ].join('\n');

  const next = buildHermesConfig(
    existing,
    'https://api.qnaigc.com',
    'qiniu-key',
    'anthropic/claude-sonnet-4-5',
  );

  assert.match(next, /terminal:\n  backend: docker/);
  assert.match(next, /display:\n  skin: minimal/);
  assert.match(next, /model:\n  provider: custom\n  default: anthropic\/claude-sonnet-4-5\n  base_url: https:\/\/api\.qnaigc\.com\/v1\n  api_key: qiniu-key/);
  assert.match(next, /context_length: 200000/);
  assert.doesNotMatch(next, /openrouter/);
  assert.doesNotMatch(next, /sk-old/);
});

test('buildHermesConfig escapes scalar values that require YAML quoting', () => {
  const next = buildHermesConfig('', 'https://openai.sufy.com/', 'key:with#chars', 'vendor/model:latest');
  const parsed = yaml.load(next);

  assert.match(next, /base_url: https:\/\/openai\.sufy\.com\/v1/);
  assert.deepEqual(parsed.model, {
    provider: 'custom',
    default: 'vendor/model:latest',
    base_url: 'https://openai.sufy.com/v1',
    api_key: 'key:with#chars',
  });
});

test('removeManagedHermesConfig removes only helper-managed Hermes model fields', () => {
  const content = buildHermesConfig(
    [
      'model:',
      '  provider: custom',
      '  default: keep-model',
      '  context_length: 128000',
      'terminal:',
      '  backend: local',
      '',
    ].join('\n'),
    'https://api.qnaigc.com',
    'qiniu-key',
    'anthropic/claude-sonnet-4-5',
  );

  const next = removeManagedHermesConfig(content);

  assert.match(next, /model:\n  context_length: 128000/);
  assert.match(next, /terminal:\n  backend: local/);
  assert.doesNotMatch(next, /provider: custom/);
  assert.doesNotMatch(next, /default: anthropic\/claude-sonnet-4-5/);
  assert.doesNotMatch(next, /api_key: qiniu-key/);
  assert.doesNotMatch(next, /base_url: https:\/\/api\.qnaigc\.com\/v1/);
});

test('toolManager registers Hermes Agent by name', () => {
  const tool = toolManager.get('hermes');

  assert.equal(tool?.displayName, 'Hermes Agent');
  assert.equal(tool?.command, 'hermes');
});

test('applyHermesConfigPermissions tightens existing Hermes config permissions', () => {
  if (process.platform === 'win32') {
    return;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-config-'));
  const file = path.join(dir, 'config.yaml');
  fs.writeFileSync(file, 'model:\n  provider: custom\n', { mode: 0o666 });
  fs.chmodSync(dir, 0o777);
  fs.chmodSync(file, 0o666);

  applyHermesConfigPermissions(dir, file);

  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('buildHermesModelChoices includes explicit manual model input option', () => {
  const choices = buildHermesModelChoices([
    {
      id: 'anthropic/claude-sonnet-4-5',
      name: 'Claude Sonnet 4.5',
      description: '',
      features: [],
      model_constraints: {
        context_length: 200000,
        max_tokens: 8192,
        max_completion_tokens: 8192,
        max_default_completion_tokens: 8192,
        max_chain_of_thought_length: 0,
      },
      architecture: {
        input_modalities: ['text'],
        output_modalities: ['text'],
        function_calling: { supported: true },
        schema_output: { supported: false },
        reasoning: { supported: false },
        content_cache: { supported: false },
      },
      issuer: {
        name: 'Anthropic',
        avatar: '',
        model_page: '',
      },
    },
  ]);

  assert.equal(choices.at(-1)?.value, HERMES_MANUAL_MODEL_VALUE);
  assert.match(choices.at(-1)?.name || '', /Enter model ID manually|手动输入模型 ID/);
});
