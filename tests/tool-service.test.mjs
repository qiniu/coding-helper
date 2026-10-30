import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-service-'));
process.env.HOME = process.env.USERPROFILE = home;
const { applyTool, removeTool, exitCodeFor } = await import('../dist/lib/core/tool-service.js');
const { configManager } = await import('../dist/lib/config.js');
const { CodexTool } = await import('../dist/lib/tools/codex-tool.js');
const { stateStore } = await import('../dist/lib/core/state-store.js');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

test('launch-only tools skip both writers even without a helper key', async () => {
  const tool = { launchOnly: true, loadConfig() { assert.fail(); }, unloadConfig() { assert.fail(); } };
  assert.equal((await applyTool(tool)).status, 'skipped');
  assert.equal((await removeTool(tool)).status, 'skipped');
});

test('missing key does not invoke an adapter and adapter errors remain actionable', async () => {
  const tool = { loadConfig() { assert.fail(); } };
  assert.deepEqual(await applyTool(tool), { tool, status: 'failed', reason: 'apikey_not_set' });
  const result = await removeTool({ unloadConfig() { throw new Error('Recover the recorded original'); } });
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'Recover the recorded original');
});

test('service preserves transaction originals, conflict journals and byte-exact restoration', async () => {
  configManager.setApiKey('sk-service-test');
  const dir = path.join(home, '.codex');
  fs.mkdirSync(dir, { recursive: true });
  const configFile = path.join(dir, 'config.toml');
  const canonicalConfig = path.join(fs.realpathSync(dir), 'config.toml');
  const authFile = path.join(dir, 'auth.json');
  const original = '# original\nmodel = "original"\n';
  fs.writeFileSync(configFile, original);
  const tool = new CodexTool();
  assert.equal((await applyTool(tool)).status, 'success');
  const first = stateStore.getFileStates('codex');
  assert.equal(first.length, 1);
  assert.equal(first[0].state.priors.files.find(entry => entry.file === canonicalConfig).original, original);
  assert.equal((await applyTool(tool)).status, 'success');
  assert.deepEqual(stateStore.getFileStates('codex'), first);
  const auth = fs.readFileSync(authFile, 'utf8');
  const stateFile = path.join(home, '.coding-helper/state.json');
  const journal = fs.readFileSync(stateFile, 'utf8');
  fs.writeFileSync(authFile, '{"external":true}\n');
  const conflict = await removeTool(tool);
  assert.equal(conflict.status, 'failed');
  assert.match(conflict.reason, /changed since loading/);
  assert.equal(fs.readFileSync(stateFile, 'utf8'), journal);
  fs.writeFileSync(authFile, auth);
  assert.equal((await removeTool(tool)).status, 'success');
  assert.equal(fs.readFileSync(configFile, 'utf8'), original);
  assert.equal(fs.existsSync(authFile), false);
  assert.deepEqual(stateStore.getFileStates('codex'), []);
});

test('asynchronous adapter failures determine batch exit codes', async () => {
  const failed = await applyTool({ async loadConfig() { throw new Error('Recover the recorded original'); } });
  const skipped = await applyTool({ launchOnly: true });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.reason, 'Recover the recorded original');
  assert.equal(exitCodeFor([failed]), 1);
  assert.equal(exitCodeFor([failed, skipped]), 2);
  assert.equal(exitCodeFor([skipped]), 0);
  assert.equal(exitCodeFor([]), 0);
});

test('auth reload propagates adapter failure as a nonzero exit without losing its message', async () => {
  const { authCommand } = await import('../dist/commands/auth.js');
  const { toolManager } = await import('../dist/lib/tool-manager.js');
  const { uiRenderer } = await import('../dist/lib/wizard/ui/ui-renderer.js');
  const argv = process.argv;
  const exitCode = process.exitCode;
  const renderError = uiRenderer.renderError;
  const messages = [];
  toolManager.register({ name: 'service-failure', displayName: 'Failure', loadConfig() { throw new Error('Restore the original first'); } });
  process.argv = ['node', 'helper', 'auth', 'reload', 'service-failure'];
  uiRenderer.renderError = message => messages.push(message);
  try {
    await authCommand('reload');
    assert.equal(process.exitCode, 1);
    assert.ok(messages.includes('Restore the original first'));
  } finally {
    process.argv = argv;
    process.exitCode = exitCode;
    uiRenderer.renderError = renderError;
  }
});

test('initial setup never reports ready when the helper has no key', async () => {
  const { setupTool } = await import('../dist/lib/wizard/flows/tool-setup-flow.js');
  const { uiRenderer } = await import('../dist/lib/wizard/ui/ui-renderer.js');
  const { promptHelper } = await import('../dist/lib/wizard/ui/prompt-helper.js');
  const names = ['renderHeader', 'renderError', 'renderSuccess'];
  const originals = Object.fromEntries(names.map(name => [name, uiRenderer[name]]));
  const getKey = configManager.getApiKey;
  const enter = promptHelper.pressEnter;
  const messages = [];
  for (const name of names) uiRenderer[name] = value => messages.push([name, value]);
  configManager.getApiKey = () => undefined;
  promptHelper.pressEnter = async () => {};
  try {
    await setupTool({ name: 'missing-key', displayName: 'Missing key', runModelConfigFlow: async () => true, loadConfig() { assert.fail(); } });
    assert.ok(messages.some(([kind]) => kind === 'renderError'));
    assert.equal(messages.some(([kind]) => kind === 'renderSuccess'), false);
  } finally {
    Object.assign(uiRenderer, originals);
    configManager.getApiKey = getKey;
    promptHelper.pressEnter = enter;
  }
});
