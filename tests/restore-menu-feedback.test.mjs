import assert from 'node:assert/strict';
import test from 'node:test';
import {runPrompt} from './helpers/prompt-pty.mjs';
for(const partial of [false,true])test(`restore menu ${partial?'partial':'complete'} failure is acknowledged without replacing the session exit code`,{skip:process.platform==='win32'},async()=>{
 const source=`import {configManager} from './dist/lib/config.js';import {i18n} from './dist/lib/i18n.js';import {toolManager} from './dist/lib/tool-manager.js';import {promptHelper} from './dist/lib/wizard/ui/prompt-helper.js';import {showMainMenu} from './dist/lib/wizard/menus/main-menu.js';configManager.setLang('en_US');i18n.init();let writes=0;const failed=toolManager.get('opencode');failed.isConfigured=()=>true;failed.isInstalled=()=>false;failed.unloadConfig=async()=>{writes++;throw new Error('Recoverable restore conflict');};const success=toolManager.get('hermes');success.isConfigured=()=>true;success.isInstalled=()=>false;success.unloadConfig=async()=>{writes++;};toolManager.getAll=()=>${partial?'[failed,success]':'[failed]'};promptHelper.confirm=async()=>true;process.exitCode=${partial?'2':'undefined'};await showMainMenu();console.log('RESULT',JSON.stringify({exitCode:process.exitCode??0,writes}));process.exitCode=undefined;`;
 const out=await runPrompt(source,[
  [/Connect coding tools[\s\S]*Esc Exit/,'\x1b[B'.repeat(5)+'\r'],
  [/Restore[\s\S]*Esc back/,'\x1b[B\r'],
  [/OpenCode[\s\S]*Esc back/,'\x1b[A '],
  ['❯ ☑','\x1b[C'],
  [/Configuration ownership or names conflict[\s\S]*Press Enter/,'\r'],
  [/Restore[\s\S]*Esc back/,'\x1b'],
  [/Connect coding tools[\s\S]*Esc Exit/,'\x1b'],
 ]);
 assert.match(out,new RegExp('RESULT.*"exitCode":'+(partial?2:0)+',"writes":'+(partial?2:1)));
});

test('tool unload menu hides arbitrary adapter errors containing old credentials', async () => {
 const source = `import {i18n} from './dist/lib/i18n.js';import {promptHelper} from './dist/lib/wizard/ui/prompt-helper.js';import {unloadToolConfig} from './dist/lib/wizard/menus/tool-menu.js';i18n.init('en_US');promptHelper.confirm=async()=>true;await unloadToolConfig({name:'fixture',displayName:'Fixture',unloadConfig:()=>{throw Error('sk-SECRET-old-provider');}});console.log('DONE');`;
 const out = await runPrompt(source, [[/Cannot safely restore[\s\S]*Press Enter/, '\r']]);
 assert.doesNotMatch(out, /sk-SECRET|old-provider/);
 assert.match(out, /DONE/);
});
