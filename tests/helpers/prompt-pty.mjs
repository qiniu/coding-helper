import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { createRequire } from 'node:module';
export async function runPrompt(source, steps, columns = 80, options = {}) {
  const { preparePtyHelper } = await import('../../dist/utils/launch-pty.js');
  preparePtyHelper(path.dirname(createRequire(import.meta.url).resolve('node-pty/package.json')));
  const { spawn } = await import('node-pty');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-pty-'));
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { cwd: process.cwd(), cols: columns, rows: options.rows ?? 28, name: 'xterm-256color', env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, TERM: 'xterm-256color', FORCE_COLOR: '1' } });
  let transcript = '', index = 0, cursor = 0;
  const clean = value => value.replace(/\x1B(?:[@-Z\\-_a-z]|\[[0-?]*[ -/]*[@-~])/g, '');
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('PTY timeout: ' + clean(transcript))); }, 10000);
      child.onData(data => {
        transcript += data;
        if (index >= steps.length) return;
        const text = clean(transcript); const [expected, keys] = steps[index];
        const match = expected instanceof RegExp ? new RegExp(expected.source, expected.flags.replace(/[gy]/g, '')).exec(text.slice(cursor)) : undefined;
        const found = expected instanceof RegExp ? (match ? cursor + match.index : -1) : text.indexOf(expected, cursor);
        if (found !== -1) { cursor = found + (match ? match[0].length : expected.length); index++; child.write(keys); }
      });
      child.onExit(({ exitCode }) => { clearTimeout(timer); try { assert.equal(exitCode, 0, clean(transcript)); assert.equal(index, steps.length, clean(transcript)); resolve(options.raw ? transcript : clean(transcript)); } catch (error) { reject(error); } });
    });
  } finally { child.kill(); fs.rmSync(home, { recursive: true, force: true }); }
}
