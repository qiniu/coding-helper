import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const homes = [];
const preferredProbes = [];
const server = http.createServer(async (req, res) => {
  const region = req.url.split('/')[1];
  const route = req.url.split('?')[0].replace(/^\/(cn|intl)/, '');
  const key = req.headers.authorization?.replace('Bearer ', '');
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const valid = region === 'intl' ? key === 'sk-intl' : ['sk-cn','sk-billing','qiniu-key','sk-preferred'].includes(key);
  if (!valid) return send(401, { error: { code: 'invalid_key' } });
  if (route === '/v2/stat/usage') return send(200, {});
  if (route === '/v1/models') return send(200, { data: (key === 'sk-preferred' ? ['qwen-turbo', 'vendor/chat'] : ['vendor/chat', 'vendor/vision']).map(id => ({ id })) });
  if (route === '/v1/market/models') return send(200, { status: true, data: ['vendor/chat','vendor/vision'].map(id => ({
    id, features: id.endsWith('chat') ? ['工具调用'] : [], architecture: { input_modalities: ['text'], function_calling: { supported: false }, reasoning: { supported: false } }, model_constraints: { context_length: 128000, max_tokens: 8192 },
  })) });
  if (route === '/v1/chat/completions') {
    if (key === 'sk-preferred') {
      let body = ''; for await (const chunk of req) body += chunk;
      const model = JSON.parse(body).model;
      preferredProbes.push(model);
      if (model === 'qwen-turbo') return send(502, { error: { type: 'upstream_error', message: 'Model has been retired' } });
    }
    return key === 'sk-billing' ? send(403, { error: { code: 'account_billing_suspended' } }) : send(200, { choices: [] });
  }
  if (route === '/bypass/openai/v1/responses') {
    let body = ''; for await (const chunk of req) body += chunk;
    const model = JSON.parse(body).model;
    assert.equal(JSON.parse(body).max_output_tokens, 16);
    if (!model.startsWith('openai/gpt')) return send(400, {});
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    return res.end('data: {"type":"response.created"}\n\ndata: {"type":"response.completed"}\n\n');
  }
  send(404, {});
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); for (const home of homes) fs.rmSync(home, { recursive: true, force: true }); });
export async function runQuick(args, extraEnv = {}, seed) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-command-')); homes.push(home);
  fs.mkdirSync(path.join(home, '.coding-helper'));
  const helper = path.join(home, '.coding-helper/config.yaml');
  const before = 'lang: en_US\nendpoint: china\napi_key: old-key\n';
  fs.writeFileSync(helper, before);
  const preload = seed?.(home);
  const env = { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config'), PATH: '/usr/bin:/bin',
    CODING_HELPER_BASE_URL_CHINA: `${base}/cn`, CODING_HELPER_BASE_URL_INTERNATIONAL: `${base}/intl`, ...extraEnv };
  try {
    const result = await execute(process.execPath, [...(preload ? ['--require', preload] : []), path.resolve('dist/cli.js'), ...args], { env, timeout: 15000 });
    return { ...result, code: 0, home, helper, before };
  } catch (error) { return { stdout: error.stdout, stderr: error.stderr, code: error.code, home, helper, before }; }
}
test('quick CLI configures a single tool and commits helper settings after success', async () => {
  const result = await runQuick(['opencode', 'sk-cn', '--json']);
  assert.equal(result.code, 0, result.stderr + result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.model, 'vendor/chat');
  assert.equal(output.keySource, 'argument');
  assert.equal(output.results[0].status, 'success');
  const config = JSON.parse(fs.readFileSync(path.join(result.home, '.config/opencode/opencode.json'), 'utf8'));
  assert.equal(config.provider.qiniu.options.apiKey, 'sk-cn');
  assert.match(fs.readFileSync(result.helper, 'utf8'), /api_key: sk-cn/);
  assert.equal(result.stdout.includes('sk-cn'), false);
});
test('rejected key, model or account never changes helper settings or client files', async () => {
  for (const args of [['opencode','sk-invalid'], ['opencode','sk-cn','missing-model'], ['opencode','sk-cn','vendor/vision'], ['opencode','sk-billing']]) {
    const result = await runQuick([...args, '--json']);
    assert.equal(result.code, 1, JSON.stringify(args));
    assert.equal(fs.readFileSync(result.helper, 'utf8'), result.before);
    assert.equal(fs.existsSync(path.join(result.home, '.config')), false);
  }
});
test('endpoint fallback, environment key and omitted vendor prefix work through the CLI', async () => {
  const result = await runQuick(['opencode','sk-intl','chat','--json']);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).endpoint, 'international');
  assert.equal(JSON.parse(result.stdout).model, 'vendor/chat');
  const env = await runQuick(['opencode','--json'], { QINIU_API_KEY: 'sk-cn' });
  assert.equal(env.code, 0, env.stdout);
  assert.equal(JSON.parse(env.stdout).keySource, 'env');
});
test('Codex probes its default Responses model and rejects incompatible explicit models', async () => {
  const success = await runQuick(['codex','sk-cn','--json']);
  assert.equal(success.code, 0, success.stdout + success.stderr);
  assert.match(JSON.parse(success.stdout).model, /^openai\/gpt/);
  const failure = await runQuick(['codex','sk-cn','vendor/chat','--json']);
  assert.equal(failure.code, 1);
  assert.equal(fs.readFileSync(failure.helper, 'utf8'), failure.before);
  assert.equal(fs.existsSync(path.join(failure.home, '.codex')), false);
});
test('Responses probe rejects untyped, failed or incomplete streams', async () => {
  const { isCodexCompatibleStream } = await import('../dist/lib/tools/codex-tool.js');
  assert.equal(isCodexCompatibleStream('data: {"type":"response.completed"}\n\n'), true);
  assert.equal(isCodexCompatibleStream('data: {"type":"response.incomplete","response":{"incomplete_details":{"reason":"max_output_tokens"}}}\n\n'), true);
  for (const text of ['data: {}\n\n','data: {"type":"response.created"}\n\n', 'data: {"type":"response.failed"}\n\n']) assert.equal(isCodexCompatibleStream(text), false);
});

