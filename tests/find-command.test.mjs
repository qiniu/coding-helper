import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {findCommand,commandVersion} from '../dist/utils/find-command.js';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'find-command-'));process.env.HOME=process.env.USERPROFILE=home;
test('unset PATH uses system defaults while empty PATH remains explicit',{skip:process.platform==='win32'},()=>{
 const saved=process.env.PATH;
 try{delete process.env.PATH;assert.ok(['/usr/bin/sh','/bin/sh'].includes(findCommand('sh')));process.env.PATH='';assert.equal(findCommand('sh'),undefined);}
 finally{if(saved===undefined)delete process.env.PATH;else process.env.PATH=saved;}
});
test('findCommand prefers PATH and falls back to home installs and explicit aliases',()=>{const old=process.env.PATH;const first=path.join(home,'path');const second=path.join(home,'.local/bin');fs.mkdirSync(first);fs.mkdirSync(second,{recursive:true});const name='helper-probe-unique';for(const dir of [first,second])fs.writeFileSync(path.join(dir,name),'#!/bin/sh\nexit 0\n',{mode:0o700});process.env.PATH=first;try{assert.equal(findCommand(name),path.join(first,name));process.env.PATH='';assert.equal(findCommand(name),path.join(second,name));const extra=path.join(home,'extra');fs.writeFileSync(extra,'#!/bin/sh\nexit 0\n',{mode:0o700});assert.equal(findCommand('missing-probe-unique',[extra]),extra);assert.equal(findCommand('$(touch unexpected)'),undefined);fs.chmodSync(extra,0o600);if(process.platform!=='win32')assert.equal(findCommand('missing-probe-unique',[extra]),undefined);}finally{process.env.PATH=old;}});
test('version check treats shell metacharacters in executable path literally',{skip:process.platform==='win32'},()=>{const file=path.join(home,'version $(echo not-executed)');fs.writeFileSync(file,'#!/bin/sh\nprintf "probe 1.2.3\\n"\n',{mode:0o700});assert.equal(commandVersion(file),'1.2.3');});

test('Windows quoted PATH entries preserve spaces and exclude empty paths',async()=>{
  const {commandPathEntries}=await import('../dist/utils/find-command.js');
  assert.deepEqual(commandPathEntries('"C:\\Tools\\AI Clients";;C:\\Windows;"";','win32'),['C:\\Tools\\AI Clients','C:\\Windows']);
  assert.deepEqual(commandPathEntries('"/literal quotes":/usr/bin::','linux'),['"/literal quotes"','/usr/bin']);
});

test('Windows explicit paths expand PATHEXT and prefer npm cmd shims over POSIX siblings', async () => {
  const {commandFileCandidates}=await import('../dist/utils/find-command.js');
  const file='C:/Users/Test User/.claude/local/node_modules/.bin/claude';
  assert.deepEqual(commandFileCandidates(file,'win32','.EXE;.CMD;.BAT;.COM'),[file+'.exe',file+'.cmd',file+'.bat',file+'.com',file]);
  assert.deepEqual(commandFileCandidates(file+'.CMD','win32','.EXE;.CMD'),[file+'.CMD']);
  assert.deepEqual(commandFileCandidates(file,'linux','.CMD'),[file]);
  const oldPlatform=Object.getOwnPropertyDescriptor(process,'platform');const oldPath=process.env.PATH,oldExt=process.env.PATHEXT;
  const extra=path.join(home,'Claude npm shim','node_modules','.bin','claude');fs.mkdirSync(path.dirname(extra),{recursive:true});fs.writeFileSync(extra,'POSIX sibling');fs.writeFileSync(extra+'.cmd','@echo off');
  try {
    Object.defineProperty(process,'platform',{value:'win32'});process.env.PATH='';process.env.PATHEXT='.EXE;.CMD';
    assert.equal(findCommand('missing-path-probe',[extra]),extra+'.cmd');
    assert.equal(findCommand(extra),extra+'.cmd');
  } finally {Object.defineProperty(process,'platform',oldPlatform);process.env.PATH=oldPath;if(oldExt===undefined)delete process.env.PATHEXT;else process.env.PATHEXT=oldExt;}
});
