import assert from 'node:assert/strict'; import test from 'node:test'; import { runPrompt } from './helpers/prompt-pty.mjs';

// 分母包含全部工具；启动接入只有安装、Key、模型及本地配置就绪时才计入分子。
const head = ({ connectAll = false, ready = false, key = true, model = true, setup = '' } = {}) => `
const {i18n}=await import('./dist/lib/i18n.js');i18n.init('zh_CN');
const {configManager}=await import('./dist/lib/config.js');
${key ? "configManager.setApiKey('sk-demo1234567890abcd');" : ''}
${model && ready ? "configManager.setModels({toolModels:{copilot:'demo-model'}});" : ''}
const {toolManager}=await import('./dist/lib/tool-manager.js');
for (const tool of toolManager.getAll()) { tool.isInstalled=()=>false; tool.getVersion=()=>null; tool.isConfigured=()=>${connectAll}; }
toolManager.get('copilot').isInstalled=()=>${ready};
const all=toolManager.getAll();const launchOnly=all.filter(t=>t.launchOnly);
${setup}
const {connectedToolNames}=await import('./dist/lib/wizard/ui/ui-renderer.js');
console.log('COUNTS',JSON.stringify({total:all.length,configurable:all.length-launchOnly.length,launchOnly:launchOnly.map(t=>t.displayName),writable:connectedToolNames()}));
const {showMainMenu}=await import('./dist/lib/wizard/menus/main-menu.js');await showMainMenu();`;
const counts = out => JSON.parse(out.match(/COUNTS (.*)/)[1]);
const checkCounts = (out, expected) => {
  const { total, writable } = counts(out);
  assert.match(out, new RegExp(`已接入 ${expected} / ${total}`));
  assert.match(out, new RegExp(`我的工具 +${expected} / ${total} 已接入`));
  assert.doesNotMatch(out, /另 1 款启动接入|已接入 · GitHub Copilot CLI/);
  // 显示计数包含 Copilot，但持久配置操作的目标仍不包含它。
  assert.ok(!writable.includes('copilot'));
};

test('real PTY main menu counts all registered tools in both denominators', { skip: process.platform === 'win32' }, async () => {
  const out = await runPrompt(head(), [[/Esc 退出/, '\x1b']], 120, { rows: 32 });
  const { total, configurable, launchOnly } = counts(out);
  assert.deepEqual(launchOnly, ['GitHub Copilot CLI']);
  assert.equal(configurable + launchOnly.length, total);
  checkCounts(out, 0);
});

test('real PTY main menu reaches 14/14 when persistent and launch connections are ready', { skip: process.platform === 'win32' }, async () => {
  const out = await runPrompt(head({connectAll:true, ready:true}), [[/Esc 退出/, '\x1b']], 120, { rows: 32 });
  checkCounts(out, counts(out).total);
});

for (const [label, options] of [
  ['not installed', {ready:false}],
  ['missing Key', {ready:true, key:false}],
  ['missing model', {ready:true, model:false}],
  ['conflicting provider registry', {ready:true, setup:`const fs=await import('node:fs');const path=await import('node:path');const dir=path.join(process.env.HOME,'.copilot');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'providers.json'),JSON.stringify({providers:{external:{}}}));`}],
]) {
  test(`real PTY main menu excludes Copilot from the numerator when ${label}`, { skip: process.platform === 'win32' }, async () => {
    const out = await runPrompt(head({connectAll:true, ...options}), [[/Esc 退出/, '\x1b']], 120, { rows: 32 });
    checkCounts(out, counts(out).configurable);
  });
}

for (const [label, setup] of [
  ['default model', "configManager.setModels({defaultModel:'demo-model'});"],
  ['bound profile Key', "configManager.saveProfile('copilot-test','sk-profile-key','china');configManager.setToolProfile('copilot','copilot-test');configManager.setModels({defaultModel:'demo-model'});"],
]) {
  test(`real PTY main menu counts Copilot using its ${label}`, { skip: process.platform === 'win32' }, async () => {
    const out = await runPrompt(head({ready:true, key:label!=='bound profile Key', model:false, setup}), [[/Esc 退出/, '\x1b']], 120, { rows: 32 });
    checkCounts(out, 1);
  });
}
