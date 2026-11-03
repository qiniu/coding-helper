import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { runPrompt } from './helpers/prompt-pty.mjs';

const source = accept => `
  import fs from 'node:fs';
  import assert from 'node:assert/strict';
  import { configManager } from './dist/lib/config.js';
  import { toolManager } from './dist/lib/tool-manager.js';
  import { promptHelper } from './dist/lib/wizard/ui/prompt-helper.js';
  import { safeWriteFile, isPreview } from './dist/lib/core/safe-write.js';
  import { runContextFlow } from './dist/lib/wizard/flows/context-flow.js';
  configManager.setApiKey('fixture');
  const before = fs.readFileSync(configManager.configFile, 'utf8');
  const files = ['opencode', 'minimax-code'].map(name => process.env.HOME + '/' + name + '.json');
  files.forEach(file => fs.writeFileSync(file, 'original'));
  const writes = [0, 0];
  toolManager.getAll = () => ['opencode', 'minimax-code'].map((name, index) => ({
    name, displayName: name, supportsPreview: index === 0, isConfigured: () => true,
    loadConfig: async () => {
      if (!isPreview()) writes[index]++;
      safeWriteFile(files[index], String(configManager.getContextWindow(name)));
    },
  }));
  promptHelper.pressEnter = async () => {
    // 结果页出现时，两组都必须已经完成；不允许写一组后再等待输入。
    assert.deepEqual(writes, [1, 1]);
  };
  console.log('CONSENT_FILES', JSON.stringify({ files, before, configFile: configManager.configFile }));
  try { await runContextFlow(); }
  catch (error) { assert.equal(error.name, 'ExitPromptError'); }
  assert.deepEqual(writes, ${accept ? '[1, 1]' : '[0, 0]'});
  ${accept ? `
    files.forEach(file => assert.equal(fs.readFileSync(file, 'utf8'), '96000'));
    configManager.reload();
    for (const name of ['opencode', 'minimax-code']) assert.equal(configManager.getContextWindow(name), 96000);
  ` : `
    files.forEach(file => assert.equal(fs.readFileSync(file, 'utf8'), 'original'));
    assert.equal(fs.readFileSync(configManager.configFile, 'utf8'), before);
  `}
  console.log('MIXED_CONSENT_OK');
`;

function unchanged(text) {
  const data = JSON.parse(/CONSENT_FILES ([^\r\n]+)/.exec(text)[1]);
  data.files.forEach(file => assert.equal(fs.readFileSync(file, 'utf8'), 'original'));
  assert.equal(fs.readFileSync(data.configFile, 'utf8'), data.before);
}

for (const action of ['decline-normal', 'escape-normal', 'interrupt-normal', 'escape-preview', 'interrupt-preview', 'accept']) {
  test(`mixed context targets: ${action} waits for every confirmation before writing`, { skip: process.platform === 'win32' }, async () => {
    const steps = [
      ['输入上下文大小', '96k\r'],
      ['选择要修改的工具', '\x1b[A '],
      ['❯ ☑', '\x1b[C'],
      [/不支持预演[^]*Esc 返回/, text => {
        unchanged(text);
        if (action === 'decline-normal') return '\x1b[B\r';
        if (action === 'escape-normal') return '\x1b';
        if (action === 'interrupt-normal') return '\x03';
        return '\r';
      }],
    ];
    if (!action.endsWith('normal')) steps.push([/确认写入[^]*Esc 返回/, text => {
      unchanged(text);
      return action === 'accept' ? '\r' : action === 'escape-preview' ? '\x1b' : '\x03';
    }]);
    const out = await runPrompt(source(action === 'accept'), steps, 120, { rows: 42 });
    assert.match(out, /MIXED_CONSENT_OK/);
  });
}
