import { isolateHome } from './helpers/isolated-home.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-command-'));
isolateHome(home);
const { CodexTool } = await import('../dist/lib/tools/codex-tool.js');
const { stateStore } = await import('../dist/lib/core/state-store.js');
const { getRestoreTargets } = await import('../dist/lib/core/tool-service.js');
const configFile = path.join(home, '.codex/config.toml');
const stateFile = path.join(home, '.coding-helper/state.json');
const original = '# user configuration\nmodel = "company"\n';
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
function reset() {
  for (const entry of fs.readdirSync(home)) fs.rmSync(path.join(home, entry), { recursive: true, force: true });
  write(path.join(home, '.coding-helper/config.yaml'), 'lang: en_US\n');
}
async function loadCodex() {
  write(configFile, original);
  await new CodexTool().loadConfig('sk-local-test', 'https://api.qnaigc.com', {});
}
function cli(...args) {
  try {
    return { code: 0, stdout: execFileSync(process.execPath, [path.resolve('dist/cli.js'), 'restore', ...args], {
      env: { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config'), PATH: '/usr/bin:/bin' },
      encoding: 'utf8', stdio: 'pipe', timeout: 15000,
    }) };
  } catch (error) { return { code: error.status, stdout: error.stdout, stderr: error.stderr }; }
}

test('restore selection understands file identities and legacy records without rewriting them', () => {
  reset();
  stateStore.setState('codex', { priors: { files: [] } }, configFile);
  stateStore.setState('claude-code', { priors: {} });
  const before = fs.readFileSync(stateFile, 'utf8');
  const tools = ['codex', 'claude-code', 'copilot', 'foreign', 'legacy'].map(name => ({
    name, launchOnly: name === 'copilot', isConfigured: () => name === 'legacy',
  }));
  assert.deepEqual(stateStore.getRecordedTools().sort(), ['claude-code', 'codex']);
  assert.deepEqual(getRestoreTargets(tools).map(tool => tool.name), ['codex', 'claude-code', 'legacy']);
  assert.equal(fs.readFileSync(stateFile, 'utf8'), before);
});

test('CLI accepts aliases and restores originals without a current API key', async () => {
  reset();
  await loadCodex();
  const result = cli('codex,openai-codex', '--yes');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(fs.readFileSync(configFile, 'utf8'), original);
  assert.equal(fs.existsSync(path.join(home, '.codex/auth.json')), false);
  assert.deepEqual(stateStore.getRecordedTools(), []);
});

test('default restore selects journals and preserves unrelated foreign configurations', async () => {
  reset();
  await loadCodex();
  const file = path.join(home, '.claude/settings.json');
  const foreign = '{"env":{"ANTHROPIC_BASE_URL":"https://company.example"}}\n';
  write(file, foreign);
  assert.equal(cli('--yes').code, 0);
  assert.equal(fs.readFileSync(configFile, 'utf8'), original);
  assert.equal(fs.readFileSync(file, 'utf8'), foreign);
});

test('unknown names are rejected before any earlier tool in the list is restored', async () => {
  reset();
  await loadCodex();
  const before = fs.readFileSync(configFile, 'utf8');
  const journal = fs.readFileSync(stateFile, 'utf8');
  const result = cli('codex,not-a-tool', '--yes');
  assert.equal(result.code, 1);
  assert.equal(fs.readFileSync(configFile, 'utf8'), before);
  assert.equal(fs.readFileSync(stateFile, 'utf8'), journal);
});

test('non-interactive restore requires explicit confirmation and performs no writes', async () => {
  reset();
  await loadCodex();
  const before = fs.readFileSync(configFile, 'utf8');
  const journal = fs.readFileSync(stateFile, 'utf8');
  const result = cli('codex');
  assert.equal(result.code, 1);
  assert.match(result.stdout + result.stderr, /--yes/);
  assert.equal(fs.readFileSync(configFile, 'utf8'), before);
  assert.equal(fs.readFileSync(stateFile, 'utf8'), journal);
});

test('conflicts preserve edited files and restoration journals', async () => {
  reset();
  await loadCodex();
  const edited = fs.readFileSync(configFile, 'utf8') + '# external edit\n';
  fs.writeFileSync(configFile, edited);
  const journal = fs.readFileSync(stateFile, 'utf8');
  const result = cli('codex', '--yes');
  assert.equal(result.code, 1);
  assert.match(result.stdout + result.stderr, /changed since loading/);
  assert.equal(fs.readFileSync(configFile, 'utf8'), edited);
  assert.equal(fs.readFileSync(stateFile, 'utf8'), journal);
});

test('mixed restoration results return partial failure and leave unrecorded legacy credentials untouched', async () => {
  reset();
  await loadCodex();
  const file = path.join(home, '.claude/settings.json');
  const legacy = '{"env":{"ANTHROPIC_BASE_URL":"https://api.qnaigc.com","ANTHROPIC_AUTH_TOKEN":"sk-legacy"}}';
  write(file, legacy);
  const result = cli('--yes');
  assert.equal(result.code, 2);
  assert.equal(fs.readFileSync(configFile, 'utf8'), original);
  assert.equal(fs.readFileSync(file, 'utf8'), legacy);
  assert.match(result.stdout + result.stderr, /No restoration record/);
});

test('corrupt journals stop automatic restoration before any client file changes', async () => {
  reset();
  await loadCodex();
  const before = fs.readFileSync(configFile, 'utf8');
  write(stateFile, '{broken');
  assert.equal(cli('--yes').code, 1);
  assert.equal(fs.readFileSync(configFile, 'utf8'), before);
  assert.equal(fs.readFileSync(stateFile, 'utf8'), '{broken');
});

test('recorded tools remain targets after their configuration path changes', () => {
  reset();
  const oldFile = path.join(home, 'old-openclaw/openclaw.json');
  write(oldFile, '{}');
  stateStore.setState('openclaw', { priors: {} }, oldFile);
  const before = fs.readFileSync(stateFile, 'utf8');
  const result = cli('--yes');
  assert.equal(result.code, 1);
  assert.match(result.stdout + result.stderr, /configuration path changed/);
  assert.equal(fs.readFileSync(stateFile, 'utf8'), before);
  assert.equal(fs.readFileSync(oldFile, 'utf8'), '{}');
});

test('no-op restore does not create helper directories or state files', () => {
  reset();
  fs.rmSync(path.join(home, '.coding-helper'), { recursive: true, force: true });
  assert.equal(cli('--yes').code, 0);
  assert.deepEqual(fs.readdirSync(home), []);
});

for (const confirmed of [false, true]) {
  test(`real terminal ${confirmed ? 'confirms' : 'cancels'} restoration`, { skip: process.platform === 'win32', timeout: 15000 }, async t => {
    reset();
    await loadCodex();
    const before = fs.readFileSync(configFile, 'utf8');
    const journal = fs.readFileSync(stateFile, 'utf8');
    const { preparePtyHelper } = await import('../dist/utils/launch-pty.js');
    preparePtyHelper(path.dirname(createRequire(import.meta.url).resolve('node-pty/package.json')));
    const pty = await import('node-pty');
    const child = pty.spawn(process.execPath, [path.resolve('dist/cli.js'), 'restore', 'codex'], {
      cwd: process.cwd(), cols: 100, rows: 30,
      env: { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config'), PATH: '/usr/bin:/bin', TERM: 'xterm-256color' },
    });
    let output = '', sent = false, ended = false;
    const done = new Promise(resolve => child.onExit(event => { ended = true; resolve(event); }));
    t.after(async () => { if (!ended) { child.kill('SIGKILL'); await done; } });
    child.onData(data => {
      output += data;
      if (!sent && output.includes('Restore previous settings for Codex') && output.includes('Yes')) {
        sent = true;
        child.write(confirmed ? '\u001b[B\r' : '\r');
      }
    });
    let timeout;
    const event = await Promise.race([
      done,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`Timed out: ${output}`)), 10000); }),
    ]).finally(() => clearTimeout(timeout));
    assert.equal(event.exitCode, 0, output);
    assert.equal(fs.readFileSync(configFile, 'utf8'), confirmed ? original : before);
    if (confirmed) assert.deepEqual(stateStore.getRecordedTools(), []);
    else assert.equal(fs.readFileSync(stateFile, 'utf8'), journal);
  });
}
