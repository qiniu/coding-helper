import assert from 'node:assert/strict'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import test from 'node:test';
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'model-slots-'));
const { configManager } = await import('../dist/lib/config.js');
const { slotModel, slotOverrides } = await import('../dist/lib/core/model-slots.js');
test.after(() => fs.rmSync(process.env.HOME, { recursive: true, force: true }));
test('slot overrides survive main-model changes and only empty the selected tool', () => {
 assert.equal(slotModel('codex', 'review', 'main'), 'main');
 configManager.setModels({ slotModels: { codex: { review: 'review' }, grok: { summary: 'summary' } } });
 configManager.setModels({ codexModel: 'main2' }); assert.equal(slotModel('codex', 'review', 'main2'), 'review'); assert.equal(slotModel('codex', 'memory', 'main2'), 'main2');
 const snapshot = configManager.getModels(); snapshot.slotModels.codex.review = 'mutated'; assert.equal(slotModel('codex', 'review', 'main2'), 'review');
 configManager.setModels({ slotModels: { codex: {} } }); assert.deepEqual(slotOverrides('codex'), {}); assert.equal(slotModel('grok', 'summary', 'main'), 'summary');
});
test('slot patches preserve sibling overrides through both persistence APIs', () => {
 configManager.setModels({slotModels:{codex:{review:'r',memory:'m'}}});
 configManager.setModels({slotModels:{codex:{subagent:'s'}}});
 assert.deepEqual(slotOverrides('codex'),{review:'r',memory:'m',subagent:'s'});
 configManager.saveSettings('sk-test', 'china', {slotModels:{codex:{review:'r2'}}});
 assert.deepEqual(slotOverrides('codex'),{review:'r2',memory:'m',subagent:'s'});
 configManager.setModels({slotModels:{codex:{}}});
 assert.deepEqual(slotOverrides('codex'),{});
});
