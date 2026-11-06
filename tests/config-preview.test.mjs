import { isolateHome } from './helpers/isolated-home.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'config-preview-'));
isolateHome(home);
const { previewWrites, publicPlannedChanges, safeWriteFile, readTextFile, writeTextOrRemove, isPreview } = await import('../dist/lib/core/safe-write.js');
const { stateStore } = await import('../dist/lib/core/state-store.js');
const { toolManager } = await import('../dist/lib/tool-manager.js');
const { applyTool } = await import('../dist/lib/core/tool-service.js');
const oldFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({ status: true, data: [{ id: 'preview-model', features: ['工具调用'],
  model_constraints: { context_length: 128000, max_tokens: 8192 }, architecture: { function_calling: { supported: true }, input_modalities: ['text'], output_modalities: ['text'], reasoning: { supported: false } } }] }));
test.after(() => { globalThis.fetch = oldFetch; fs.rmSync(home, { recursive: true, force: true }); });

test('preview maintains a coherent file view across repeated writes and deletions', async () => {
  const file = path.join(home, 'nested/config.json');
  const result = await previewWrites(async () => {
    safeWriteFile(file, 'one'); assert.equal(readTextFile(file), 'one');
    safeWriteFile(file, 'two', 0o600, { content: 'one' }); assert.equal(readTextFile(file), 'two');
    writeTextOrRemove(file, undefined); assert.equal(readTextFile(file), undefined);
    assert.throws(() => { safeWriteFile(file, 'bad', 0o600, { content: 'two' }); }, /changed before writing/);
  });
  assert.deepEqual(result.changes, []);
  assert.equal(fs.existsSync(path.dirname(file)), false);
  assert.equal(isPreview(), false);
});
test('all supported builtin writers preview without creating client files, backups or journals', async () => {
  const models = { defaultModel: 'preview-model', codexModel: 'openai/gpt-6-astra', hermesModel: 'preview-model', codeBuddyModels: ['preview-model'], workbuddyModels: ['preview-model'] };
  const result = await previewWrites(async () => {
    const results = [];
    for (const tool of toolManager.getAll()) {
      tool.getVersion = () => null;
      results.push(await applyTool(tool, { apiKey: 'sk-preview', baseUrl: 'https://api.qnaigc.com', models }));
    }
    assert.ok(stateStore.getRecordedTools().includes('codex'));
    return results;
  });
  for (const item of result.value) {
    assert.equal(item.status, item.tool.launchOnly ? 'skipped' : item.tool.name === 'minimax-code' ? 'failed' : 'success', item.tool.name + ': ' + item.reason);
  }
  assert.ok(result.changes.some(change => change.file.endsWith('config.toml')));
  assert.ok(result.changes.some(change => change.file.endsWith('settings.json')));
  assert.equal(result.changes.some(change => change.file.endsWith('state.json')), false);
  assert.deepEqual(fs.readdirSync(home), []);
});
test('public preview never includes previous or replacement credentials', async () => {
  const file = path.join(home, 'existing.json');
  const before = '{"apiKey":"old-private-key","other":{"password":"other-secret"}}';
  fs.writeFileSync(file, before, { mode: 0o640 });
  const mode = fs.statSync(file).mode;
  const result = await previewWrites(async () => { safeWriteFile(file, '{"apiKey":"new-private-key"}'); });
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(fs.statSync(file).mode, mode);
  const output = JSON.stringify(publicPlannedChanges(result.changes));
  for (const secret of ['old-private-key','new-private-key','other-secret']) assert.equal(output.includes(secret), false);
  fs.rmSync(file);
});
test('preview errors discard their memory view and never execute unapproved writers', async () => {
  const file = path.join(home, 'discarded');
  await assert.rejects(previewWrites(async () => { safeWriteFile(file, 'planned'); throw Error('cancel'); }), /cancel/);
  assert.equal(readTextFile(file), undefined);
  const result = await previewWrites(() => applyTool({ loadConfig() { assert.fail('unsafe writer invoked'); } }));
  assert.equal(result.value.reason, 'setup_preview_unsupported');
  assert.deepEqual(fs.readdirSync(home), []);
});

test('preview respects an active configuration lock and leaves its owner file untouched', async () => {
  const dir = path.join(home, '.coding-helper'); fs.mkdirSync(dir);
  const lock = path.join(dir, 'state.lock'); fs.writeFileSync(lock, 'other-process');
  try {
    const result = await previewWrites(() => applyTool(toolManager.get('codex'), { apiKey: 'fake', baseUrl: 'https://api.qnaigc.com', models: {} }));
    assert.equal(result.value.status, 'failed');
    assert.match(result.value.reason, /Another configuration operation/);
    assert.equal(fs.readFileSync(lock, 'utf8'), 'other-process');
    assert.deepEqual(result.changes, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
