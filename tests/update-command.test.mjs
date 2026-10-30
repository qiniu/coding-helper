import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {executeToolUpdate} from '../dist/utils/update-command.js';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'update-command-'));process.env.HOME=process.env.USERPROFILE=home;
test('self-update resolves an off-PATH executable with spaces and literal shell metacharacters',{skip:process.platform==='win32'},()=>{
 const saved=process.env.PATH;process.env.PATH='';const dir=path.join(home,'custom $(echo ignored) install');fs.mkdirSync(dir);const file=path.join(dir,'probe');const marker=path.join(home,'args');
 fs.writeFileSync(file,'#!/bin/sh\nprintf "%s" "$1" > "'+marker+'"\n',{mode:0o700});
 try{executeToolUpdate({command:'probe',updateCommand:'probe update',installCommand:'unused',searchPaths:[file]});assert.equal(fs.readFileSync(marker,'utf8'),'update');fs.writeFileSync(file,'#!/bin/sh\nexit 17\n',{mode:0o700});assert.throws(()=>executeToolUpdate({command:'probe',updateCommand:'probe update',installCommand:'unused',searchPaths:[file]}),/17/);}finally{process.env.PATH=saved;}
});
