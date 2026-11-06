import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { runPrompt } from './helpers/prompt-pty.mjs';
import { pty, head, frame } from './helpers/buddy-search-fixture.mjs';

// 从真实工具菜单进入，使用真实客户端 writer；只替换网络目录和安装检测。
function fixture(tool, initial, accept) {
  return head(tool, initial ? [] : ['alpha/one']) + `
    import path from 'node:path';
    import { showToolMenu } from './dist/lib/wizard/menus/tool-menu.js';
    import { promptHelper } from './dist/lib/wizard/ui/prompt-helper.js';
    import { isPreview } from './dist/lib/core/safe-write.js';
    const target = toolManager.get(name);
    target.getVersion = () => null;
    target.isInstalled = () => true;
    target.npmPackageName = undefined;
    promptHelper.pressEnter = async () => console.log('WRITE_ACK');
    const file = path.join(process.env.HOME, '.' + name, 'models.json');
    const original = ${JSON.stringify('{\n  "models": [], "custom": "preserve"\n}\n')};
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, original);
    let writes = 0;
    const load = target.loadConfig.bind(target);
    target.loadConfig = async (...args) => {
      if (!isPreview()) writes++;
      return load(...args);
    };
    console.log('CONSENT_FILES', JSON.stringify({ file, original, configFile: configManager.configFile, before }));
    // 旧版 Inquirer 的 Ctrl+C 会直接关闭输入，不会拒绝等待中的 Promise。
    // 退出钩子保证该分支也检查真实文件，而不是依赖菜单正常返回。
    process.once('exit', () => {
      assert.equal(writes, ${accept ? 1 : 0});
      ${accept ? `
        configManager.reload();
        assert.deepEqual(configManager.getModels()[field], ['alpha/one', 'beta/two']);
        const client = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.deepEqual(client.models.map(model => model.id), ['alpha/one', 'beta/two']);
        assert.equal(client.custom, 'preserve');
        assert.ok(client.models.every(model => model.apiKey === 'fixture'));
      ` : `
        assert.equal(fs.readFileSync(configManager.configFile, 'utf8'), before);
        assert.equal(fs.readFileSync(file, 'utf8'), original);
      `}
      console.log('CONSENT_OK');
    });
    showToolMenu(target).catch(error => {
      assert.equal(error.name, 'ExitPromptError');
    });
  `;
}

for (const tool of ['codebuddy', 'workbuddy']) {
  for (const initial of [false, true]) {
    for (const action of ['escape', 'interrupt-editor', 'decline', 'interrupt-confirm', 'accept']) {
      test(`${tool} ${initial ? 'initial setup' : 'model menu'}: ${action} respects write consent`, pty, async () => {
        // 迁移后的详情菜单统一先展示操作列表，首次未配置也由用户进入模型编辑。
        const steps = [['Select action', '\r']];
        if (initial) steps.push([frame, 'alpha/one '], [/Selected 1:[^]*Type search/, '\x1b']);
        steps.push([frame, 'beta/two ']);
        if (action === 'escape') {
          steps.push([/Selected 2:[^]*Type search/, '\x1b'], [frame, '\x1b']);
        } else if (action === 'interrupt-editor') {
          steps.push([/Selected 2:[^]*Type search/, '\x03']);
        } else {
          steps.push([/Selected 2:[^]*Type search/, '\t']);
          steps.push([/Write configuration to (?:CodeBuddy|WorkBuddy)\?[^]*No|\? Confirm[^]*Esc back/, text => {
            // 在真实确认提示出现时检查落盘状态，避免仅检查取消后的最终结果。
            const files = JSON.parse(/CONSENT_FILES ([^\r\n]+)/.exec(text)[1]);
            assert.equal(fs.readFileSync(files.configFile, 'utf8'), files.before);
            assert.equal(fs.readFileSync(files.file, 'utf8'), files.original);
            if (action === 'accept') return '\r';
            if (action === 'interrupt-confirm') return '\x03';
            return text.includes('Write configuration to ') ? '\x1b[B\r' : '\x1b';
          }]);
        }
        if (action === 'accept') steps.push([/WRITE_ACK[^]*Select action/, '\x03']);
        else if (action === 'escape' || action === 'decline') steps.push(['Select action', '\x03']);
        const out = await runPrompt(fixture(tool, initial, action === 'accept'), steps, 120, { rows: 42 });
        assert.match(out, /CONSENT_OK/);
      });
    }
  }
}
