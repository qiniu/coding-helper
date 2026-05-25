import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-helper-test-'));

const { configManager } = await import('../dist/lib/config.js');
const {
  hasSavedToolModelConfig,
} = await import('../dist/lib/wizard/menus/tool-menu.js');
const { CodexTool } = await import('../dist/lib/tools/codex-tool.js');
const { promptHelper } = await import('../dist/lib/wizard/ui/prompt-helper.js');

test('Codex model setup saves the fixed model in coding-helper config', async () => {
  configManager.clearConfig();
  const tool = new CodexTool();
  const originalPressEnter = promptHelper.pressEnter;
  promptHelper.pressEnter = async () => {};

  try {
    assert.equal(hasSavedToolModelConfig(tool, configManager.getModels()), false);

    await tool.runModelConfigFlow();

    assert.equal(hasSavedToolModelConfig(tool, configManager.getModels()), true);
    assert.equal(configManager.getModels().codexModel, tool.defaultModel);
  } finally {
    promptHelper.pressEnter = originalPressEnter;
  }
});

test('hasSavedToolModelConfig recognizes saved tool model fields', () => {
  configManager.clearConfig();

  assert.equal(
    hasSavedToolModelConfig({ name: 'claude-code' }, { claudeCode: { useDefaultModels: true } }),
    true,
  );
  assert.equal(
    hasSavedToolModelConfig({ name: 'codebuddy' }, { codeBuddyModels: ['model-a'] }),
    true,
  );
  assert.equal(
    hasSavedToolModelConfig({ name: 'workbuddy' }, { workbuddyModels: ['model-b'] }),
    true,
  );
});
