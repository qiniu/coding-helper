import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCodexConfig,
  removeManagedCodexConfig,
  buildPosixEnvBlock,
  buildFishEnvBlock,
  shouldPersistApiKey,
  secureEnvFileMode,
} from '../dist/lib/tools/codex-tool.js';

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

  const next = buildCodexConfig(existing, 'https://api.qnaigc.com', 'openai/gpt-5.2');

  assert.match(next, /^approval_policy = "on-request"/);
  assert.match(next, /model_provider = "qnaigc"/);
  assert.match(next, /\[model_providers\.other\]\nname = "Other"/);
  assert.match(next, /\[model_providers\.qnaigc\]\nname = "Qiniu"\nbase_url = "https:\/\/api\.qnaigc\.com\/bypass\/openai\/v1"/);
  assert.match(next, /env_key = "QINIU_API_KEY"/);
  assert.match(next, /\[profiles\.qn-gpt\]\nmodel_provider = "qnaigc"\nmodel = "openai\/gpt-5\.2"/);
  assert.match(next, /\[profiles\.keep\]\nmodel_provider = "other"\nmodel = "keep-model"/);
  assert.doesNotMatch(next, /https:\/\/old\.example/);
  assert.doesNotMatch(next, /model = "old-model"/);
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

test('environment blocks quote API keys safely', () => {
  assert.equal(
    buildPosixEnvBlock("abc'def"),
    [
      '# >>> coding-helper QINIU_API_KEY >>>',
      "export QINIU_API_KEY='abc'\\''def'",
      '# <<< coding-helper QINIU_API_KEY <<<',
      '',
    ].join('\n'),
  );

  assert.equal(
    buildFishEnvBlock("abc'def"),
    [
      '# >>> coding-helper QINIU_API_KEY >>>',
      "set -gx QINIU_API_KEY 'abc\\'def'",
      '# <<< coding-helper QINIU_API_KEY <<<',
      '',
    ].join('\n'),
  );
});

test('shouldPersistApiKey fails when interactive user rejects overwrite', () => {
  assert.throws(
    () => shouldPersistApiKey('new-key', 'old-key', { interactive: true, overwriteConfirmed: false }),
    /QINIU_API_KEY/,
  );
});

test('secureEnvFileMode tightens env files to owner read-write', () => {
  assert.equal(secureEnvFileMode(0o644), 0o600);
  assert.equal(secureEnvFileMode(0o600), 0o600);
});
