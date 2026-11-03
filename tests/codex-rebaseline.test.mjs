import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse, stringify } from 'smol-toml';
import { isolateHome } from './helpers/isolated-home.mjs';
import { runPrompt } from './helpers/prompt-pty.mjs';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-rebaseline-')));
isolateHome(home);
const { CodexTool } = await import('../dist/lib/tools/codex-tool.js');
const { stateStore } = await import('../dist/lib/core/state-store.js');
const { configManager } = await import('../dist/lib/config.js');
const { applyTool, removeTool } = await import('../dist/lib/core/tool-service.js');
const { isExternallyModified, rebaselineTool } = await import('../dist/lib/core/rebaseline.js');
const { previewWrites, backupsRoot } = await import('../dist/lib/core/safe-write.js');
const tool = new CodexTool();
const dir = path.join(home, '.codex');
const config = path.join(dir, 'config.toml');
const auth = path.join(dir, 'auth.json');
const stateFile = path.join(home, '.coding-helper/state.json');
const connection = { apiKey: 'dummy-qiniu-new', baseUrl: 'https://api.qnaigc.com', models: { codexModel: 'openai/gpt-5.6-sol' } };

test.beforeEach(() => {
  configManager.clearConfig();
  stateStore.clear();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(config, '# original official configuration\nmodel = "gpt-5.5"\n');
  fs.writeFileSync(auth, '{"auth_mode":"chatgpt","tokens":{"refresh_token":"dummy-original"}}\n');
});
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

async function switchedToOfficial({ profile = false, exported = false } = {}) {
  if (exported) configManager.saveProfile('work', 'dummy-profile', 'china');
  await tool.loadConfig('dummy-qiniu-old', connection.baseUrl, connection.models);
  // 模拟旧版曾写入全局登录限制，恢复记录也保存着该旧快照。
  const records = stateStore.getFileStates('codex');
  const entry = records[0].state.priors.files.find(entry => entry.file === path.join(fs.realpathSync(dir), 'config.toml'));
  entry.applied = 'forced_login_method = "api"\n' + entry.applied;
  fs.writeFileSync(config, entry.applied);
  stateStore.setState('codex', records[0].state, records[0].file);
  const current = parse(entry.applied);
  if (profile) {
    current.profile = 'official';
    current.profiles = { official: { model_provider: 'openai', model: 'gpt-5.5' } };
    // 顶层仍指向七牛，但当前 profile 已覆盖它。
  } else {
    delete current.model_provider;
    current.model = 'gpt-5.5';
  }
  current.forced_login_method = 'chatgpt';
  current.approval_policy = 'on-request';
  current.mcp_servers = { demo: { command: 'node', args: ['keep-current'] } };
  const official = stringify(current);
  const officialAuth = '{ "auth_mode": "chatgpt", "OPENAI_API_KEY": null, "tokens": {"refresh_token":"dummy-refreshed"}, "last_refresh":"new" }\n';
  fs.writeFileSync(config, official);
  fs.writeFileSync(auth, officialAuth);
  return { official, officialAuth };
}

