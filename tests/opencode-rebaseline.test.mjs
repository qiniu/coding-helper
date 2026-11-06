import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isolateHome } from './helpers/isolated-home.mjs';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-rebaseline-'));
isolateHome(home);
const { OpenCodeTool, getOpenCodeConfigFile } = await import('../dist/lib/tools/opencode-tool.js');
const { applyTool, removeTool, getSyncTargets } = await import('../dist/lib/core/tool-service.js');
const { stateStore } = await import('../dist/lib/core/state-store.js');
const { isExternallyModified } = await import('../dist/lib/core/rebaseline.js');
const { previewWrites, backupsRoot } = await import('../dist/lib/core/safe-write.js');
const { marketModelService } = await import('../dist/lib/market-model-service.js');
const tool = new OpenCodeTool();
tool.getVersion = () => '1.0.0';
marketModelService.fetchModels = async () => { throw Error('offline fixture'); };
const connection = { apiKey: 'sk-fixture', baseUrl: 'https://api.qnaigc.com', models: { toolModels: { opencode: 'vendor/main' } } };
test.after(() => fs.rmSync(home, { recursive: true, force: true }));
async function reset() {
  process.env.XDG_CONFIG_HOME = path.join(home, '.config');
  fs.rmSync(home, { recursive: true, force: true });
  assert.equal((await applyTool(tool, connection)).status, 'success');
}
function edit(change) {
  const file = getOpenCodeConfigFile();
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  change(value);
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
  return fs.readFileSync(file, 'utf8');
}
function journal() { return JSON.stringify(stateStore.getFileStates(tool.name)); }

test('retained Qiniu provider is inactive; preview is read-only, reconnect and restore preserve the switched baseline', async () => {
  await reset();
  const switched = edit(value => { value.model = 'anthropic/claude-sonnet-4'; });
  const before = journal();
  assert.equal(tool.isConfigured(), false);
  assert.deepEqual(getSyncTargets([tool]), []);
  assert.equal(isExternallyModified(tool), true);
  const preview = await previewWrites(() => applyTool(tool, connection));
  assert.equal(preview.value.status, 'success');
  assert.equal(fs.readFileSync(getOpenCodeConfigFile(), 'utf8'), switched);
  assert.equal(journal(), before);
  assert.equal((await applyTool(tool, connection)).status, 'success');
  assert.equal(tool.isConfigured(), true);
  assert.ok(fs.readdirSync(backupsRoot()).some(name => name.startsWith('rebaseline-opencode-')));
  assert.equal((await removeTool(tool)).status, 'success');
  assert.deepEqual(JSON.parse(fs.readFileSync(getOpenCodeConfigFile(), 'utf8')), JSON.parse(switched));
});

test('restore after a provider switch leaves the external configuration untouched', async () => {
  await reset();
  const switched = edit(value => { value.model = 'anthropic/claude-sonnet-4'; });
  assert.equal((await removeTool(tool)).status, 'success');
  assert.equal(fs.readFileSync(getOpenCodeConfigFile(), 'utf8'), switched);
  assert.deepEqual(stateStore.getFileStates(tool.name), []);
});

for (const scenario of ['same-provider-model', 'missing-model', 'disabled-provider', 'corrupt', 'missing-file', 'pending', 'changed-directory', 'new-jsonc']) {
  test(`uncertain or incomplete ${scenario} does not discard restoration records`, async () => {
    await reset();
    const file = getOpenCodeConfigFile();
    if (scenario === 'same-provider-model') edit(value => { value.model = 'qiniu/vendor/other'; });
    else if (scenario === 'missing-model') edit(value => { delete value.model; });
    else if (scenario === 'disabled-provider') edit(value => { value.model = 'anthropic/claude-sonnet-4'; value.disabled_providers = ['anthropic']; });
    else if (scenario === 'corrupt') fs.writeFileSync(file, '{broken');
    else if (scenario === 'missing-file') fs.unlinkSync(file);
    else if (scenario === 'pending') {
      edit(value => { value.model = 'anthropic/claude-sonnet-4'; });
      const entry = stateStore.getFileStates(tool.name)[0];
      stateStore.setState(tool.name, { ...entry.state, pending: { before: null, after: 'pending', applied: {} } }, entry.file);
    } else if (scenario === 'changed-directory') {
      process.env.XDG_CONFIG_HOME = path.join(home, 'other');
      const next = getOpenCodeConfigFile(); fs.mkdirSync(path.dirname(next), { recursive: true });
      fs.writeFileSync(next, '{"model":"anthropic/claude-sonnet-4"}');
    } else fs.writeFileSync(file + 'c', '{"model":"anthropic/claude-sonnet-4"}');
    const before = journal();
    assert.equal(isExternallyModified(tool), false);
    assert.equal(journal(), before);
  });
}

test('effective route follows inherited providers and the higher-priority JSONC model', async () => {
  await reset();
  const file = getOpenCodeConfigFile();
  fs.writeFileSync(file + 'c', '{"model":"anthropic/claude-sonnet-4"}');
  assert.equal(tool.isConfigured(), false);
  fs.writeFileSync(file + 'c', '{"model":"qiniu/vendor/main"}');
  assert.equal(tool.isConfigured(), true);
});

test('same provider with an explicitly changed endpoint establishes a new restore baseline', async () => {
  await reset();
  const switched = edit(value => { value.provider.qiniu.options.baseURL = 'https://foreign.example/v1'; });
  assert.equal(isExternallyModified(tool), true);
  assert.equal((await applyTool(tool, connection)).status, 'success');
  assert.equal((await removeTool(tool)).status, 'success');
  assert.deepEqual(JSON.parse(fs.readFileSync(getOpenCodeConfigFile(), 'utf8')), JSON.parse(switched));
});
