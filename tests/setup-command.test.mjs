import { isolateHome } from './helpers/isolated-home.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-setup-'));
isolateHome(home);
const { setupCommand } = await import('../dist/commands/setup.js');
const { configManager } = await import('../dist/lib/config.js');
const { toolManager } = await import('../dist/lib/tool-manager.js');
const { logger } = await import('../dist/utils/logger.js');
const oldFetch = globalThis.fetch;
const oldLog = console.log;
const oldExit = process.exitCode;
test.after(() => { globalThis.fetch = oldFetch; console.log = oldLog; process.exitCode = oldExit; fs.rmSync(home, { recursive: true, force: true }); });
globalThis.fetch = async url => new Response(JSON.stringify(url.endsWith('/v1/models') ? { data: [{ id: 'model' }] } : { choices: [] }));
configManager.setApiKey('sk-setup-test');
async function run(options) {
  const output = [];
  console.log = text => output.push(text);
  try { await setupCommand({ json: true, ...options }); }
  finally { console.log = oldLog; }
  assert.equal(output.length, 1, 'exactly one JSON document');
  return JSON.parse(output[0]);
}
test('batch setup passes explicit connection, deduplicates aliases and suppresses adapter logs', async () => {
  let calls = 0;
  toolManager.register({ name: 'setup-test', displayName: 'Setup', aliases: ['setup-alias'], async loadConfig(key, baseUrl) {
    calls++; assert.equal(key, 'sk-setup-test'); assert.equal(baseUrl, configManager.baseUrl); logger.warn('adapter diagnostic');
  } });
  const result = await run({ tools: 'setup-test,setup-alias' });
  assert.equal(calls, 1);
  assert.deepEqual(result.results, [{ tool: 'setup-test', status: 'success' }]);
  assert.equal(result.exitCode, 0);
});
test('unknown tools are rejected before any writer and missing models are skipped', async () => {
  const result = await run({ tools: 'setup-test,unknown' });
  assert.equal(result.exitCode, 1);
  toolManager.register({ name: 'needs-model', requiresModelSelection: true, loadConfig() { assert.fail(); } });
  const skipped = await run({ tools: 'needs-model,copilot' });
  assert.ok(skipped.results.every(result => result.status === 'skipped'));
});
test('batch failures return partial status without embedding error contents in JSON', async () => {
  toolManager.register({ name: 'setup-fails', loadConfig() { throw new Error('old-secret-from-config'); } });
  const result = await run({ tools: 'setup-test,setup-fails' });
  assert.equal(result.exitCode, 2);
  assert.equal(JSON.stringify(result).includes('old-secret-from-config'), false);
});

test('stdin key is persisted only after a successful client write', () => {
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-stdin-'));
  try {
    fs.mkdirSync(path.join(isolated, '.coding-helper'));
    const file = path.join(isolated, '.coding-helper/config.yaml');
    const before = 'lang: en_US\napi_key: sk-original\n';
    fs.writeFileSync(file, before);
    const preload = path.join(isolated, 'mock.cjs');
    fs.writeFileSync(preload, "globalThis.fetch = async url => new Response(JSON.stringify(url.endsWith('/v1/models') ? {data:[{id:'model'}]} : {choices:[]}));\n");
    const run = tool => JSON.parse(execFileSync(process.execPath, ['--require', preload, path.resolve('dist/cli.js'), 'setup', '--tools', tool, '--key-stdin', '--json'], {
      env: { HOME: isolated, USERPROFILE: isolated, PATH: '/usr/bin:/bin' }, input: 'sk-new\n', encoding: 'utf8', timeout: 10000,
    }));
    assert.equal(run('opencode').results[0].status, 'skipped');
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.equal(run('codex').results[0].status, 'success');
    assert.match(fs.readFileSync(file, 'utf8'), /api_key: sk-new/);
  } finally { fs.rmSync(isolated, { recursive: true, force: true }); }
});

test('malformed helper settings fail closed instead of being replaced', () => {
  const before = fs.readFileSync(configManager.configFile, 'utf8');
  fs.writeFileSync(configManager.configFile, 'api_key: [');
  try {
    assert.throws(() => configManager.reload(), /Cannot parse helper configuration/);
    assert.equal(fs.readFileSync(configManager.configFile, 'utf8'), 'api_key: [');
  } finally { fs.writeFileSync(configManager.configFile, before); configManager.reload(); }
});

