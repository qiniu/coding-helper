import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isolateHome } from './helpers/isolated-home.mjs';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-desktop-')));
isolateHome(home);
const { DshTool, parseDshPatch, DSH_PROVIDER } = await import('../dist/lib/tools/dsh-tool.js');
const { OpenAICompatTool } = await import('../dist/lib/tools/openai-compat-tool.js');
const { stateStore } = await import('../dist/lib/core/state-store.js');
const { previewWrites } = await import('../dist/lib/core/safe-write.js');
const { marketModelService } = await import('../dist/lib/market-model-service.js');
const { promptHelper } = await import('../dist/lib/wizard/ui/prompt-helper.js');
const { launchTool } = await import('../dist/lib/wizard/menus/tool-menu.js');
const { i18n } = await import('../dist/lib/i18n.js');
i18n.init('en_US');
const tool = new DshTool(), root = path.join(home, '.dsh');
const desktop = path.join(root, 'profiles/desktop'), manifest = path.join(desktop, 'package.json');
const patch = path.join(desktop, 'cordis.patch.yml'), env = path.join(root, '.env');
const url = 'https://api.qnaigc.com';
const models = { toolModels: { dsh: 'main' } };
const packageText = JSON.stringify({ name: 'dsh-profile-desktop', private: true,
  dependencies: { 'user-plugin': '1.0.0' },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'user-plugin'] } },
}, null, 2) + '\r\n';
const seed = '# Desktop user settings\n- id: llm-pi-ai\n  config:\n    providers:\n      desktop-only: {baseURL: https://foreign.example/v1}\n- id: user-plugin\n  disabled: !!js process.platform === "win32"\n- id: agent-default-model\n  config: {provider: desktop-only, model: mine}\n';
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
function reset() {
  delete process.env.DSH_HOME;
  fs.rmSync(root, { recursive: true, force: true });
  for (const entry of stateStore.getFileStates('dsh')) stateStore.markRemoved('dsh', entry.file);
}
function initialize() { write(manifest, packageText); write(patch, seed); }
const read = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
const route = file => parseDshPatch(read(file)).toJS().find(row => row.id === 'llm-pi-ai').config.providers;
globalThis.fetch = async () => new Response(JSON.stringify({ status: true, data: ['main', 'next'].map(id => ({
  id, features: ['工具调用'], model_constraints: { context_length: 1000000, max_tokens: 128000 },
  architecture: { input_modalities: ['text', 'image'] },
})) }));
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

test('Desktop preview preserves manifest, plugins, credentials and restoration state', async () => {
  reset(); initialize(); write(env, '# keep\nOTHER=value\n');
  const state = path.join(home, '.coding-helper/state.json');
  const before = [manifest, patch, env, state].map(read);
  const preview = await previewWrites(() => tool.loadConfig('fixture-key', url, models));
  assert.ok(preview.changes.some(change => change.file === patch));
  assert.ok(!preview.changes.some(change => change.file === manifest));
  assert.deepEqual([manifest, patch, env, state].map(read), before);
});