test('official login with an inactive Qiniu provider previews, archives, reloads and restores the new baseline', async () => {
  const { official, officialAuth } = await switchedToOfficial();
  assert.ok(parse(official).model_providers.qnaigc);
  assert.equal(tool.isConfigured(), false);
  assert.equal(isExternallyModified(tool), true);
  const journal = fs.readFileSync(stateFile, 'utf8');
  const backups = fs.existsSync(backupsRoot()) ? fs.readdirSync(backupsRoot()) : [];
  const preview = await previewWrites(() => applyTool(tool, connection));
  assert.equal(preview.value.status, 'success');
  assert.ok(preview.changes.some(change => change.file === config));
  assert.equal(fs.readFileSync(config, 'utf8'), official);
  assert.equal(fs.readFileSync(auth, 'utf8'), officialAuth);
  assert.equal(fs.readFileSync(stateFile, 'utf8'), journal);
  assert.deepEqual(fs.existsSync(backupsRoot()) ? fs.readdirSync(backupsRoot()) : [], backups);

  const result = await applyTool(tool, connection);
  assert.equal(result.status, 'success');
  assert.equal(tool.isConfigured(), true);
  assert.equal(parse(fs.readFileSync(config, 'utf8')).forced_login_method, undefined);
  assert.equal(JSON.parse(fs.readFileSync(auth, 'utf8')).auth_mode, 'apikey');
  const archiveDir = fs.readdirSync(backupsRoot()).find(name => !backups.includes(name) && name.startsWith('rebaseline-codex-'));
  assert.ok(archiveDir);
  const archive = JSON.parse(fs.readFileSync(path.join(backupsRoot(), archiveDir, 'manifest.json'), 'utf8'));
  assert.ok(Object.keys(archive.records).length);
  assert.ok(archive.files.some(entry => entry.backup && fs.readFileSync(entry.backup, 'utf8') === official));
  assert.ok(archive.files.some(entry => entry.backup && fs.readFileSync(entry.backup, 'utf8') === officialAuth));
  const baseline = stateStore.getFileStates('codex')[0].state.priors.files;
  assert.equal(baseline.find(entry => entry.file === config).original, official);
  assert.equal(baseline.find(entry => entry.file === auth).original, officialAuth);
  assert.equal((await removeTool(tool)).status, 'success');
  assert.equal(fs.readFileSync(config, 'utf8'), official);
  assert.equal(fs.readFileSync(auth, 'utf8'), officialAuth);

  // 官方状态继续修改设置、刷新登录，再次接入和还原也不回到过期凭据。
  const edited = official + '\n# later official edit\n';
  const refreshed = officialAuth.replace('dummy-refreshed', 'dummy-latest');
  fs.writeFileSync(config, edited);
  fs.writeFileSync(auth, refreshed);
  assert.equal((await applyTool(tool, connection)).status, 'success');
  assert.equal((await removeTool(tool)).status, 'success');
  assert.equal(fs.readFileSync(config, 'utf8'), edited);
  assert.equal(fs.readFileSync(auth, 'utf8'), refreshed);
});

test('active official profile overrides the top-level Qiniu provider and exported helper files retain ownership', async () => {
  const { official, officialAuth } = await switchedToOfficial({ profile: true, exported: true });
  const exported = path.join(dir, 'qn-work.config.toml');
  const originalExport = fs.readFileSync(exported, 'utf8');
  assert.equal(tool.isConfigured(), false);
  assert.equal(isExternallyModified(tool), true);
  assert.equal((await applyTool(tool, connection)).status, 'success');
  assert.equal((await removeTool(tool)).status, 'success');
  assert.equal(fs.readFileSync(config, 'utf8'), official);
  assert.equal(fs.readFileSync(auth, 'utf8'), officialAuth);
  assert.equal(fs.readFileSync(exported, 'utf8'), originalExport);
  assert.equal((await applyTool(tool, connection)).status, 'success', 'a later reload must still recognize archived helper profiles');
  assert.equal((await removeTool(tool)).status, 'success');
  assert.equal(fs.readFileSync(config, 'utf8'), official);
  assert.equal(fs.readFileSync(auth, 'utf8'), officialAuth);
  assert.equal(fs.readFileSync(exported, 'utf8'), originalExport);
  const edited = parse(official);
  edited.model_providers['qnaigc-work'].experimental_bearer_token = 'dummy-user-owned';
  const userOwned = stringify(edited);
  fs.writeFileSync(config, userOwned);
  assert.equal((await applyTool(tool, connection)).status, 'failed', 'an archived display name must not authorize replacing edited credentials');
  assert.equal(fs.readFileSync(config, 'utf8'), userOwned);
  assert.equal(fs.readFileSync(auth, 'utf8'), officialAuth);
});

