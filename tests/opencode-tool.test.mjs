import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOpenCodeConfig,
  removeManagedOpenCodeConfig,
} from '../dist/lib/tools/opencode-tool.js';

test('buildOpenCodeConfig writes managed qiniu provider + qiniu/-prefixed model, preserves user fields', () => {
  const existing = JSON.stringify({
    model: 'openai/gpt-4',
    provider: {
      openai: { options: { apiKey: 'sk-user', baseURL: 'https://api.openai.com/v1' } },
      anthropic: { options: { apiKey: 'sk-user-anthropic' } },
    },
    agent: { plan: { mode: 'subagent' } },
    mcp: { fs: { type: 'local', command: ['node', 'mcp.js'] } },
  });

  const next = JSON.parse(buildOpenCodeConfig(existing, 'https://api.qnaigc.com', 'sk-qiniu-key', 'deepseek/deepseek-v4-flash'));

  // model 字段必须前置 qiniu/ 前缀，让 OpenCode 路由到我们的 provider
  assert.equal(next.model, 'qiniu/deepseek/deepseek-v4-flash');

  // qiniu provider 通过 openai-compatible 适配器路由
  assert.equal(next.provider.qiniu.npm, '@ai-sdk/openai-compatible');
  assert.equal(next.provider.qiniu.name, 'Qiniu');
  // apiKey 明文写入（与 Claude Code / Codex 一致），文件权限 0o600 保证安全
  assert.equal(next.provider.qiniu.options.apiKey, 'sk-qiniu-key');
  // baseURL 必须带 /v1 后缀（OpenAI 协议）
  assert.equal(next.provider.qiniu.options.baseURL, 'https://api.qnaigc.com/v1');
  // models 字段声明当前选的模型
  assert.deepEqual(next.provider.qiniu.models, { 'deepseek/deepseek-v4-flash': {} });

  // 用户原本的 openai / anthropic provider 必须保留
  assert.deepEqual(next.provider.openai, {
    options: { apiKey: 'sk-user', baseURL: 'https://api.openai.com/v1' },
  });
  assert.deepEqual(next.provider.anthropic, { options: { apiKey: 'sk-user-anthropic' } });

  // 其他用户字段保留
  assert.deepEqual(next.agent, { plan: { mode: 'subagent' } });
  assert.deepEqual(next.mcp, { fs: { type: 'local', command: ['node', 'mcp.js'] } });
  // 自动补 $schema
  assert.equal(next.$schema, 'https://opencode.ai/config.json');
});

test('buildOpenCodeConfig is idempotent — second write overwrites prior qiniu block, accumulates models', () => {
  let content = buildOpenCodeConfig('', 'https://api.qnaigc.com', 'sk-1', 'anthropic/claude-sonnet-4-5');
  content = buildOpenCodeConfig(content, 'https://openai.sufy.com', 'sk-2', 'deepseek/deepseek-v4-flash');

  const parsed = JSON.parse(content);
  // 最新的 model 生效
  assert.equal(parsed.model, 'qiniu/deepseek/deepseek-v4-flash');
  // baseURL / apiKey 跟着最新的来
  assert.equal(parsed.provider.qiniu.options.baseURL, 'https://openai.sufy.com/v1');
  assert.equal(parsed.provider.qiniu.options.apiKey, 'sk-2');
  // models 字段累积，方便用户在 OpenCode UI 切换之前选过的模型
  assert.deepEqual(parsed.provider.qiniu.models, {
    'anthropic/claude-sonnet-4-5': {},
    'deepseek/deepseek-v4-flash': {},
  });
  // provider 仍然只有 qiniu 一个（没有重复注入）
  assert.equal(Object.keys(parsed.provider).length, 1);
});

test('buildOpenCodeConfig strips trailing slash from baseURL and appends /v1', () => {
  const next = JSON.parse(buildOpenCodeConfig('', 'https://api.qnaigc.com///', 'sk', 'deepseek/v3'));
  assert.equal(next.provider.qiniu.options.baseURL, 'https://api.qnaigc.com/v1');
});