test('multi-tool quick setup merges model mappings and deduplicates aliases', async () => {
  const result = await runQuick(['claude,claude-code,opencode,qwen-code','sk-cn','vendor/chat','--json']);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.results.length, 3);
  assert.ok(output.results.every(result => result.status === 'success'));
  const settings = fs.readFileSync(result.helper, 'utf8');
  assert.match(settings, /opencode: vendor\/chat/);
  assert.match(settings, /qwen-code: vendor\/chat/);
});
test('an incompatible tool is skipped while compatible tools in the same request succeed', async () => {
  const result = await runQuick(['codex,opencode','sk-cn','vendor/chat','--json']);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).results.map(result => result.status), ['skipped','success']);
  assert.equal(fs.existsSync(path.join(result.home,'.codex')), false);
});
test('partial write failures return 2 and save models only for successful clients', async () => {
  const result = await runQuick(['codex,opencode','sk-cn','--json'], {}, home => {
    fs.mkdirSync(path.join(home,'.config/opencode'), {recursive:true});
    fs.writeFileSync(path.join(home,'.config/opencode/opencode.json'), '{broken-old-secret');
  });
  assert.equal(result.code, 2, result.stdout + result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).results.map(result => result.status), ['success','failed']);
  assert.match(fs.readFileSync(result.helper,'utf8'), /codexModel:/);
  assert.doesNotMatch(fs.readFileSync(result.helper,'utf8'), /opencode:/);
  assert.equal(result.stdout.includes('broken-old-secret'), false);
});
test('no-save keeps helper settings unchanged while retaining client restoration journals', async () => {
  const result = await runQuick(['opencode','sk-cn','--no-save','--json']);
  assert.equal(result.code, 0, result.stdout);
  assert.equal(JSON.parse(result.stdout).helperSaved, false);
  assert.equal(fs.readFileSync(result.helper,'utf8'), result.before);
  assert.ok(fs.existsSync(path.join(result.home,'.coding-helper/state.json')));
  assert.ok(fs.existsSync(path.join(result.home,'.config/opencode/opencode.json')));
});
test('quick dry-run previews multiple clients without persisting keys, files or journals', async () => {
  const result = await runQuick(['codex,opencode','sk-cn','--dry-run','--json']);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.dryRun, true);
  assert.ok(output.changes.length >= 4);
  assert.equal(fs.readFileSync(result.helper,'utf8'), result.before);
  assert.equal(fs.existsSync(path.join(result.home,'.codex')), false);
  assert.equal(fs.existsSync(path.join(result.home,'.config')), false);
  assert.deepEqual(fs.readdirSync(path.dirname(result.helper)), ['config.yaml']);
  assert.equal(result.stdout.includes('sk-cn'), false);
});
test('all selects only detected CLI tools and does not execute installed host clients', async () => {
  const result = await runQuick(['all','sk-cn','--no-save','--json'], {}, home => {
    const dir = path.join(home,'.local/bin'); fs.mkdirSync(dir,{recursive:true});
    for (const name of ['opencode','opencode.cmd','qwen','qwen.cmd']) fs.writeFileSync(path.join(dir,name),'fixture',{mode:0o700});
    const preload = path.join(home,'host-isolation.cjs');
    fs.writeFileSync(preload, "const fs=require('node:fs'),stat=fs.statSync;fs.statSync=function(file,...args){if(/^\\/(opt\\/homebrew|usr\\/local)\\/bin\\//.test(String(file))){const e=Error('absent');e.code='ENOENT';throw e;}return stat.call(this,file,...args);};require('node:child_process').spawnSync=()=>({status:0,stdout:'1.2.3',stderr:''});\n");
    return preload;
  });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).results.map(result => result.tool).sort(), ['opencode','qwen-code']);
  assert.equal(fs.readFileSync(result.helper,'utf8'), result.before);
});

