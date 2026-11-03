import assert from 'node:assert/strict';
import test from 'node:test';
import {runPrompt} from './helpers/prompt-pty.mjs';

const head=`import {configManager} from './dist/lib/config.js';import {i18n} from './dist/lib/i18n.js';import {toolManager} from './dist/lib/tool-manager.js';configManager.setLang('en_US');i18n.init();globalThis.fetch=async()=>new Response('{}');const tool=toolManager.get('dsh');tool.isInstalled=()=>null;tool.isConfigured=()=>false;tool.npmPackageName=undefined;let versionCalls=0;tool.getVersion=()=>{versionCalls++;throw Error('must not run CLI version for a desktop app')};`;

test('doctor distinguishes desktop-only tools from missing CLI installations',{skip:process.platform==='win32'},async()=>{
  const source=head+`toolManager.getAll=()=>[tool];const {doctorCommand}=await import('./dist/commands/doctor.js');await doctorCommand();`;
  const out=await runPrompt(source,[],140,{rows:40});
  const line=out.split(/\r?\n/).find(line=>line.includes('DeepSeek Harness'));
  assert.ok(line,out);assert.match(line,/Cannot detect \(desktop app\)/);assert.doesNotMatch(line,/Not found/);
});

test('desktop-only tool menu shows the same manual launch guidance as the action',{skip:process.platform==='win32'},async()=>{
  const source=head+`configManager.setModels({toolModels:{dsh:'demo-model'}});const {showToolMenu}=await import('./dist/lib/wizard/menus/tool-menu.js');await showToolMenu(tool);if(versionCalls)throw Error('desktop-only version probe was called');console.log('NO_CLI_PROBE');`;
  const out=await runPrompt(source,[[/Esc back/,'\x1b']],160,{rows:40});
  assert.match(out,/Launch +DeepSeek Harness is a desktop application\. Please launch it manually\./);
  assert.doesNotMatch(out,/Launch +dsh web/);
  assert.match(out,/NO_CLI_PROBE/);
});


test('failed CLI installation detection does not become desktop launch guidance',{skip:process.platform==='win32'},async()=>{
 const source=head+`tool.isInstalled=()=>{throw Error('PRIVATE_INSTALL_PROBE')};configManager.setModels({toolModels:{dsh:'demo-model'}});const {showToolMenu}=await import('./dist/lib/wizard/menus/tool-menu.js');await showToolMenu(tool);console.log('MENU_OK');`;
 const out=await runPrompt(source,[[/Select action[^]*Esc back/,'\x1b']],160,{rows:40});
 assert.match(out,/Launch +dsh web/);assert.doesNotMatch(out,/is a desktop application|PRIVATE_INSTALL_PROBE/);assert.match(out,/MENU_OK/);
});

test('a failed installation probe during Launch returns to the menu with safe retry guidance',{skip:process.platform==='win32'},async()=>{
 const source=head+`tool.isInstalled=()=>{throw Error('PRIVATE_INSTALL_PROBE')};configManager.setModels({toolModels:{dsh:'demo-model'}});const {showToolMenu}=await import('./dist/lib/wizard/menus/tool-menu.js');await showToolMenu(tool);console.log('MENU_OK');`;
 const out=await runPrompt(source,[[/Select action[^]*Esc back/,'\x1b[B'.repeat(3)+'\r'],[/Unable to detect DeepSeek Harness[^]*Press Enter to continue/,'\r'],[/Select action[^]*Esc back/,'\x1b']],160,{rows:40});
 assert.match(out,/installation location and permissions/);assert.doesNotMatch(out,/is a desktop application|PRIVATE_INSTALL_PROBE/);assert.match(out,/MENU_OK/);
});
