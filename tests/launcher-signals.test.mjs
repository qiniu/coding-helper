import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { preparePtyHelper } from '../dist/utils/launch-pty.js';

for (const mode of ['parent', 'group', 'tty', 'menu-term']) {
  test('launcher real signals and controlling terminal: ' + mode, {skip:process.platform === 'win32', timeout:15000}, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helper-signal-test-'));
    const env = {...process.env, HOME:dir, USERPROFILE:dir, SIGNAL_COUNT:path.join(dir,'count'), SIGNAL_READY:path.join(dir,'ready')};
    delete env.SIGNAL_MENU; delete env.SIGNAL_EXECUTABLE;
    const wrapper = fileURLToPath(new URL('./fixtures/launcher-signal-wrapper.mjs', import.meta.url));
    if (mode === 'menu-term') {
      const script = fileURLToPath(new URL('./fixtures/launcher-signal-child.cjs', import.meta.url));
      env.SIGNAL_EXECUTABLE = path.join(dir,'client'); env.SIGNAL_MENU = '1';
      fs.writeFileSync(env.SIGNAL_EXECUTABLE, '#!' + process.execPath + '\n' + fs.readFileSync(script,'utf8'), {mode:0o700});
    }
    let child, text = '', ended = false, finish;
    const done = new Promise(resolve => { finish = resolve; });
    if (mode === 'tty') {
      preparePtyHelper(path.dirname(createRequire(import.meta.url).resolve('node-pty/package.json')));
      const pty = await import('node-pty');
      child = pty.spawn(process.execPath,[wrapper],{env,cols:80,rows:24});
      child.onData(data => { text += data; });
      child.onExit(({exitCode}) => {ended = true; finish(exitCode);});
    } else {
      child = spawn(process.execPath,[wrapper],{env,detached:true,stdio:'ignore'});
      child.on('exit', code => {ended = true; finish(code);});
    }
    const timer = setTimeout(() => {
      if (!ended) { if (mode === 'tty') child.kill(); else process.kill(-child.pid,'SIGKILL'); }
    }, 10000);
    try {
      while (!ended && !fs.existsSync(env.SIGNAL_READY)) await new Promise(resolve => setTimeout(resolve,20));
      assert.equal(ended,false,'client must become ready');
      if (mode === 'tty') {
        child.write('hello\r');
        while (!ended && !text.includes('INPUT_OK')) await new Promise(resolve => setTimeout(resolve,20));
        assert.match(text,/CONTROL_TTY_OK/);assert.match(text,/INPUT_OK/);child.write('\x03');
      } else process.kill(mode === 'group' ? -child.pid : child.pid,mode === 'menu-term'?'SIGTERM':'SIGINT');
      const code = await done;
      assert.equal(code,mode === 'tty'?0:mode === 'menu-term'?143:130);
      assert.equal(fs.readFileSync(env.SIGNAL_COUNT,'utf8'),'1');
    } finally {
      clearTimeout(timer);
      if (!ended) { if (mode === 'tty') child.kill(); else process.kill(-child.pid,'SIGKILL'); await done; }
      fs.rmSync(dir,{recursive:true,force:true});
    }
  });
}