test('an active third-party endpoint is recognized even when the provider name and inactive Qiniu definitions remain', async () => {
  await switchedToOfficial();
  const current = parse(fs.readFileSync(config, 'utf8'));
  current.model_provider = 'qnaigc';
  current.model_providers.qnaigc.base_url = 'https://other.example/v1';
  current.model_providers.old = { base_url: 'https://api.qnaigc.com/bypass/openai/v1' };
  const switched = stringify(current);
  fs.writeFileSync(config, switched);
  assert.equal(isExternallyModified(tool), true);
  assert.equal((await applyTool(tool, connection)).status, 'success');
  assert.equal((await removeTool(tool)).status, 'success');
  assert.equal(fs.readFileSync(config, 'utf8'), switched);
});

test('restore after an external official switch archives old records and leaves current login and settings untouched', async () => {
  const { official, officialAuth } = await switchedToOfficial();
  assert.equal((await removeTool(tool)).status, 'success');
  assert.equal(fs.readFileSync(config, 'utf8'), official);
  assert.equal(fs.readFileSync(auth, 'utf8'), officialAuth);
  assert.deepEqual(stateStore.getFileStates('codex'), []);
});

test('a still-active Qiniu route, invalid selector, missing file or unfinished write never loses the journal', async () => {
  await tool.loadConfig('dummy-key', connection.baseUrl, connection.models);
  const applied = fs.readFileSync(config, 'utf8');
  const journal = fs.readFileSync(stateFile, 'utf8');
  const values = [
    applied + '\n# external non-routing edit\n',
    'profile = "missing"\n' + applied,
    applied.replace('model_provider = "qnaigc"', 'model_provider = "missing"'),
    'not valid [toml',
    undefined,
  ];
  for (const content of values) {
    if (content === undefined) fs.rmSync(config); else fs.writeFileSync(config, content);
    assert.equal(isExternallyModified(tool), false);
    assert.throws(() => rebaselineTool(tool));
    assert.equal(fs.readFileSync(stateFile, 'utf8'), journal);
  }
  fs.writeFileSync(config, applied);
  await tool.unloadConfig();
  await switchedToOfficial();
  const [record] = stateStore.getFileStates('codex');
  record.state.priors.files[0].before = null;
  stateStore.setState('codex', record.state, record.file);
  const interrupted = fs.readFileSync(stateFile, 'utf8');
  assert.equal(isExternallyModified(tool), false);
  assert.throws(() => rebaselineTool(tool), /interrupted/);
  assert.equal(fs.readFileSync(stateFile, 'utf8'), interrupted);
});

test('a record from another Codex directory cannot be rebaselined using the current official selection', async () => {
  await switchedToOfficial();
  const foreign = path.join(home, 'foreign-codex/config.toml');
  const applied = 'model_provider="qnaigc"\n[model_providers.qnaigc]\nbase_url="https://api.qnaigc.com/v1"\n';
  fs.mkdirSync(path.dirname(foreign), { recursive: true });
  fs.writeFileSync(foreign, applied);
  stateStore.setState('codex', { priors: { files: [{ file: foreign, original: null, applied }] } }, foreign);
  const journal = fs.readFileSync(stateFile, 'utf8');
  assert.equal(isExternallyModified(tool), false);
  assert.throws(() => rebaselineTool(tool));
  assert.equal(fs.readFileSync(stateFile, 'utf8'), journal);
});

test('an OpenAI base URL override that still routes to Qiniu is not an official switch', async () => {
  await switchedToOfficial();
  const value = parse(fs.readFileSync(config, 'utf8'));
  value.openai_base_url = 'https://api.qnaigc.com/bypass/openai/v1';
  fs.writeFileSync(config, stringify(value));
  const journal = fs.readFileSync(stateFile, 'utf8');
  assert.equal(tool.isConfigured(), true);
  assert.equal(isExternallyModified(tool), false);
  assert.throws(() => rebaselineTool(tool), /still uses Qiniu/);
  assert.equal(fs.readFileSync(stateFile, 'utf8'), journal);
});

