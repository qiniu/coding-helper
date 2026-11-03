import assert from 'node:assert/strict'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import test from 'node:test';
import { isolateHome } from './helpers/isolated-home.mjs'; import { runPrompt } from './helpers/prompt-pty.mjs';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rebaseline-')); isolateHome(home); test.after(() => fs.rmSync(home, { recursive: true, force: true }));
const { ClaudeCodeTool } = await import('../dist/lib/tools/claude-code-tool.js');
const { stateStore } = await import('../dist/lib/core/state-store.js');
const { previewWrites, backupsRoot } = await import('../dist/lib/core/safe-write.js');
const { isExternallyModified, rebaselineTool, hasRestoreRecord } = await import('../dist/lib/core/rebaseline.js');
const tool = new ClaudeCodeTool();
const settings = path.join(home, '.claude', 'settings.json'), state = path.join(home, '.coding-helper', 'state.json');
const models = { claudeCode: { sonnetModel: 'vendor/main' } };
const original = '{\n  "permissions": { "allow": ["Bash(ls:*)"] },\n  "env": { "KEEP": "1" }\n}\n';
// 复现：接入七牛后，用户在外部把 Claude 改成 DeepSeek
async function switchedToDeepSeek() {
  for (const entry of stateStore.getRecordedTools()) stateStore.removeToolRecords(entry);
  fs.mkdirSync(path.dirname(settings), { recursive: true }); fs.writeFileSync(settings, original);
  await tool.loadConfig('sk-qiniu-old', 'https://api.qnaigc.com', models);
  const value = JSON.parse(fs.readFileSync(settings, 'utf8'));
  Object.assign(value.env, { ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic', ANTHROPIC_AUTH_TOKEN: 'sk-deepseek' });
  const deepseek = JSON.stringify(value, null, 2) + '\n'; fs.writeFileSync(settings, deepseek); return deepseek;
}

test('externally switched config is detected and blocks a normal load', async () => {
  await switchedToDeepSeek();
  assert.equal(hasRestoreRecord(tool), true); assert.equal(tool.isConfigured(), false); assert.equal(isExternallyModified(tool), true);
  await assert.rejects(tool.loadConfig('sk-qiniu-new', 'https://api.qnaigc.com', models), /changed/);
});

test('rebaseline preview writes nothing; commit archives the old record and restore returns to the current config', async () => {
  const deepseek = await switchedToDeepSeek(); const stateBefore = fs.readFileSync(state, 'utf8');
  const preview = await previewWrites(async () => { rebaselineTool(tool); await tool.loadConfig('sk-qiniu-new', 'https://api.qnaigc.com', models); });
  assert.ok(preview.changes.some(change => change.file.endsWith('settings.json')));
  assert.equal(fs.readFileSync(settings, 'utf8'), deepseek); assert.equal(fs.readFileSync(state, 'utf8'), stateBefore);
  const { backupDir } = rebaselineTool(tool);
  const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.tool, 'claude-code'); assert.ok(Object.keys(manifest.records).length >= 1);
  assert.ok(manifest.files.some(entry => entry.backup && fs.readFileSync(entry.backup, 'utf8') === deepseek));
  assert.ok(backupDir.startsWith(backupsRoot()));
  await tool.loadConfig('sk-qiniu-new', 'https://api.qnaigc.com', models);
  assert.equal(tool.isConfigured(), true); assert.equal(isExternallyModified(tool), false);
  await tool.unloadConfig(); assert.equal(fs.readFileSync(settings, 'utf8'), deepseek);
});

test('applyTool adopts the externally switched config automatically and restore returns to it', async () => {
  const { applyTool } = await import('../dist/lib/core/tool-service.js');
  const deepseek = await switchedToDeepSeek();
  const before = new Set(fs.existsSync(backupsRoot()) ? fs.readdirSync(backupsRoot()) : []);
  const result = await applyTool(tool, { apiKey: 'sk-qiniu-new', baseUrl: 'https://api.qnaigc.com', models });
  assert.equal(result.status, 'success'); assert.equal(tool.isConfigured(), true);
  assert.ok(fs.readdirSync(backupsRoot()).some(name => !before.has(name) && name.startsWith('rebaseline-claude-code-')));
  await tool.unloadConfig(); assert.equal(fs.readFileSync(settings, 'utf8'), deepseek);
});

test('rebaseline refuses while the config still uses Qiniu and keeps the record', async () => {
  for (const entry of stateStore.getRecordedTools()) stateStore.removeToolRecords(entry);
  fs.writeFileSync(settings, original); await tool.loadConfig('sk-qiniu', 'https://api.qnaigc.com', models);
  const before = fs.readFileSync(state, 'utf8');
  assert.throws(() => rebaselineTool(tool), /still uses Qiniu/); assert.equal(fs.readFileSync(state, 'utf8'), before);
  await tool.unloadConfig(); assert.equal(fs.readFileSync(settings, 'utf8'), original);
});

test('real PTY confirm page shows the baseline row and writes directly after confirmation', { skip: process.platform === 'win32' }, async () => {
  const source = `import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {i18n} from './dist/lib/i18n.js';import {ClaudeCodeTool} from './dist/lib/tools/claude-code-tool.js';import {confirmAndWrite} from './dist/lib/wizard/ui/write-plan.js';i18n.init('en_US');
const tool=new ClaudeCodeTool(),file=path.join(os.homedir(),'.claude','settings.json'),models={claudeCode:{sonnetModel:'vendor/main'}};fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'{}\\n');
await tool.loadConfig('sk-old','https://api.qnaigc.com',models);const value=JSON.parse(fs.readFileSync(file,'utf8'));value.env.ANTHROPIC_BASE_URL='https://api.deepseek.com/anthropic';value.env.ANTHROPIC_AUTH_TOKEN='sk-deepseek';const deepseek=JSON.stringify(value,null,2)+'\\n';fs.writeFileSync(file,deepseek);
const results=await confirmAndWrite('REBASE_READY',[{tool,models,main:'vendor/main',changes:[{label:'Main model',after:'vendor/main'}],connection:{apiKey:'sk-new',baseUrl:'https://api.qnaigc.com',endpoint:'china'}}]);
console.log('RESULT',JSON.stringify(results.map(r=>r.status)));console.log('QINIU',tool.isConfigured());await tool.unloadConfig();console.log('RESTORED',fs.readFileSync(file,'utf8')===deepseek);`;
  // 不需要额外选择：确认页直接列出「还原基线」，写入时自动备份并接入
  const out = await runPrompt(source, [[/Restore baseline[\s\S]*?old record[\s\S]*?Esc back/, '\x1b[A\x1b[A\r']], 100, { rows: 40 });
  assert.match(out, /RESULT.*\["success"\]/); assert.match(out, /QINIU true/); assert.match(out, /RESTORED true/); assert.doesNotMatch(out, /sk-deepseek|sk-old|sk-new/);
});

test('a config that still holds the helper-written endpoint is not treated as an external edit', async () => {
  for (const entry of stateStore.getRecordedTools()) stateStore.removeToolRecords(entry);
  fs.writeFileSync(settings, original); await tool.loadConfig('sk-qiniu', 'https://api.qnaigc.com', models);
  // 例如线路切换后不再识别旧的自定义地址：文件没被外部改过，不能丢弃原始还原记录
  const shadow = Object.create(tool); shadow.isConfigured = () => false;
  const before = fs.readFileSync(state, 'utf8');
  assert.equal(isExternallyModified(shadow), false);
  assert.throws(() => rebaselineTool(shadow), /still matches/); assert.equal(fs.readFileSync(state, 'utf8'), before);
  await tool.unloadConfig(); assert.equal(fs.readFileSync(settings, 'utf8'), original);
});

test('generic transactions: interrupted writes and records in another directory block rebaselining', () => {
  for (const entry of stateStore.getRecordedTools()) stateStore.removeToolRecords(entry);
  const fake = { name: 'fake-tx', displayName: 'Fake', isConfigured: () => false };
  const dirA = path.join(home, 'fake-a'), dirB = path.join(home, 'fake-b'); fs.mkdirSync(dirA, { recursive: true }); fs.mkdirSync(dirB, { recursive: true });
  const fileA = path.join(dirA, '.env'), fileB = path.join(dirB, '.env');
  const applied = 'BASE_URL=https://api.qnaigc.com/v1\n';
  fs.writeFileSync(fileA, 'BASE_URL=https://api.deepseek.com\n');
  const record = extra => ({ priors: { files: [{ file: fileA, original: null, applied, ...extra }] } });
  stateStore.setState(fake.name, record({ before: null }), fileA);
  assert.equal(isExternallyModified(fake), false, 'unfinished transaction must be recovered first');
  stateStore.setState(fake.name, record({}), fileA);
  assert.equal(isExternallyModified(fake), true);
  // 另一个目录的记录仍是助手写入的配置：不能一起丢弃
  fs.writeFileSync(fileB, applied);
  stateStore.setState(fake.name, { priors: { files: [{ file: fileB, original: null, applied }] } }, fileB);
  assert.equal(isExternallyModified(fake), false);
  assert.throws(() => rebaselineTool(fake), /still matches/);
  assert.equal(stateStore.getFileStates(fake.name).length, 2);
  stateStore.removeToolRecords(fake.name);
});

test('a legacy record with an externally switched config is archived and the write goes through', async () => {
  const { applyTool } = await import('../dist/lib/core/tool-service.js');
  for (const entry of stateStore.getRecordedTools()) stateStore.removeToolRecords(entry);
  const deepseek = '{\n  "env": {\n    "ANTHROPIC_BASE_URL": "https://api.deepseek.com/anthropic",\n    "ANTHROPIC_AUTH_TOKEN": "sk-deepseek"\n  }\n}\n';
  fs.writeFileSync(settings, deepseek);
  // 旧版按工具名保存、只有字段原值的记录
  stateStore.setState('claude-code', { priors: { 'env.ANTHROPIC_BASE_URL': null, 'env.ANTHROPIC_AUTH_TOKEN': null } });
  assert.equal(isExternallyModified(tool), true);
  stateStore.setState('claude-code', { priors: { 'env.ANTHROPIC_BASE_URL': null }, pending: { before: null, after: '', applied: {} } });
  assert.equal(isExternallyModified(tool), false, 'interrupted legacy write must be recovered first');
  stateStore.setState('claude-code', { priors: { 'env.ANTHROPIC_BASE_URL': null, 'env.ANTHROPIC_AUTH_TOKEN': null } });
  const result = await applyTool(tool, { apiKey: 'sk-qiniu-new', baseUrl: 'https://api.qnaigc.com', models });
  assert.equal(result.status, 'success'); assert.equal(stateStore.getState('claude-code'), undefined);
  const archive = fs.readdirSync(backupsRoot()).filter(name => name.startsWith('rebaseline-claude-code-')).map(name => path.join(backupsRoot(), name, 'manifest.json'))
    .map(file => JSON.parse(fs.readFileSync(file, 'utf8'))).find(manifest => Object.hasOwn(manifest.records, 'claude-code'));
  assert.ok(archive, 'legacy record must be archived');
  await tool.unloadConfig(); assert.equal(fs.readFileSync(settings, 'utf8'), deepseek);
});
