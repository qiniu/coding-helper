import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { runPrompt } from './helpers/prompt-pty.mjs';

const source = (name, accept) => `
  import fs from 'node:fs';
  import path from 'node:path';
  import assert from 'node:assert/strict';
  import { configManager } from './dist/lib/config.js';
  import { i18n } from './dist/lib/i18n.js';
  import { toolManager } from './dist/lib/tool-manager.js';
  import { toolSlots } from './dist/lib/core/model-slots.js';
  import { savedModelFor } from './dist/lib/core/model-mapping.js';
  import { marketModelService } from './dist/lib/market-model-service.js';
  import { showToolMenu } from './dist/lib/wizard/menus/tool-menu.js';
  import { promptHelper } from './dist/lib/wizard/ui/prompt-helper.js';
  import { safeWriteFile, isPreview } from './dist/lib/core/safe-write.js';
  i18n.init('en_US');
  configManager.setApiKey('fixture');
  const tool = toolManager.get('${name}');
  tool.getVersion = () => null;
  tool.isInstalled = () => true;
  tool.isConfigured = () => false;
  tool.npmPackageName = undefined;
  tool.defaultModel = 'alpha/one';
  tool.checkModel = async () => undefined;
  marketModelService.fetchModels = async () => ['alpha/one', 'beta/two'].map(id => ({
    id, name: id, features: ['工具调用', '视觉'], issuer: { name: id.split('/')[0] },
  }));
  const file = path.join(process.env.HOME, 'client.json');
  fs.writeFileSync(file, 'original');
  const before = fs.readFileSync(configManager.configFile, 'utf8');
  let writes = 0;
  tool.loadConfig = async (_key, _url, models) => {
    if (!isPreview()) writes++;
    safeWriteFile(file, JSON.stringify(models));
  };
  promptHelper.pressEnter = async () => console.log('WRITE_ACK');
  console.log('CONSENT_FILES', JSON.stringify({ file, before, configFile: configManager.configFile }));
  // Inquirer 中断时可能直接关闭输入；退出钩子仍验证草稿没有落盘。
  process.once('exit', () => {
    assert.equal(writes, ${accept ? 1 : 0});
    ${accept ? `
      const written = JSON.parse(fs.readFileSync(file, 'utf8'));
      configManager.reload();
      for (const models of [written, configManager.getModels()]) {
        assert.equal(savedModelFor(tool, models), 'beta/two');
        assert.equal(models.slotModels[tool.name][toolSlots(tool.name)[0].id], 'alpha/one');
      }
    ` : `
      assert.equal(fs.readFileSync(file, 'utf8'), 'original');
      assert.equal(fs.readFileSync(configManager.configFile, 'utf8'), before);
    `}
    console.log('INITIAL_CONSENT_OK');
  });
  showToolMenu(tool).catch(error => assert.equal(error.name, 'ExitPromptError'));
`;

for (const name of ['codex', 'claude-code', 'grok', 'hermes', 'droid']) {
  for (const action of ['escape', 'decline', 'interrupt', 'accept']) {
    test(`${name} initial slot configuration: ${action} preserves the draft until consent`, { skip: process.platform === 'win32' }, async () => {
      // 从未保存模型的工具详情进入，实际编辑主模型与第一个槽位。
      const steps = [
        ['Select action', '\r'],
        [/Next[^]*Esc back/, '\r'],
        [/Type search/, 'beta/two\r'],
        [/Next[^]*Esc back/, '\x1b[H\x1b[B\r'],
        [/Type search/, 'alpha/one\r'],
        [/Next[^]*Esc back/, action === 'escape' ? '\x1b' : '\r'],
      ];
      if (action !== 'escape') steps.push([/Write configuration to [^?]+\?[^]*No|\? Confirm[^]*Esc back/, text => {
        const files = JSON.parse(/CONSENT_FILES ([^\r\n]+)/.exec(text)[1]);
        assert.equal(fs.readFileSync(files.file, 'utf8'), 'original');
        assert.equal(fs.readFileSync(files.configFile, 'utf8'), files.before);
        if (action === 'accept') return '\r';
        if (action === 'interrupt') return '\x03';
        return text.includes('Write configuration to ') ? '\x1b[B\r' : '\x1b';
      }]);
      if (action === 'accept') steps.push([/WRITE_ACK[^]*Select action/, '\x03']);
      else if (action !== 'interrupt') steps.push(['Select action', '\x03']);
      const out = await runPrompt(source(name, action === 'accept'), steps, 120, { rows: 42 });
      assert.match(out, /INITIAL_CONSENT_OK/);
    });
  }
}
