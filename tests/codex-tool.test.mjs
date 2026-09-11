import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCodexConfig,
  buildCodexAuthJson,
  buildCodexModelCatalog,
  removeManagedCodexConfig,
} from '../dist/lib/tools/codex-tool.js';

test('buildCodexModelCatalog contains only GPT models with Codex metadata', () => {
  const catalog = JSON.parse(buildCodexModelCatalog([
    { id: 'openai/gpt-5.4', context_length: 1050000, max_tokens: 128000 },
    { id: 'anthropic/claude-sonnet', context_length: 200000, max_tokens: 64000 },
  ]));

  assert.deepEqual(catalog.models.map((model) => model.slug), ['openai/gpt-5.4']);
  assert.equal(catalog.models[0].context_window, 1050000);
  assert.equal(catalog.models[0].max_context_window, 1050000);
  assert.equal(catalog.models[0].truncation_policy.limit, 10000);
  assert.equal(catalog.models[0].support_verbosity, false);
});

test('buildCodexConfig preserves unrelated TOML and replaces managed qnaigc blocks', () => {
  const existing = [
    'approval_policy = "on-request"',
    'model_provider = "old"',
    '',
    '[model_providers.other]',
    'name = "Other"',
    '',
    '[model_providers.qnaigc]',
    'name = "Old"',
    'base_url = "https://old.example/v1"',
    '',
    '[profiles.qn-gpt]',
    'model_provider = "old"',
    'model = "old-model"',
    '',
    '[profiles.keep]',
    'model_provider = "other"',
    'model = "keep-model"',
    '',
  ].join('\n');

  const next = buildCodexConfig(existing, 'https://api.qnaigc.com', 'openai/gpt-5.2', '/tmp/qnaigc.json');

  assert.match(next, /^approval_policy = "on-request"/);
  assert.match(next, /model_provider = "qnaigc"/);
  assert.match(next, /\[model_providers\.other\]\nname = "Other"/);
  assert.match(next, /\[model_providers\.qnaigc\]\nname = "Qiniu"\nbase_url = "https:\/\/api\.qnaigc\.com\/bypass\/openai\/v1"/);
  assert.match(next, /requires_openai_auth = true/);
  assert.match(next, /model_catalog_json = "\/tmp\/qnaigc\.json"/);
  assert.doesNotMatch(next, /env_key = "QINIU_API_KEY"/);
  assert.match(next, /\[profiles\.qn-gpt\]\nmodel_provider = "qnaigc"\nmodel = "openai\/gpt-5\.2"/);
  assert.match(next, /\[profiles\.keep\]\nmodel_provider = "other"\nmodel = "keep-model"/);
  assert.doesNotMatch(next, /https:\/\/old\.example/);
  assert.doesNotMatch(next, /model = "old-model"/);
});

test('removeManagedCodexConfig removes the managed catalog path', () => {
  const next = removeManagedCodexConfig('model_catalog_json = "/tmp/qnaigc.json"\nmodel_provider = "qnaigc"\n');
  assert.doesNotMatch(next, /model_catalog_json/);
});

test('removeManagedCodexConfig removes only helper-managed Codex settings', () => {
  const content = buildCodexConfig(
    [
      '[profiles.keep]',
      'model_provider = "qnaigc"',
      'model = "keep"',
      '',
      '[model_providers.qnaigc.auth]',
      'command = "old-token-command"',
      '',
    ].join('\n'),
    'https://api.qnaigc.com',
    'openai/gpt-5.2',
  );
  const next = removeManagedCodexConfig(content);

  assert.match(next, /\[profiles\.keep\]\nmodel_provider = "qnaigc"\nmodel = "keep"/);
  assert.doesNotMatch(next, /\[model_providers\.qnaigc\]/);
  assert.doesNotMatch(next, /\[model_providers\.qnaigc\.auth\]/);
  assert.doesNotMatch(next, /\[profiles\.qn-gpt\]/);
});

test('buildCodexConfig removes stale qnaigc dotted subtables before writing provider', () => {
  const next = buildCodexConfig(
    [
      '[model_providers.qnaigc]',
      'name = "Old"',
      '',
      '[model_providers.qnaigc.auth]',
      'command = "old-token-command"',
      '',
    ].join('\n'),
    'https://api.qnaigc.com',
  );

  assert.match(next, /\[model_providers\.qnaigc\]/);
  assert.doesNotMatch(next, /\[model_providers\.qnaigc\.auth\]/);
  assert.doesNotMatch(next, /old-token-command/);
});

test('buildCodexAuthJson stores the API key in Codex API key auth mode and preserves unrelated fields', () => {
  const next = buildCodexAuthJson(
    JSON.stringify({
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: { refresh_token: 'keep-refresh-token' },
      last_refresh: '2026-05-20T00:00:00Z',
    }),
    'qiniu-key',
  );

  assert.deepEqual(JSON.parse(next), {
    auth_mode: 'apikey',
    OPENAI_API_KEY: 'qiniu-key',
    tokens: { refresh_token: 'keep-refresh-token' },
    last_refresh: '2026-05-20T00:00:00Z',
  });
});
