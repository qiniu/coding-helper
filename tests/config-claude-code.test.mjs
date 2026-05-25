import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import yaml from 'js-yaml';

process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-helper-config-test-'));

const { configManager } = await import('../dist/lib/config.js');

test('setModels saves Claude Code model config under top-level claudeCode section', () => {
  configManager.clearConfig();

  configManager.setModels({
    claudeCode: {
      haikuModel: 'claude-haiku',
      sonnetModel: 'claude-sonnet',
      opusModel: 'claude-opus',
      subagentModel: 'claude-subagent',
      useDefaultModels: false,
    },
  });

  const parsed = yaml.load(fs.readFileSync(configManager.configFile, 'utf-8'));

  assert.deepEqual(parsed.claudeCode, {
    haikuModel: 'claude-haiku',
    sonnetModel: 'claude-sonnet',
    opusModel: 'claude-opus',
    subagentModel: 'claude-subagent',
    useDefaultModels: false,
  });
  assert.equal(parsed.haikuModel, undefined);
  assert.equal(parsed.sonnetModel, undefined);
  assert.equal(parsed.opusModel, undefined);
  assert.equal(parsed.subagentModel, undefined);
  assert.equal(parsed.claudeCodeUseDefaultModels, undefined);
});

test('getModels returns a copy of Claude Code config', () => {
  configManager.clearConfig();
  configManager.setModels({
    claudeCode: {
      haikuModel: 'claude-haiku',
    },
  });

  const models = configManager.getModels();
  models.claudeCode.haikuModel = 'mutated-haiku';

  assert.equal(configManager.getModels().claudeCode.haikuModel, 'claude-haiku');
});

test('setModels merges partial Claude Code config updates', () => {
  configManager.clearConfig();
  configManager.setModels({
    claudeCode: {
      haikuModel: 'claude-haiku',
      sonnetModel: 'claude-sonnet',
      useDefaultModels: false,
    },
  });

  configManager.setModels({
    claudeCode: {
      haikuModel: 'updated-haiku',
    },
  });

  assert.deepEqual(configManager.getModels().claudeCode, {
    haikuModel: 'updated-haiku',
    sonnetModel: 'claude-sonnet',
    useDefaultModels: false,
  });
});