test('explicit non-sk keys override saved credentials and select the requested model', async () => {
  const result=await runQuick(['opencode','--key','qiniu-key','--model','vendor/chat','--json']);
  assert.equal(result.code,0,result.stdout+result.stderr);
  assert.equal(JSON.parse(result.stdout).keySource,'argument');
  const config=JSON.parse(fs.readFileSync(path.join(result.home,'.config/opencode/opencode.json'),'utf8'));
  assert.equal(config.provider.qiniu.options.apiKey,'qiniu-key');
});

test('quick JSON handles corrupt helper configuration without exposing its contents', async () => {
  const result=await runQuick(['opencode','--key','qiniu-key','--model','vendor/chat','--json'],{},home=>{
    fs.writeFileSync(path.join(home,'.coding-helper/config.yaml'),'api_key: [private-sentinel');
  });
  assert.equal(result.code,1);
  assert.equal(JSON.parse(result.stdout).error,'quick_configuration_failed');
  assert.equal(result.stdout.includes('private-sentinel'),false);
});

test('helper-save failure reports the committed client and preserves a complete restore path', () => {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'quick-save-failure-'));homes.push(home);
  const helper=path.join(home,'.coding-helper/config.yaml');const client=path.join(home,'.config/opencode/opencode.json');
  fs.mkdirSync(path.dirname(helper),{recursive:true});fs.mkdirSync(path.dirname(client),{recursive:true});
  const helperBefore='lang: en_US\napi_key: old-key\n';const clientBefore='{"model":"other/model"}\n';
  fs.writeFileSync(helper,helperBefore);fs.writeFileSync(client,clientBefore);
  const preload=path.join(home,'mock.cjs');
  fs.writeFileSync(preload,`const fs=require('node:fs'),path=require('node:path'),rename=fs.renameSync;fs.renameSync=function(from,to){if(path.resolve(to)===path.resolve(${JSON.stringify(helper)})){const error=Error('helper denied');error.code='EACCES';throw error;}return rename.call(this,from,to);};require('node:child_process').spawnSync=()=>({status:0,stdout:'1.2.3',stderr:''});globalThis.fetch=async url=>new Response(JSON.stringify(String(url).endsWith('/v1/models')?{data:[{id:'model'}]}:{}));\n`);
  const env={HOME:home,USERPROFILE:home,XDG_CONFIG_HOME:path.join(home,'.config'),PATH:'/usr/bin:/bin'};
  let failure;
  try {execFileSync(process.execPath,['--require',preload,path.resolve('dist/cli.js'),'opencode','--key','custom-key','--model','model','--json'],{env,encoding:'utf8',stdio:'pipe',timeout:10000});assert.fail('must fail');}
  catch(error){failure=error;}
  assert.equal(failure.status,1);
  const report=JSON.parse(failure.stdout);
  assert.equal(report.error,'helper_settings_failed');assert.equal(report.helperSaved,false);assert.equal(report.results[0].status,'success');
  assert.equal(fs.readFileSync(helper,'utf8'),helperBefore);
  assert.equal(JSON.parse(fs.readFileSync(client,'utf8')).provider.qiniu.options.apiKey,'custom-key');
  execFileSync(process.execPath,['--require',preload,path.resolve('dist/cli.js'),'restore','opencode','--yes'],{env,encoding:'utf8',stdio:'pipe',timeout:10000});
  assert.equal(fs.readFileSync(client,'utf8'),clientBefore);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home,'.coding-helper/state.json'),'utf8')).tools,{});
});

