import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'text-restore-'));
process.env.HOME = process.env.USERPROFILE = home;
const {writeTextOrRemove} = await import('../dist/lib/core/safe-write.js');
test('text restore recreates empty and whitespace files and guards concurrent edits', () => {
  const file = path.join(home, 'config.toml');
  for (const text of ['', ' \r\n\t']) {
    fs.rmSync(file, {force: true});
    writeTextOrRemove(file, text, {content: undefined});
    assert.equal(fs.readFileSync(file, 'utf8'), text);
    fs.writeFileSync(file, 'user edit');
    assert.throws(() => writeTextOrRemove(file, text, {content: undefined}), /changed/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'user edit');
  }
  writeTextOrRemove(file, undefined, {content: 'user edit'});
  assert.equal(fs.existsSync(file), false);
  const target = path.join(home, 'target');
  fs.writeFileSync(target, 'keep');
  fs.symlinkSync(target, file);
  assert.throws(() => writeTextOrRemove(file, ''), /symbolic link/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'keep');
});
