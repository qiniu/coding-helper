import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import test from 'node:test';
import {isolateHome} from './helpers/isolated-home.mjs';
const home=fs.mkdtempSync(os.tmpdir()+'/reload-model-');isolateHome(home);
const {authCommand}=await import('../dist/commands/auth.js');
const {configManager}=await import('../dist/lib/config.js');
const {toolManager}=await import('../dist/lib/tool-manager.js');
const {uiRenderer}=await import('../dist/lib/wizard/ui/ui-renderer.js');
test.after(()=>fs.rmSync(home,{recursive:true,force:true}));
test('reload missing a required model exits nonzero and never invokes the writer',async()=>{
  const argv=process.argv,exit=process.exitCode,error=uiRenderer.renderError;
  configManager.setApiKey('fake');
  toolManager.register({name:'reload-model-test',requiresModelSelection:true,loadConfig(){assert.fail('missing model must not write');}});
  process.argv=['node','helper','auth','reload','reload-model-test'];uiRenderer.renderError=()=>{};
  try{await authCommand('reload');assert.equal(process.exitCode,1);}
  finally{process.argv=argv;process.exitCode=exit;uiRenderer.renderError=error;}
});
