import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildCodexConfig,
  buildCodexAuthJson,
  buildCodexModelCatalog,
  backupCodexFile,
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

test('buildCodexConfig replaces existing TOML to avoid configuration conflicts', () => {
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

  assert.doesNotMatch(next, /approval_policy = "on-request"/);
  assert.match(next, /model_provider = "qnaigc"/);
  assert.doesNotMatch(next, /\[model_providers\.other\]/);
  assert.match(next, /\[model_providers\.qnaigc\]\nname = "Qiniu"\nbase_url = "https:\/\/api\.qnaigc\.com\/bypass\/openai\/v1"/);
  assert.match(next, /requires_openai_auth = true/);
  assert.match(next, /model_catalog_json = "\/tmp\/qnaigc\.json"/);
  assert.doesNotMatch(next, /env_key = "QINIU_API_KEY"/);
  assert.match(next, /\[profiles\.qn-gpt\]\nmodel_provider = "qnaigc"\nmodel = "openai\/gpt-5\.2"/);
  assert.doesNotMatch(next, /\[profiles\.keep\]/);
  assert.doesNotMatch(next, /https:\/\/old\.example/);
  assert.doesNotMatch(next, /model = "old-model"/);
});

test('backupCodexFile copies an existing file and returns its backup path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-helper-codex-'));
  const file = path.join(dir, 'config.toml');
  fs.writeFileSync(file, 'customer config\n');

  const backup = backupCodexFile(file, new Date(2026, 8, 11, 12, 34, 56));

  assert.equal(backup, `${file}.bak-fenno-20260911123456`);
  assert.equal(fs.readFileSync(backup, 'utf8'), 'customer config\n');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('backupCodexFile avoids overwriting an existing same-second backup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-helper-codex-'));
  const file = path.join(dir, 'config.toml');
  const timestamp = new Date(2026, 8, 11, 12, 34, 56);
  fs.writeFileSync(file, 'first\n');
  const first = backupCodexFile(file, timestamp);
  fs.writeFileSync(file, 'second\n');
  const second = backupCodexFile(file, timestamp);

  assert.equal(fs.readFileSync(first, 'utf8'), 'first\n');
  assert.equal(fs.readFileSync(second, 'utf8'), 'second\n');
  assert.notEqual(first, second);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('removeManagedCodexConfig removes the managed catalog path', () => {
  const next = removeManagedCodexConfig('model_catalog_json = "/home/user/.codex/model-catalogs/qnaigc.json"\nmodel_provider = "qnaigc"\n');
  assert.doesNotMatch(next, /model_catalog_json/);
});

test('removeManagedCodexConfig preserves a user-owned catalog path', () => {
  const next = removeManagedCodexConfig('model_catalog_json = "/tmp/custom-catalog.json"\nmodel_provider = "qnaigc"\n');
  assert.match(next, /model_catalog_json = "\/tmp\/custom-catalog\.json"/);
});

test('buildCodexConfig replaces a user-owned catalog path', () => {
  const next = buildCodexConfig(
    'model_catalog_json = "/tmp/custom-catalog.json"\n',
    'https://api.qnaigc.com',
    'openai/gpt-5.5',
    '/home/user/.codex/model-catalogs/qnaigc.json',
  );
  assert.equal((next.match(/model_catalog_json\s*=/g) || []).length, 1);
  assert.match(next, /model_catalog_json = "\/home\/user\/\.codex\/model-catalogs\/qnaigc\.json"/);
  assert.doesNotMatch(next, /custom-catalog/);
});

test('buildCodexConfig writes the managed catalog at top level', () => {
  const next = buildCodexConfig(
    '[profiles.keep]\nmodel = "keep"\n',
    'https://api.qnaigc.com',
    'openai/gpt-5.5',
    '/home/user/.codex/model-catalogs/qnaigc.json',
  );
  assert.match(next, /^model_provider = "qnaigc"\nmodel_catalog_json = "\/home\/user\/\.codex\/model-catalogs\/qnaigc\.json"/);
  assert.doesNotMatch(next, /profiles\.keep/);
});

test('removeManagedCodexConfig removes the managed catalog path with Windows separators', () => {
  const next = removeManagedCodexConfig('model_catalog_json = "C:\\\\Users\\\\user\\\\.codex\\\\model-catalogs\\\\qnaigc.json"\n');
  assert.doesNotMatch(next, /model_catalog_json/);
});

test('removeManagedCodexConfig removes only helper-managed Codex settings', () => {
  const content = [
    '[profiles.keep]',
    'model_provider = "qnaigc"',
    'model = "keep"',
    '',
    '[model_providers.qnaigc.auth]',
    'command = "old-token-command"',
    '',
    '[profiles.qn-gpt]',
    'model_provider = "qnaigc"',
    'model = "openai/gpt-5.2"',
    '',
  ].join('\n');
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