test('CLI dry-run with a replacement stdin key preserves every user file and omits old credentials', () => {
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-preview-cli-'));
  try {
    fs.mkdirSync(path.join(isolated, '.coding-helper'));
    fs.mkdirSync(path.join(isolated, '.config/opencode'), { recursive: true });
    const helper = path.join(isolated, '.coding-helper/config.yaml');
    const client = path.join(isolated, '.config/opencode/opencode.json');
    const helperBefore = 'lang: en_US\napi_key: old-helper-secret\ndefaultModel: model\n';
    const clientBefore = '{"provider":{"other":{"options":{"apiKey":"old-client-secret"}}}}';
    fs.writeFileSync(helper, helperBefore); fs.writeFileSync(client, clientBefore);
    const preload = path.join(isolated, 'mock.cjs');
    fs.writeFileSync(preload, "require('node:child_process').spawnSync=()=>({status:0,stdout:'1.2.3',stderr:''});globalThis.fetch=async url=>new Response(JSON.stringify(url.endsWith('/v1/models')?{data:[{id:'model'}]}:{choices:[]}));\n");
    const text = execFileSync(process.execPath, ['--require', preload, path.resolve('dist/cli.js'), 'setup', '--tools', 'opencode', '--key-stdin', '--dry-run', '--json'], {
      env: { HOME: isolated, USERPROFILE: isolated, XDG_CONFIG_HOME: path.join(isolated,'.config'), PATH: '/usr/bin:/bin' }, input: 'sk-replacement\n', encoding: 'utf8', timeout: 10000,
    });
    const output = JSON.parse(text);
    assert.equal(output.dryRun, true);
    assert.equal(output.results[0].status, 'success');
    assert.equal(output.changes[0].operation, 'modify');
    for (const secret of ['old-helper-secret','old-client-secret','sk-replacement']) assert.equal(text.includes(secret), false);
    assert.equal(fs.readFileSync(helper,'utf8'), helperBefore);
    assert.equal(fs.readFileSync(client,'utf8'), clientBefore);
    assert.deepEqual(fs.readdirSync(path.dirname(helper)), ['config.yaml']);
    assert.deepEqual(fs.readdirSync(path.dirname(client)), ['opencode.json']);
  } finally { fs.rmSync(isolated,{recursive:true,force:true}); }
});

test('setup JSON remains machine-readable when helper configuration is corrupt', () => {
  const isolated=fs.mkdtempSync(path.join(os.tmpdir(),'setup-corrupt-json-'));
  try {
    fs.mkdirSync(path.join(isolated,'.coding-helper'));
    const file=path.join(isolated,'.coding-helper/config.yaml');fs.writeFileSync(file,'api_key: [private-sentinel');
    let result;
    try { execFileSync(process.execPath,[path.resolve('dist/cli.js'),'setup','--tools','codex','--json'],{env:{HOME:isolated,USERPROFILE:isolated,PATH:'/usr/bin:/bin'},encoding:'utf8',stdio:'pipe'});assert.fail('must fail'); }
    catch(error){result=error;}
    assert.equal(result.status,1);
    assert.deepEqual(JSON.parse(result.stdout),{error:'setup_failed',exitCode:1});
    assert.equal(fs.readFileSync(file,'utf8'),'api_key: [private-sentinel');
  } finally {fs.rmSync(isolated,{recursive:true,force:true});}
});

test('setup probes the selected tool model before stale models in the server list', async () => {
  const previous = fs.readFileSync(configManager.configFile, 'utf8');
  const fetch = globalThis.fetch;
  const probed = [];
  configManager.setModels({ toolModels: { 'account-probe-test': 'vendor/configured' } });
  toolManager.register({ name: 'account-probe-test', async loadConfig() {} });
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/v1/models')) return new Response(JSON.stringify({ data: [{ id: 'qwen-turbo' }, { id: 'vendor/configured' }] }));
    probed.push(JSON.parse(options.body).model);
    return new Response(JSON.stringify({ choices: [] }));
  };
  try {
    const report = await run({ tools: 'account-probe-test' });
    assert.deepEqual(report.account, { usable: true });
    assert.deepEqual(probed, ['vendor/configured']);
    assert.equal(report.exitCode, 0);
  } finally {
    globalThis.fetch = fetch;
    fs.writeFileSync(configManager.configFile, previous);
    configManager.reload();
  }
});
