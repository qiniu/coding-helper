import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {preparePtyHelper} from '../dist/utils/launch-pty.js';
test('packaged PTY helper gains execution permission without widening data files',{skip:process.platform==='win32'},()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pty-mode-'));const dir=path.join(root,'prebuilds',`${process.platform}-${process.arch}`);fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'pty.node'),'fixture',{mode:0o600});fs.writeFileSync(path.join(dir,'spawn-helper'),'fixture',{mode:0o600});
 try{preparePtyHelper(root);assert.equal(fs.statSync(path.join(dir,'spawn-helper')).mode&0o777,0o700);assert.equal(fs.statSync(path.join(dir,'pty.node')).mode&0o777,0o600);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