test('an unchanged custom endpoint keeps its original recovery record even if no longer recognized as Qiniu', async () => {
  await tool.loadConfig('dummy-custom', 'https://custom.example', connection.models);
  const journal = fs.readFileSync(stateFile, 'utf8');
  assert.equal(tool.isConfigured(), false);
  assert.equal(isExternallyModified(tool), false);
  assert.throws(() => rebaselineTool(tool), /still matches/);
  assert.equal(fs.readFileSync(stateFile, 'utf8'), journal);
});

test('archive failure preserves both the old restoration journal and current official files', async t => {
  const { official, officialAuth } = await switchedToOfficial();
  const journal = fs.readFileSync(stateFile, 'utf8');
  t.mock.method(fs, 'mkdtempSync', () => { throw new Error('archive unavailable'); });
  const result = await applyTool(tool, connection);
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'rebaseline_failed');
  assert.equal(fs.readFileSync(stateFile, 'utf8'), journal);
  assert.equal(fs.readFileSync(config, 'utf8'), official);
  assert.equal(fs.readFileSync(auth, 'utf8'), officialAuth);
});

test('a failed load after archiving can retry after official credentials change again', async () => {
  const { official, officialAuth } = await switchedToOfficial();
  fs.writeFileSync(auth, '{broken');
  assert.equal((await applyTool(tool, connection)).status, 'failed');
  assert.equal(fs.readFileSync(config, 'utf8'), official);
  const refreshed = officialAuth.replace('dummy-refreshed', 'dummy-retry');
  fs.writeFileSync(auth, refreshed);
  assert.equal(isExternallyModified(tool), true);
  assert.equal((await applyTool(tool, connection)).status, 'success');
  assert.equal((await removeTool(tool)).status, 'success');
  assert.equal(fs.readFileSync(config, 'utf8'), official);
  assert.equal(fs.readFileSync(auth, 'utf8'), refreshed);
});

test('Codex confirmation previews successfully after official login with an inactive Qiniu provider', { skip: process.platform === 'win32' }, async () => {
  const source = `import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {parse,stringify} from 'smol-toml';import {i18n} from './dist/lib/i18n.js';import {CodexTool} from './dist/lib/tools/codex-tool.js';import {confirmAndWrite} from './dist/lib/wizard/ui/write-plan.js';
i18n.init('en_US');const tool=new CodexTool(),dir=path.join(os.homedir(),'.codex'),file=path.join(dir,'config.toml');const models={codexModel:'openai/gpt-5.6-sol'};
await tool.loadConfig('dummy-old','https://api.qnaigc.com',models);const value=parse(fs.readFileSync(file,'utf8'));delete value.model_provider;value.forced_login_method='chatgpt';const official=stringify(value);fs.writeFileSync(file,official);const auth=path.join(dir,'auth.json'),officialAuth='{"auth_mode":"chatgpt","tokens":{"refresh_token":"dummy-official"}}';fs.writeFileSync(auth,officialAuth);
tool.checkModel=async()=>undefined;const results=await confirmAndWrite('CODEX_REBASE',[{tool,models,main:models.codexModel,changes:[{label:'Main model',after:models.codexModel}],connection:{apiKey:'dummy-new',baseUrl:'https://api.qnaigc.com',endpoint:'china'}}]);
console.log('RESULT',JSON.stringify(results.map(r=>r.status)));await tool.unloadConfig();console.log('RESTORED',fs.readFileSync(file,'utf8')===official&&fs.readFileSync(auth,'utf8')===officialAuth);`;
  const out = await runPrompt(source, [[/Restore baseline[\s\S]*?old record[\s\S]*?Esc back/, '\r']], 100, { rows: 40 });
  assert.match(out, /RESULT.*\["success"\]/);
  assert.match(out, /RESTORED true/);
  assert.doesNotMatch(out, /dummy-old|dummy-new|dummy-official|changed since loading/);
});
