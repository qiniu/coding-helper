import assert from 'node:assert/strict'; import test from 'node:test'; import { runPrompt } from './helpers/prompt-pty.mjs';
// 菜单项前可能带图标（如 ≡ ◎），按键定位时允许一个可选图标；工具数取自注册表
const { toolManager } = await import('../dist/lib/tool-manager.js');
const TOOL_COUNT = toolManager.getAll().length;

// 各页面共用页头规则：终端放得下「Logo + 状态栏 + 页面内容」时显示完整像素 Logo，否则退回一行标题；
// 两种情况下页面内容（进度、选项、操作提示）都必须在一屏内
const strip = text => text.replace(/\x1B(?:[@-Z\\-_a-z]|\[[0-?]*[ -/]*[@-~])/g, '');
const pre = `const fs=await import('node:fs');const os=await import('node:os');const path=await import('node:path');
const dir=path.join(os.homedir(),'.coding-helper');fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'config.yaml'),'lang: zh_CN\\napi_key: sk-test1234567890abcd\\nendpoint: china\\nclaudeCode:\\n  sonnetModel: z-ai/glm-5.2\\n  opusModel: z-ai/glm-5.2\\n  useDefaultModels: false\\n');
const {i18n}=await import('./dist/lib/i18n.js');i18n.init('zh_CN');const {toolManager}=await import('./dist/lib/tool-manager.js');
for (const tool of toolManager.getAll()) { tool.isInstalled=()=>false; tool.getVersion=()=>null; tool.isConfigured=()=>false; }`;
const flow = (mod, expr) => `${pre}const m=await import('./dist/lib/wizard/${mod}');await ${expr};`;
const mainMenu = flow('menus/main-menu.js', 'm.showMainMenu()');

// [名称, 源码, 进入页面的按键, 页面上必须可见的内容, 退出按键]
const pages = [
  ['wizard endpoint step', flow('flows/endpoint-selection-flow.js', 'm.runEndpointSelectionFlow({current:2,total:6})'), [], ['2 / 6', '国内线路', '海外线路', '自定义地址', 'Esc'], '\x1b'],
  ['wizard API key step', flow('flows/api-key-flow.js', 'm.runApiKeyFlow(false,{current:3,total:6})'), [], ['3 / 6', '请输入您的 API Key', 'Esc'], '\x1b'],
  ['main menu', mainMenu, [], ['接入编码工具', '我的工具', '账号与线路', '更多', 'Esc 退出'], '\x1b'],
  ['account page', mainMenu, [[/Esc 退出/, '\x1b[B\x1b[B\x1b[B'], [/❯ +(?:\S+ )?账号与线路/, '\r']], ['配置 API Key', '配置线路', '配置档', 'Esc 返回'], ['\x1b', [/Esc 退出/, '\x1b']]],
  ['profile page', mainMenu, [[/Esc 退出/, '\x1b[B\x1b[B\x1b[B'], [/❯ +(?:\S+ )?账号与线路/, '\r'], [/配置档[^]*Esc 返回/, '\x1b[B\x1b[B'], [/❯ +(?:\S+ )?配置档/, '\r']], ['新建配置档', '返回', 'Esc 返回'], ['\x1b', [/配置 API Key[^]*Esc 返回/, '\x1b'], [/Esc 退出/, '\x1b']]],
  ['model slot page', `${pre}const {editToolModels}=await import('./dist/lib/wizard/flows/model-slots-flow.js');await editToolModels(toolManager.get('claude-code'));`, [], ['主模型', '使用 Claude Code 内置模型', '下一步', 'Esc 返回'], '\x1b'],
];

// 进入页面，等页面画完后按 exit 退出；返回包含全部预期内容的最后一屏（最后一次清屏之后）
// exit：第一个元素是页面画完后立即发送的按键，其余为后续 [等待内容, 按键] 步骤（一次写入多个 Esc 会被当成 Alt+Esc）
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
async function page(source, steps, expected, exit, columns, rows) {
  const [first, ...rest] = Array.isArray(exit) ? exit : [exit];
  const ready = new RegExp(`${escape(expected[0])}[^]*${escape(expected.at(-1))}`);
  const raw = await runPrompt(source, [...steps, [ready, first], ...rest], columns, { rows, raw: true });
  return strip(raw.split('\x1Bc').findLast(chunk => expected.every(item => strip(chunk).includes(item))) ?? '');
}

for (const [name, source, steps, expected, exit] of pages) {
  for (const [columns, rows, logo] of [[100, 40, true], [100, 24, false]]) {
    test(`${name} at ${columns}x${rows} ${logo ? 'shows the pixel logo' : 'falls back to the one-line title'} and keeps the page on one screen`, { skip: process.platform === 'win32' }, async () => {
      const screen = await page(source, steps, expected, exit, columns, rows);
      assert.ok(screen, `page content not found for ${name}`);
      const body = screen.split('? 请')[0];
      assert.equal(/[▀▄█]/.test(body), logo, screen);
      if (!logo) assert.match(body, /QINIU Coding Helper/);
      for (const item of expected) assert.ok(screen.includes(item), `${item} missing:\n${screen}`);
      // 页面从顶端到操作提示不超过一屏（另留 1 行给光标）
      const lines = screen.split(/\r?\n/);
      const used = lines.findLastIndex(line => line.includes(expected.at(-1))) + 1;
      assert.ok(used > 0 && used < rows, `${name} uses ${used} of ${rows} rows`);
    });
  }
}

// 列表页：放得下 Logo 与整个列表时才显示 Logo，否则退回一行标题，保证全部工具都在一屏内
// （13～14 个工具时：46 行放得下 Logo + 整个列表，40 行放不下）
for (const [rows, logo] of [[46, true], [40, false]]) {
  test(`tool checklist at 100x${rows} ${logo ? 'shows the logo with' : 'drops the logo to keep'} every tool visible`, { skip: process.platform === 'win32' }, async () => {
    const source = `${pre}const {WIZARD_STEP_KEYS}=await import('./dist/lib/wizard/ui/ui-renderer.js');const m=await import('./dist/lib/wizard/flows/tool-setup-flow.js');await m.runToolSetupFlow(undefined,{first:4,total:6,keys:WIZARD_STEP_KEYS});`;
    const raw = await runPrompt(source, [[/4 \/ 6[^]*Esc 返回/, '\x1b']], 100, { rows, raw: true });
    const screen = strip(raw.split('\x1Bc').findLast(chunk => strip(chunk).includes('4 / 6')));
    assert.equal(/[▀▄█]/.test(screen.split('4 / 6')[0]), logo, screen);
    const total = (screen.match(/[☐☑] [^\n]*(?:已安装|未安装|桌面应用)/g) ?? []).length;
    assert.equal(total, TOOL_COUNT, screen);
    assert.ok(screen.split(/\r?\n/).findLastIndex(line => line.includes('Esc 返回')) + 1 < rows, screen);
  });
}