test('Desktop receives a separate provider catalog and restores exact bytes without touching runtime files', async () => {
  reset(); initialize(); const originalEnv = '# keep\nOTHER=value\n'; write(env, originalEnv);
  const lock = path.join(desktop, 'pnpm-lock.yaml'), dependency = path.join(desktop, 'node_modules/user-plugin/keep');
  write(lock, 'app-owned lock\n'); write(dependency, 'app-owned dependency\n');
  for (const model of ['main', 'next']) await tool.loadConfig('fixture-key', url, { toolModels: { dsh: model } });
  assert.equal(tool.isConfigured(), true);
  assert.deepEqual(tool.getConfig().profiles, ['web', 'headless', 'desktop']);
  assert.equal(read(manifest), packageText);
  assert.match(read(patch), /# Desktop user settings/); assert.match(read(patch), /!!js/);
  assert.ok(route(patch)['desktop-only']);
  for (const profile of ['web', 'headless']) {
    const other = route(path.join(root, 'profiles', profile, 'cordis.patch.yml'));
    assert.equal(other['desktop-only'], undefined);
  }
  const provider = route(patch)[DSH_PROVIDER];
  assert.equal(provider.apiKeyEnv, 'CODING_HELPER_DSH_API_KEY');
  assert.deepEqual(provider.models.map(model => model.id), ['main', 'next']);
  assert.deepEqual(provider.models[0].input, ['text', 'image']);
  assert.match(tool.getLoadConfigNotes().join('\n'), /Restart Desktop/);
  await tool.unloadConfig();
  assert.equal(read(patch), seed); assert.equal(read(env), originalEnv); assert.equal(read(manifest), packageText);
  assert.equal(read(lock), 'app-owned lock\n'); assert.equal(read(dependency), 'app-owned dependency\n');
  assert.equal(stateStore.getFileStates('dsh').length, 0);
});

test('existing five-file CLI transactions extend to Desktop without replacing original restore baselines', async () => {
  reset(); await tool.loadConfig('fixture-key', url, models);
  assert.equal(stateStore.getFileStates('dsh')[0].state.priors.files.length, 5);
  initialize();
  await tool.loadConfig('new-fixture-key', url, { toolModels: { dsh: 'next' } });
  assert.equal(stateStore.getFileStates('dsh')[0].state.priors.files.length, 6);
  assert.equal(tool.getConfig().model, 'next');
  await tool.unloadConfig();
  assert.equal(read(patch), seed); assert.equal(read(manifest), packageText);
  assert.equal(read(env), undefined);
  for (const profile of ['web', 'headless']) {
    assert.equal(read(path.join(root, 'profiles', profile, 'cordis.patch.yml')), undefined);
    assert.equal(read(path.join(root, 'profiles', profile, 'package.json')), undefined);
  }
});

test('Desktop UI settings do not prevent first loading or reloading after restoration', async () => {
  reset(); initialize(); const settings = path.join(root, 'settings.yaml');
  const original = 'ui-onboarding:\n  welcomeNoticeVersion: 2026-08-13.1\n'; write(settings, original);
  for (let attempt = 0; attempt < 2; attempt++) {
    await tool.loadConfig('fixture-key', url, models);
    assert.equal(tool.getConfig().model, 'main');
    await tool.unloadConfig();
    assert.equal(read(patch), seed); assert.equal(read(manifest), packageText);
    assert.equal(read(settings), original); assert.equal(read(env), undefined);
  }
});

test('invalid Desktop manifests and patches fail before writing any profile or credential', async () => {
  for (const broken of ['{"dsh":{"profile":{"bundles":["unknown"]}}}', '{bad']) {
    reset(); initialize(); write(manifest, broken); write(env, 'OTHER=value\n');
    await assert.rejects(tool.loadConfig('fixture-key', url, models));
    assert.equal(read(manifest), broken); assert.equal(read(patch), seed); assert.equal(read(env), 'OTHER=value\n');
    assert.equal(stateStore.getFileStates('dsh').length, 0);
  }
  reset(); initialize(); write(patch, '- id: llm-pi-ai\n- id: llm-pi-ai\n');
  await assert.rejects(tool.loadConfig('fixture-key', url, models));
  assert.equal(read(env), undefined); assert.equal(read(manifest), packageText);
});

test('Desktop manifest changes during metadata lookup abort before the helper writes', async t => {
  reset(); initialize(); write(env, 'OTHER=value\n');
  t.mock.method(marketModelService, 'fetchModels', async () => { write(manifest, packageText + ' '); return []; });
  await assert.rejects(tool.loadConfig('fixture-key', url, models), /manifest changed/);
  assert.equal(read(patch), seed); assert.equal(read(env), 'OTHER=value\n');
  assert.equal(read(manifest), packageText + ' '); assert.equal(stateStore.getFileStates('dsh').length, 0);
});

test('Desktop restore still works if the application manifest was removed externally', async () => {
  reset(); initialize(); await tool.loadConfig('fixture-key', url, models); fs.rmSync(manifest);
  await tool.unloadConfig();
  assert.equal(read(manifest), undefined); assert.equal(read(patch), seed); assert.equal(read(env), undefined);
  assert.equal(stateStore.getFileStates('dsh').length, 0);
});

test('Desktop-only installations use restart guidance instead of requiring or launching the npm CLI', async t => {
  reset(); initialize();
  t.mock.method(OpenAICompatTool.prototype, 'isInstalled', () => false);
  assert.equal(tool.isInstalled(), null);
  assert.throws(() => tool.getLaunchEnv('fixture-key', url, models), /restart Desktop/);
  let acknowledged = false;
  t.mock.method(promptHelper, 'pressEnter', async () => { acknowledged = true; });
  await launchTool(tool); assert.equal(acknowledged, true);
});

function addClientSettings(file) {
  const doc = parseDshPatch(read(file));
  doc.contents.items.find(row => row.get('id') === 'llm-pi-ai').setIn(['config', 'providers', 'qoder-local'],
    doc.createNode({ baseURL: 'http://127.0.0.1:12345/v1', apiKeyEnv: 'LOCAL_FIXTURE_KEY' }));
  write(file, String(doc) + '# Client-owned UI and permission settings\n- id: ui-theme\n  config: {theme: dark}\n- id: permission\n  disabled: !!js process.platform === "win32"\n');
}
function assertClientSettings(file) {
  assert.equal(route(file)['qoder-local'].apiKeyEnv, 'LOCAL_FIXTURE_KEY');
  assert.match(read(file), /# Client-owned UI/); assert.match(read(file), /!!js/);
  assert.equal(parseDshPatch(read(file)).toJS().find(row => row.id === 'ui-theme').config.theme, 'dark');
}

test('client-added providers and UI settings survive preview, reload and original-model restoration', async () => {
  reset(); initialize(); await tool.loadConfig('fixture-key', url, models);
  const files = ['web', 'headless', 'desktop'].map(profile => path.join(root, 'profiles', profile, 'cordis.patch.yml'));
  files.forEach(addClientSettings);
  const before = [...files, env, path.join(home, '.coding-helper/state.json')].map(read);
  await previewWrites(() => tool.loadConfig('next-key', url, { toolModels: { dsh: 'next' } }));
  assert.deepEqual([...files, env, path.join(home, '.coding-helper/state.json')].map(read), before);
  await tool.loadConfig('next-key', url, { toolModels: { dsh: 'next' } });
  assert.equal(tool.getConfig().model, 'next'); files.forEach(assertClientSettings);
  await tool.unloadConfig(); files.forEach(assertClientSettings);
  files.forEach(file => assert.equal(route(file)[DSH_PROVIDER], undefined));
  assert.equal(parseDshPatch(read(patch)).toJS().find(row => row.id === 'agent-default-model').config.model, 'mine');
  assert.equal(read(env), undefined); assert.equal(read(manifest), packageText);
});

test('direct restore preserves new client settings and its journal survives cleanup failure', async t => {
  reset(); initialize(); await tool.loadConfig('fixture-key', url, models); addClientSettings(patch);
  const remove = stateStore.markRemoved;
  const mock = t.mock.method(stateStore, 'markRemoved', () => { throw Error('cleanup failed'); });
  assert.throws(() => tool.unloadConfig(), /cleanup failed/); mock.mock.restore();
  assertClientSettings(patch); assert.ok(stateStore.getFileStates('dsh').length);
  tool.unloadConfig(); assertClientSettings(patch);
  assert.equal(stateStore.getFileStates('dsh').length, 0); assert.equal(stateStore.markRemoved, remove);
});

test('failed reload rolls back reconciled files and retains the previous journal', async t => {
  reset(); initialize(); await tool.loadConfig('fixture-key', url, models); addClientSettings(patch);
  const stateFile = path.join(home, '.coding-helper/state.json');
  const before = [patch, env, stateFile].map(read), rename = fs.renameSync;
  const mock = t.mock.method(fs, 'renameSync', (from, to) => { if (to === env) throw Error('fixture write failed'); return rename(from, to); });
  await assert.rejects(tool.loadConfig('next-key', url, { toolModels: { dsh: 'next' } }), /fixture write failed/);
  mock.mock.restore(); assert.deepEqual([patch, env, stateFile].map(read), before);
  await tool.loadConfig('next-key', url, { toolModels: { dsh: 'next' } });
  tool.unloadConfig(); assertClientSettings(patch);
});

test('managed edits and interrupted journals still block both reload and restore', async () => {
  for (const keys of [['disabled'], ['name'], ['config', 'providers', DSH_PROVIDER, 'baseURL'], ['config', 'providers', DSH_PROVIDER, 'apiKeyEnv']]) {
    reset(); initialize(); await tool.loadConfig('fixture-key', url, models); addClientSettings(patch);
    const doc = parseDshPatch(read(patch)); doc.contents.items.find(row => row.get('id') === 'llm-pi-ai').setIn(keys, doc.createNode('external-change'));
    write(patch, String(doc)); const before = [patch, env, path.join(home, '.coding-helper/state.json')].map(read);
    await assert.rejects(tool.loadConfig('next-key', url, models)); assert.throws(() => tool.unloadConfig());
    assert.deepEqual([patch, env, path.join(home, '.coding-helper/state.json')].map(read), before);
  }
  reset(); initialize(); await tool.loadConfig('fixture-key', url, models); addClientSettings(patch);
  const record = stateStore.getFileStates('dsh')[0]; record.state.priors.files[0].before = null;
  stateStore.setState('dsh', record.state, record.file);
  await assert.rejects(tool.loadConfig('next-key', url, models), /changed since loading/);
  assert.throws(() => tool.unloadConfig(), /changed since loading/);
});

test('old five-file journal can restore after Desktop is initialized without managing its patch', async () => {
  reset(); await tool.loadConfig('fixture-key', url, models); initialize();
  const web = path.join(root, 'profiles/web/cordis.patch.yml'); addClientSettings(web);
  tool.unloadConfig(); assertClientSettings(web);
  assert.equal(read(patch), seed); assert.equal(read(manifest), packageText); assert.equal(read(env), undefined);
});

test('partial restore keeps reconciled originals in the journal for the next retry', async t => {
  reset(); initialize(); await tool.loadConfig('fixture-key', url, models);
  const web = path.join(root, 'profiles/web/cordis.patch.yml'); [web, patch].forEach(addClientSettings);
  const rename = fs.renameSync;
  const mock = t.mock.method(fs, 'renameSync', (from, to) => { if (to === patch) throw Error('restore interrupted'); return rename(from, to); });
  assert.throws(() => tool.unloadConfig(), /restore interrupted/); mock.mock.restore();
  assertClientSettings(web); assert.equal(route(web)[DSH_PROVIDER], undefined);
  assert.ok(route(patch)[DSH_PROVIDER]); assert.ok(stateStore.getFileStates('dsh').length);
  tool.unloadConfig(); [web, patch].forEach(assertClientSettings);
  assert.equal(route(patch)[DSH_PROVIDER], undefined); assert.equal(stateStore.getFileStates('dsh').length, 0);
});
