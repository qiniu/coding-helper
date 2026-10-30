import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { preparePtyHelper } from '../dist/utils/launch-pty.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const copilotKeys = ['COPILOT_PROVIDER_API_KEY_COMMAND', 'COPILOT_PROVIDER_BEARER_TOKEN',
  'COPILOT_PROVIDER_WIRE_MODEL', 'COPILOT_PROVIDER_WIRE_API'];
const claudeKeys = ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS', 'CLAUDE_CODE_USE_MANTLE', 'ANTHROPIC_API_KEY'];

for (const tool of ['copilot', 'claude']) {
  test(`real CLI PTY applies the ${tool} adapter without inherited routing overrides`, {
    skip: process.platform === 'win32', timeout: 15000,
  }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-pty-regression-'));
    let child, ended = false, timer;
    try {
      const bin = path.join(dir, 'bin');
      const report = path.join(dir, 'report.json');
      fs.mkdirSync(bin);
      fs.mkdirSync(path.join(dir, '.coding-helper'));
      fs.writeFileSync(path.join(dir, '.coding-helper/config.yaml'),
        'lang: en_US\napi_key: fake-pty-key\ndefaultModel: demo-model\nclaudeCode:\n  sonnetModel: demo-sonnet\n');
      fs.writeFileSync(path.join(dir, 'providers.json'), '{}');
      // 使用真实适配器和启动入口，替身客户端只负责观测实际收到的环境及临时设置。
      fs.writeFileSync(path.join(bin, tool), `#!${process.execPath}
const fs = require('node:fs');
const keys = ${JSON.stringify([...copilotKeys, ...claudeKeys, 'COPILOT_MODEL', 'COPILOT_PROVIDER_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_DEFAULT_SONNET_MODEL'])};
const index = process.argv.indexOf('--settings');
const settingsFile = index < 0 ? null : process.argv[index + 1];
fs.writeFileSync(${JSON.stringify(report)}, JSON.stringify({
  env: Object.fromEntries(keys.filter(key => Object.hasOwn(process.env, key)).map(key => [key, process.env[key]])),
  settingsFile, settings: settingsFile ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : null,
}));
`, { mode: 0o700 });
      const env = {
        ...process.env, HOME: dir, USERPROFILE: dir, COPILOT_HOME: path.join(dir, '.copilot'),
        COPILOT_PROVIDERS_CONFIG: path.join(dir, 'providers.json'),
        PATH: bin + path.delimiter + process.env.PATH, TERM: 'xterm-256color',
        ...Object.fromEntries([...copilotKeys, ...claudeKeys].map(key => [key, 'stale-routing-value'])),
      };
      preparePtyHelper(path.dirname(createRequire(import.meta.url).resolve('node-pty/package.json')));
      const pty = await import('node-pty');
      child = pty.spawn(process.execPath, ['dist/cli.js', 'run', tool], { cwd: root, env, cols: 100, rows: 30 });
      let output = '';
      child.onData(data => { output += data; });
      const status = await new Promise((resolve, reject) => {
        timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('helper did not exit naturally: ' + output)); }, 7000);
        child.onExit(event => { ended = true; resolve(event); });
      });
      assert.equal(status.exitCode, 0, output);
      const observed = JSON.parse(fs.readFileSync(report, 'utf8'));
      for (const key of tool === 'copilot' ? copilotKeys : claudeKeys) {
        assert.equal(Object.hasOwn(observed.env, key), false, key + ' must be absent from the child environment');
      }
      if (tool === 'copilot') {
        assert.equal(observed.env.COPILOT_MODEL, 'demo-model');
        assert.equal(observed.env.COPILOT_PROVIDER_API_KEY, 'fake-pty-key');
        assert.equal(observed.settingsFile, null);
      } else {
        assert.equal(observed.env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'demo-sonnet');
        assert.equal(observed.env.ANTHROPIC_AUTH_TOKEN, 'fake-pty-key');
        assert.equal(observed.settings.env.ANTHROPIC_MODEL, '');
        assert.equal(observed.settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'demo-sonnet');
        assert.equal(fs.existsSync(observed.settingsFile), false, 'session settings must be removed after exit');
      }
    } finally {
      clearTimeout(timer);
      if (child && !ended) child.kill('SIGKILL');
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
