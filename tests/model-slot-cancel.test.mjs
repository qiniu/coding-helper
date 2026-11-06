import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isolateHome } from './helpers/isolated-home.mjs';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'model-cancel-'));
isolateHome(home);
test.after(() => fs.rmSync(home, { recursive: true, force: true }));
const { configManager } = await import('../dist/lib/config.js');
const { promptHelper } = await import('../dist/lib/wizard/ui/prompt-helper.js');
const { runModelSelectionFlow } = await import('../dist/lib/wizard/flows/model-selection-flow.js');

for (let cancelAt = 0; cancelAt < 4; cancelAt++) {
  test(`Esc at Claude model slot ${cancelAt + 1} cancels without saving or asking for later slots`, async t => {
    configManager.setApiKey('fake');
    configManager.setModels({ claudeCode: { sonnetModel: 'existing/main', useDefaultModels: false }, recentModels: ['existing/main'] });
    const before = fs.readFileSync(configManager.configFile, 'utf8');
    let prompts = 0;
    let confirmations = 0;
    t.mock.method(promptHelper, 'confirm', async () => { confirmations++; return true; });
    t.mock.method(promptHelper, 'pickModel', async () => prompts++ === cancelAt ? 'back' : { model: 'new/model' });
    assert.equal(await runModelSelectionFlow(), false);
    assert.equal(prompts, cancelAt + 1);
    assert.equal(confirmations, 1);
    assert.equal(fs.readFileSync(configManager.configFile, 'utf8'), before);
  });
}

test('restoring built-in models removes stale roles from memory and persisted configuration', () => {
  const builtin = { claudeCode: { useDefaultModels: true } };
  const saves = [models => configManager.setModels(models), models => configManager.saveSettings('fake', 'china', models)];
  if (typeof configManager.saveToolSettings === 'function') saves.push(models => configManager.saveToolSettings(models));
  for (const save of saves) {
    configManager.setModels({ claudeCode: { sonnetModel: 'existing/main', haikuModel: 'existing/fast', useDefaultModels: false } });
    save(builtin);
    assert.deepEqual(configManager.getModels().claudeCode, { useDefaultModels: true });
    assert.doesNotMatch(fs.readFileSync(configManager.configFile, 'utf8'), /(?:sonnetModel|haikuModel):/);
  }
});