test('buildOpenCodeConfig handles empty / malformed existing config', () => {
  assert.doesNotThrow(() => buildOpenCodeConfig('', 'https://api.qnaigc.com', 'sk', 'deepseek/v3'));
  assert.doesNotThrow(() => buildOpenCodeConfig('not valid json', 'https://api.qnaigc.com', 'sk', 'deepseek/v3'));
  assert.doesNotThrow(() => buildOpenCodeConfig('null', 'https://api.qnaigc.com', 'sk', 'deepseek/v3'));
  assert.doesNotThrow(() => buildOpenCodeConfig('[]', 'https://api.qnaigc.com', 'sk', 'deepseek/v3'));

  const next = JSON.parse(buildOpenCodeConfig('not valid json', 'https://api.qnaigc.com', 'sk', 'deepseek/v3'));
  assert.equal(next.model, 'qiniu/deepseek/v3');
  assert.equal(next.provider.qiniu.options.apiKey, 'sk');
});

test('removeManagedOpenCodeConfig removes only managed qiniu + qiniu/-model, preserves other providers', () => {
  const built = buildOpenCodeConfig(
    JSON.stringify({
      provider: {
        openai: { options: { apiKey: 'sk-user', baseURL: 'https://api.openai.com/v1' } },
        anthropic: { options: { apiKey: 'sk-user-anthropic' } },
      },
      agent: { plan: { mode: 'subagent' } },
    }),
    'https://api.qnaigc.com',
    'sk-qiniu',
    'deepseek/v3',
  );

  const cleaned = JSON.parse(removeManagedOpenCodeConfig(built));

  // 我们写入的 model 和 qiniu provider 被移除
  assert.equal(cleaned.model, undefined);
  assert.equal(cleaned.provider.qiniu, undefined);
  // 用户原本的 provider 保留
  assert.deepEqual(cleaned.provider.openai, {
    options: { apiKey: 'sk-user', baseURL: 'https://api.openai.com/v1' },
  });
  assert.deepEqual(cleaned.provider.anthropic, { options: { apiKey: 'sk-user-anthropic' } });
  assert.deepEqual(cleaned.agent, { plan: { mode: 'subagent' } });
});

test('removeManagedOpenCodeConfig does NOT touch a user-owned qiniu provider (no npm marker)', () => {
  // 用户自己写的同名 provider 没有 npm:@ai-sdk/openai-compatible 标志，必须保留
  const content = JSON.stringify({
    model: 'qiniu/some-model',
    provider: {
      qiniu: {
        options: { apiKey: 'sk-user-own', baseURL: 'https://custom.qiniu.example/v1' },
      },
    },
  });

  const next = JSON.parse(removeManagedOpenCodeConfig(content));
  assert.equal(next.model, 'qiniu/some-model');
  assert.equal(next.provider.qiniu.options.apiKey, 'sk-user-own');
});

test('removeManagedOpenCodeConfig preserves non-qiniu/ model field even when qiniu provider is managed', () => {
  // 边界场景：用户手动把 model 改成了别的 provider（如 openai/gpt-4），不应该被删
  const built = buildOpenCodeConfig('', 'https://api.qnaigc.com', 'sk', 'deepseek/v3');
  const tampered = JSON.parse(built);
  tampered.model = 'openai/gpt-4';
  const cleaned = JSON.parse(removeManagedOpenCodeConfig(JSON.stringify(tampered)) || '{}');
  assert.equal(cleaned.model, 'openai/gpt-4');
});

test('removeManagedOpenCodeConfig returns empty string when only $schema remains', () => {
  const built = buildOpenCodeConfig('', 'https://api.qnaigc.com', 'sk', 'deepseek/v3');
  const cleaned = removeManagedOpenCodeConfig(built);
  assert.equal(cleaned, '');
});
