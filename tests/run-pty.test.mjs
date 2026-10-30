import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { preparePtyHelper } from '../dist/utils/launch-pty.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/launcher-pty-tool.mjs', import.meta.url));
const menu = fileURLToPath(new URL('./fixtures/launcher-pty-menu.mjs', import.meta.url));
const removedKeys = [
  'COPILOT_PROVIDER_API_KEY_COMMAND', 'COPILOT_PROVIDER_BEARER_TOKEN',
  'COPILOT_PROVIDER_WIRE_MODEL', 'COPILOT_PROVIDER_WIRE_API', 'PTY_TEST_UNSET',
];
const options = { skip: process.platform === 'win32', timeout: 15000 };

async function startClient(t, { exitCode = 0, menuMode = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helper-pty-regression-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.coding-helper'));
  fs.writeFileSync(path.join(dir, '.coding-helper/config.yaml'),
    'lang: en_US\napi_key: fake-pty-test-key\ndefaultModel: demo-model\n');
  const client = path.join(dir, 'client');
  const report = path.join(dir, 'environment.json');
  fs.writeFileSync(client, `#!${process.execPath}
const fs = require('node:fs');
const keys = ${JSON.stringify([...removedKeys, 'PTY_TEST_EMPTY', 'PTY_TEST_ZERO'])};
fs.writeFileSync(process.env.PTY_TEST_REPORT, JSON.stringify(Object.fromEntries(
  keys.filter(key => Object.hasOwn(process.env, key)).map(key => [key, process.env[key]])
)));
console.log('PTY_CLIENT_DONE');
process.exit(Number(process.env.PTY_TEST_EXIT));
`, { mode: 0o700 });

  preparePtyHelper(path.dirname(createRequire(import.meta.url).resolve('node-pty/package.json')));
  const pty = await import('node-pty');
  const env = {
    ...process.env, HOME: dir, USERPROFILE: dir, TERM: 'xterm-256color', NO_COLOR: '1',
    PTY_TEST_CLIENT: client, PTY_TEST_REPORT: report, PTY_TEST_EXIT: String(exitCode),
    ...Object.fromEntries(removedKeys.map(key => [key, 'inherited-value-must-be-removed'])),
  };
  // 既验证覆盖父环境，也验证原本就不存在的变量。
  delete env.PTY_TEST_UNSET;
  const args = menuMode ? [menu] : ['--import', fixture, 'dist/cli.js', 'run', 'pty-regression'];
  const child = pty.spawn(process.execPath, args, { cwd: root, env, cols: 100, rows: 30 });
  let output = '', ended = false, cursor = 0;
  child.onData(data => { output += data; });
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  child.onExit(event => { ended = true; finish(event); });
  t.after(async () => {
    if (!ended) { child.kill('SIGKILL'); await done; }
  });

  async function waitFor(predicate, description) {
    const deadline = Date.now() + 7000;
    while (!predicate()) {
      assert.equal(ended, false, `helper exited before ${description}: ${output}`);
      assert.ok(Date.now() < deadline, `timed out waiting for ${description}: ${output}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }

  return {
    report,
    child,
    async expect(text) {
      await waitFor(() => output.indexOf(text, cursor) !== -1, text);
      cursor = output.indexOf(text, cursor) + text.length;
    },
    async expectExit(code) {
      // 超时即失败；清理时强杀不计为正常退出。
      await waitFor(() => ended, 'natural helper exit');
      assert.equal((await done).exitCode, code, output);
    },
  };
}

test('real CLI PTY removes unset environment variables after merging parent overrides', options, async t => {
  const client = await startClient(t);
  await client.expect('PTY_CLIENT_DONE');
  assert.deepEqual(JSON.parse(fs.readFileSync(client.report, 'utf8')), {
    PTY_TEST_EMPTY: '', PTY_TEST_ZERO: '0',
  });
  await client.expectExit(0);
});

for (const code of [0, 7]) {
  test(`real CLI PTY exits naturally when its client exits with ${code}`, options, async t => {
    const client = await startClient(t, { exitCode: code });
    await client.expect('PTY_CLIENT_DONE');
    await client.expectExit(code);
  });

  test(`tool menu accepts keyboard input after a PTY client exits with ${code}`, options, async t => {
    const client = await startClient(t, { exitCode: code, menuMode: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      await client.expect('Select action');
      client.child.write('\x1b[B\r');
      await client.expect('PTY_CLIENT_DONE');
      await client.expect('Press Enter to continue');
      client.child.write('\r');
    }
    await client.expect('Select action');
    client.child.write('\x1b[A\r');
    await client.expect('PTY_MENU_RETURNED');
    await client.expectExit(0);
  });
}
