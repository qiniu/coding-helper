import assert from 'node:assert/strict'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import test from 'node:test';
import { isolateHome } from './helpers/isolated-home.mjs'; import { runPrompt } from './helpers/prompt-pty.mjs';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-view-')); isolateHome(home); test.after(() => fs.rmSync(home, { recursive: true, force: true }));
const { i18n } = await import('../dist/lib/i18n.js'); i18n.init('en_US');
const { renderResultSummary, detectSorted } = await import('../dist/lib/wizard/ui/tool-view.js');
const { visibleWidth } = await import('../dist/utils/string-width.js');
const strip = value => value.replace(/\x1B\[[0-9;]*m/g, '');
function capture(t, fn) { const lines = []; t.mock.method(console, 'log', (...args) => lines.push(strip(args.join(' ')))); fn(); return lines.join('\n'); }
const base = { command: 'demo', installCommand: 'npm i demo', getVersion: () => { throw Error('version must not be probed'); }, isConfigured: () => true };

test('desktop applications keep the restart guidance instead of a shell command', t => {
  const out = capture(t, () => renderResultSummary([{ tool: { ...base, name: 'workbuddy', displayName: 'WorkBuddy', command: 'workbuddy', isInstalled: () => null }, status: 'success' }]));
  assert.match(out, /restart WorkBuddy/); assert.doesNotMatch(out, /run workbuddy/);
});

test('list ordering puts installed tools first without probing versions', () => {
  const tools = [{ ...base, name: 'a', displayName: 'A', isInstalled: () => false }, { ...base, name: 'b', displayName: 'B', isInstalled: () => true }, { ...base, name: 'c', displayName: 'C', isInstalled: () => null }];
  assert.deepEqual(detectSorted(tools).map(d => d.tool.name), ['b', 'c', 'a']);
});

test('narrow confirmation keeps every value visible', { skip: process.platform === 'win32' }, async () => {
  const source = `import {i18n} from './dist/lib/i18n.js';import {safeWriteFile} from './dist/lib/core/safe-write.js';import {confirmAndWrite} from './dist/lib/wizard/ui/write-plan.js';i18n.init('en_US');const tool={name:'claude-code',displayName:'Claude Code',supportsPreview:true,loadConfig:async()=>safeWriteFile(process.env.HOME+'/.claude/settings.json','{}')};await confirmAndWrite('NARROW_READY',[{tool,changes:[{label:'Main model (Sonnet tier)',after:'vendor/main-model'},{label:'Fallback / background model',after:'vendor/slot-model'}],connection:{apiKey:'fake',baseUrl:'https://example.com',endpoint:'china'}}]);`;
  const out = await runPrompt(source, [[/NARROW_READY[\s\S]*?Esc back/, '\x1b']], 40, { rows: 40 });
  for (const text of ['vendor/main-model', 'vendor/slot-model', '.claude/settings.json']) assert.ok(out.includes(text), text);
});

for (const columns of [40, 80]) {
  test(`result tables fit ${columns} columns and retain complete values`, { skip: process.platform === 'win32' }, async () => {
    const model = 'vendor/long-model-name-with-context-and-vision';
    const source = `import chalk from 'chalk';import {uiRenderer} from './dist/lib/wizard/ui/ui-renderer.js';uiRenderer.renderTable(['Tool','Result','Model','Launch'],[['Claude Code','Done',chalk.cyan(${JSON.stringify(model)}),'claude'],['WorkBuddy','已完成','vendor/another-model','restart WorkBuddy']]);`;
    const out = await runPrompt(source, [], columns, { rows: 24 });
    for (const line of out.split(/\r?\n/)) assert.ok(visibleWidth(line) <= columns, `overflow: ${line}`);
    const compact = out.replace(/\s/g, '');
    for (const value of ['Claude Code', 'Done', model, 'WorkBuddy', '已完成', 'restart WorkBuddy']) {
      assert.ok(compact.includes(value.replace(/\s/g, '')), `missing value: ${value}`);
    }
  });
}

for (const columns of [40, 80, 140]) {
  test(`result summaries retain saved and fallback model IDs at ${columns} columns`, { skip: process.platform === 'win32' }, async () => {
    const saved = 'vendor/saved-model-with-long-version-and-context-20261031-200k';
    const fallback = 'vendor/fallback-model-with-long-version-and-vision-20261031';
    const source = `import {i18n} from './dist/lib/i18n.js';import {configManager} from './dist/lib/config.js';import {renderResultSummary} from './dist/lib/wizard/ui/tool-view.js';i18n.init('en_US');configManager.setModels({codexModel:${JSON.stringify(saved)}});renderResultSummary([{tool:{name:'codex',displayName:'Codex',command:'codex',isInstalled:()=>true,defaultModel:'unused-default'},status:'success'},{tool:{name:'hermes',displayName:'Hermes',command:'hermes',isInstalled:()=>true,defaultModel:${JSON.stringify(fallback)}},status:'success'}]);`;
    const out = await runPrompt(source, [], columns, { rows: 24 });
    const compact = out.replace(/\s/g, '');
    for (const model of [saved, fallback]) assert.ok(compact.includes(model), `missing full model: ${model}\n${out}`);
    assert.doesNotMatch(out, /unused-default/);
  });
}

test('result summary keeps long model ids intact', t => {
  const model = 'vendor/very-long-model-identifier-with-version-2026-10-31-256k';
  const out = capture(t, () => renderResultSummary([{ tool: { ...base, name: 'demo', displayName: 'Demo', defaultModel: model, isInstalled: () => true }, status: 'success' }]));
  assert.ok(out.replace(/\s/g, '').includes(model), out);
});

test('result summary launch hint includes default launch arguments', t => {
  const out = capture(t, () => renderResultSummary([{ tool: { ...base, name: 'dsh', displayName: 'DeepSeek Harness', command: 'dsh', launchArgs: ['web'], isInstalled: () => true }, status: 'success' }]));
  assert.match(out, /dsh web/);
});
