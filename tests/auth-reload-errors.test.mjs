import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'reload-errors-'));
process.env.HOME=process.env.USERPROFILE=home;
process.env.XDG_CONFIG_HOME=path.join(home,'.config');
const {authCommand}=await import('../dist/commands/auth.js');
const {uiRenderer}=await import('../dist/lib/wizard/ui/ui-renderer.js');
const {toolManager}=await import('../dist/lib/tool-manager.js');
test.after(()=>fs.rmSync(home,{recursive:true,force:true}));
test('reload reports missing arguments, unknown tools and missing keys as failures',async()=>{
  const argv=process.argv,exit=process.exitCode;
  const error=uiRenderer.renderError,hint=uiRenderer.renderHint;
  uiRenderer.renderError=uiRenderer.renderHint=()=>{};
  toolManager.register({name:'reload-no-key',loadConfig(){assert.fail('must not write without key');}});
  try{
    for(const target of [undefined,'reload-unknown','reload-no-key']){
      process.exitCode=undefined;
      process.argv=['node','helper','auth','reload',...(target?[target]:[])];
      await authCommand('reload');assert.equal(process.exitCode,1,target);
    }
  }finally{process.argv=argv;process.exitCode=exit;uiRenderer.renderError=error;uiRenderer.renderHint=hint;}
});