test('quick account checks use the resolved requested or saved model', async () => {
  for (const args of [['chat'], []]) {
    const before = preferredProbes.length;
    const result = await runQuick(['opencode', 'sk-preferred', ...args, '--dry-run', '--json'], {}, home => {
      fs.appendFileSync(path.join(home, '.coding-helper/config.yaml'), 'toolModels:\n  opencode: vendor/chat\n');
    });
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).model, 'vendor/chat');
    assert.deepEqual(preferredProbes.slice(before), ['vendor/chat']);
  }
});

test('context CLI is scoped to selected tools and only persists after success', async () => {
  const result = await runQuick(['opencode', 'sk-cn', '--context', '64k', '--json']);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const config = JSON.parse(fs.readFileSync(path.join(result.home, '.config/opencode/opencode.json'), 'utf8'));
  assert.equal(config.provider.qiniu.models['vendor/chat'].limit.context, 64000);
  assert.match(fs.readFileSync(result.helper, 'utf8'), /opencode: 64000/);
  for (const args of [['--model', 'missing'], ['--dry-run'], ['--context', 'invalid']]) {
    const r = await runQuick(['opencode', 'sk-cn', '--context', '64k', '--json', ...args]);
    assert.equal(fs.readFileSync(r.helper, 'utf8'), r.before);
  }
});

test('invalid context returns a specific error with usable examples before writing files',async()=>{
 for(const json of [true,false]){
  const result=await runQuick(['opencode','sk-cn','--context','invalid',...(json?['--json']:[])]);
  assert.equal(result.code,1);assert.equal(fs.readFileSync(result.helper,'utf8'),result.before);
  assert.equal(fs.existsSync(path.join(result.home,'.config')),false);
  if(json){const report=JSON.parse(result.stdout);assert.equal(report.error,'context_invalid');assert.deepEqual(report.suggestions,['96k','200000','auto']);}
  else assert.match(result.stdout+result.stderr,/96k.*200000/);
 }
});
