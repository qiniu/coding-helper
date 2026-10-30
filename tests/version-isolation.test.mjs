import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { commandVersion } from '../dist/utils/find-command.js';
test('version detection isolates home, working directory and credentials, then removes initialization files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'version-isolation-'));
  const oldHome = process.env.HOME, oldProfile = process.env.USERPROFILE, oldKey = process.env.QINIU_API_KEY;
  process.env.HOME = process.env.USERPROFILE = dir; process.env.QINIU_API_KEY = 'must-not-inherit';
  const script = path.join(dir, 'version.cjs');
  const report = path.join(dir, 'report.json');
  const body = `const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const home=os.homedir();fs.mkdirSync(path.join(home,'.config'),{recursive:true});
fs.writeFileSync(path.join(home,'.config','initialized'),'cache');
fs.writeFileSync(path.join(process.cwd(),'initialized-cwd'),'cache');
fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({home:fs.realpathSync(home),cwd:process.cwd(),key:process.env.QINIU_API_KEY}));console.log('1.2.3');`;
  fs.writeFileSync(script, '#!' + process.execPath + '\n' + body, { mode: 0o700 });
  let command = script;
  if (process.platform === 'win32') { command = path.join(dir,'version.cmd'); fs.writeFileSync(command, `@"${process.execPath}" "${script}"\r\n`); }
  try {
    assert.equal(commandVersion(command), '1.2.3');
    const data = JSON.parse(fs.readFileSync(report,'utf8'));
    assert.notEqual(data.home, dir); assert.equal(data.home, data.cwd); assert.equal(data.key, undefined);
    assert.equal(fs.existsSync(data.home), false);
    assert.equal(fs.existsSync(path.join(dir,'.config')), false);
    assert.equal(fs.existsSync(path.join(dir,'initialized-cwd')), false);
  } finally {
    if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
    if (oldProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = oldProfile;
    if (oldKey === undefined) delete process.env.QINIU_API_KEY; else process.env.QINIU_API_KEY = oldKey;
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
