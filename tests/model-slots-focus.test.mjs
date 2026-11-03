import assert from 'node:assert/strict'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import test from 'node:test'; import yaml from 'js-yaml';
import { isolateHome } from './helpers/isolated-home.mjs'; import { runPrompt } from './helpers/prompt-pty.mjs';

// 「配置模型」页：首次进入聚焦主模型（不论已有模型还是只有工具默认模型），回车直接打开模型选择，Esc 返回不保存、不写客户端配置
const models = `[{id:'z-ai/glm-5.2',name:'GLM-5.2',features:['工具调用'],model_constraints:{context_length:200000,max_tokens:8192},architecture:{function_calling:{supported:true},input_modalities:['text']}}]`;
const source = (tool, saved) => `import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const dir=path.join(os.homedir(),'.coding-helper');fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'config.yaml'),${JSON.stringify(`lang: zh_CN\napi_key: sk-test\nendpoint: china\n${saved}`)});
const {i18n}=await import('./dist/lib/i18n.js');i18n.init('zh_CN');
const {configManager}=await import('./dist/lib/config.js');const {marketModelService}=await import('./dist/lib/market-model-service.js');
const {toolManager}=await import('./dist/lib/tool-manager.js');const {editToolModels}=await import('./dist/lib/wizard/flows/model-slots-flow.js');
marketModelService.fetchModels=async()=>${models};
const tool=toolManager.get('${tool}');let writes=0;tool.loadConfig=async()=>{writes++;};tool.unloadConfig=async()=>{writes++;};
const before=fs.readFileSync(configManager.configFile,'utf8');
const plan=await editToolModels(tool);
console.log('RESULT',plan===undefined?'cancel':'plan','WRITES',writes,'UNCHANGED',fs.readFileSync(configManager.configFile,'utf8')===before);`;

const cases = [
  ['opencode', 'saved model', 'toolModels:\n  opencode: z-ai/glm-5.2\n', '主模型'],
  ['codex', 'tool default model only (no saved model)', '', '主模型'],
  ['claude-code', 'saved model (multiple slots)', 'claudeCode:\n  sonnetModel: z-ai/glm-5.2\n  opusModel: z-ai/glm-5.2\n  useDefaultModels: false\n', '主模型（Sonnet'],
  ['codex', 'saved model (multiple slots)', 'codexModel: openai/gpt-5.5\n', '主模型'],
];
for (const [tool, label, saved, mainLabel] of cases) {
  test(`real PTY ${tool} model page with ${label} focuses the main model, Enter opens the picker and Esc saves nothing`, { skip: process.platform === 'win32' }, async () => {
    const frames = [];
    const out = await runPrompt(source(tool, saved), [
      [/保存并写入[^]*返回/, text => { frames.push(text.slice(text.lastIndexOf('? 请选择操作'))); return '\r'; }],
      [/⌕[^]*返回/, '\x1b'],
      [/保存并写入[^]*返回/, '\x1b'],
    ], 90, { rows: 30 });
    const [first] = frames;
    // 焦点（❯）在主模型行，而不是「保存并写入」
    assert.match(first, new RegExp(`❯ ?. ?${mainLabel.replace(/[()（）]/g, '.')}`), first);
    assert.doesNotMatch(first, /❯ ?. ?保存并写入/, first);
    // 回车直接进入了模型选择页
    assert.match(out, /⌕/);
    assert.match(out, /RESULT cancel WRITES 0 UNCHANGED true/);
  });
}

