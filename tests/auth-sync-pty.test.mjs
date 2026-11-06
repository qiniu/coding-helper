import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { preparePtyHelper } from '../dist/utils/launch-pty.js';

for (const selected of [false,true]) {
  test(`key-change sync checkbox ${selected ? 'updates selected client' : 'preserves unselected client'}`, {skip:process.platform==='win32',timeout:15000}, async t => {
    const home=fs.mkdtempSync(path.join(os.tmpdir(),'auth-sync-pty-'));
    const helper=path.join(home,'.coding-helper/config.yaml');
    const client=path.join(home,'.config/opencode/opencode.json');
    fs.mkdirSync(path.dirname(helper),{recursive:true});fs.mkdirSync(path.dirname(client),{recursive:true});
    fs.writeFileSync(helper,'lang: en_US\napi_key: old-key\ntoolModels:\n  opencode: model\n');
    const before='{"model":"qiniu/model","provider":{"qiniu":{"options":{"baseURL":"https://api.qnaigc.com/v1","apiKey":"old-key"}}}}';
    fs.writeFileSync(client,before);
    const preload=path.join(home,'mock.cjs');
    fs.writeFileSync(preload,"globalThis.fetch=async()=>new Response('{}');require('node:child_process').spawnSync=()=>({status:0,stdout:'1.2.3',stderr:''});\n");
    preparePtyHelper(path.dirname(createRequire(import.meta.url).resolve('node-pty/package.json')));
    const pty=await import('node-pty');
    const child=pty.spawn(process.execPath,['--require',preload,path.resolve('dist/cli.js'),'auth','sk-new'],{
      cwd:process.cwd(),cols:100,rows:30,env:{HOME:home,USERPROFILE:home,XDG_CONFIG_HOME:path.join(home,'.config'),PATH:'/usr/bin:/bin',TERM:'xterm-256color'},
    });
    let output='',sent=false,ended=false;
    const done=new Promise(resolve=>child.onExit(event=>{ended=true;resolve(event);}));
    t.after(async()=>{if(!ended){child.kill('SIGKILL');await done;}fs.rmSync(home,{recursive:true,force:true});});
    child.onData(data=>{output+=data;if(!sent&&output.includes('Select Qiniu clients to update')&&output.includes('OpenCode')){sent=true;child.write(selected?' \r':'\r');}});
    let timer;
    const result=await Promise.race([done,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(output)),10000);})]).finally(()=>clearTimeout(timer));
    assert.equal(sent,true,output);assert.equal(result.exitCode,0,output);
    assert.match(fs.readFileSync(helper,'utf8'),/api_key: sk-new/);
    if(selected)assert.equal(JSON.parse(fs.readFileSync(client,'utf8')).provider.qiniu.options.apiKey,'sk-new');
    else assert.equal(fs.readFileSync(client,'utf8'),before);
  });
}