// Claude Code：选择「使用 Claude Code 内置模型」后保存，计划为 useDefaultModels: true 且不带模型覆盖
test('real PTY Claude Code model page offers built-in models and returns a plan without custom mappings', { skip: process.platform === 'win32' }, async () => {
  const src = source('claude-code', 'claudeCode:\n  sonnetModel: z-ai/glm-5.2\n  opusModel: z-ai/glm-5.2\n  useDefaultModels: false\n')
    .replace("console.log('RESULT'", "console.log('PLAN',JSON.stringify({builtin:plan?.builtin,models:plan?.models,changes:plan?.changes}));console.log('RESULT'");
  const out = await runPrompt(src, [
    [/使用 Claude Code 内置模型[^]*返回/, '\x1b[B\x1b[B'],
    [/❯ ?. ?子代理/, '\x1b[B'],
    [/❯ ?. ?使用 Claude Code 内置模型[^]*无需自定义映射[^]*返回/, '\r'],
    [/✔ 已选择[^]*返回/, '\r'],
  ], 90, { rows: 30 });
  assert.match(out, /当前使用 Claude Code 内置模型/);
  const plan = JSON.parse(out.match(/PLAN (.*)/)[1]);
  assert.equal(plan.builtin, true);
  assert.deepEqual(plan.models.claudeCode, { useDefaultModels: true });
  assert.deepEqual(plan.models.slotModels, { 'claude-code': {} });
  assert.ok(plan.changes.every(change => change.after === '内置模型'), JSON.stringify(plan.changes));
  assert.match(out, /RESULT plan WRITES 0/);
});

// 已保存为内置模型时再次进入：处于内置状态；选择具体模型即改回自定义映射
test('real PTY Claude Code saved as built-in reopens in built-in state and picking a model switches back to custom', { skip: process.platform === 'win32' }, async () => {
  const src = source('claude-code', 'claudeCode:\n  useDefaultModels: true\n')
    .replace("console.log('RESULT'", "console.log('PLAN',JSON.stringify({builtin:plan?.builtin,main:plan?.main,claude:plan?.models?.claudeCode}));console.log('RESULT'");
  const out = await runPrompt(src, [
    [/✔ 已选择[^]*返回/, '\r'],
    [/⌕[^]*返回/, '\r'],
    [/z-ai\/glm-5\.2[^]*保存并写入[^]*返回/, '\r'],
  ], 90, { rows: 30 });
  const plan = JSON.parse(out.match(/PLAN (.*)/)[1]);
  assert.equal(plan.builtin, undefined);
  assert.equal(plan.main, 'z-ai/glm-5.2');
  assert.equal(plan.claude.useDefaultModels, false);
  assert.equal(plan.claude.sonnetModel, 'z-ai/glm-5.2');
});

// 实际写入：自定义模型 → 内置模型 → 自定义模型，客户端配置与 helper 配置随之切换
test('Claude Code switches from custom models to built-in models and back', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-builtin-')); isolateHome(home);
  try {
    const { configManager } = await import('../dist/lib/config.js');
    const { toolManager } = await import('../dist/lib/tool-manager.js');
    const { applyTool } = await import('../dist/lib/core/tool-service.js');
    const { builtinPlanForClaude, planForTool } = await import('../dist/lib/wizard/flows/model-pick-flow.js');
    const tool = toolManager.get('claude-code');
    configManager.setApiKey('sk-test');
    const settings = () => JSON.parse(fs.readFileSync(path.join(home, '.claude/settings.json'), 'utf8')).env;
    const saved = () => yaml.load(fs.readFileSync(configManager.configFile, 'utf8')).claudeCode;
    const write = async plan => {
      const result = await applyTool(tool, { apiKey: 'sk-test', baseUrl: 'https://api.qnaigc.com', models: plan.models });
      assert.equal(result.status, 'success', JSON.stringify(result));
      configManager.saveToolSettings(plan.models, {}, plan.main);
    };
    await write(planForTool(tool, 'z-ai/glm-5.2', {}));
    assert.equal(settings().ANTHROPIC_DEFAULT_SONNET_MODEL, 'z-ai/glm-5.2');
    await write(builtinPlanForClaude(tool));
    for (const key of ['ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL']) assert.equal(settings()[key], undefined, key);
    assert.equal(settings().ANTHROPIC_BASE_URL, 'https://api.qnaigc.com');
    assert.deepEqual(saved(), { useDefaultModels: true });
    await write(planForTool(tool, 'qwen/qwen3.7-plus', {}));
    assert.equal(settings().ANTHROPIC_DEFAULT_SONNET_MODEL, 'qwen/qwen3.7-plus');
    assert.equal(saved().useDefaultModels, false);
    await tool.unloadConfig();
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
