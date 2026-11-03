import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { runPrompt } from './helpers/prompt-pty.mjs';
const source = `import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {configManager} from './dist/lib/config.js';import {i18n} from './dist/lib/i18n.js';import {toolManager} from './dist/lib/tool-manager.js';import {showToolMenu} from './dist/lib/wizard/menus/tool-menu.js';import {safeWriteFile,isPreview} from './dist/lib/core/safe-write.js';configManager.setApiKey('fixture');configManager.setModels({codexModel:'main',slotModels:{codex:{review:'review'}}});i18n.init('en_US');const before=fs.readFileSync(configManager.configFile,'utf8'),file=path.join(process.env.HOME,'client.json');fs.writeFileSync(file,'original');let writes=0;const tool=toolManager.get('codex');tool.getVersion=()=>null;tool.isInstalled=tool.isConfigured=()=>true;tool.npmPackageName=undefined;tool.checkModel=async()=>undefined;tool.loadConfig=async()=>{if(!isPreview())writes++;safeWriteFile(file,'changed');};console.log('CONSENT_FILES',JSON.stringify({file,configFile:configManager.configFile,before}));try{await showToolMenu(tool);}catch(error){assert.equal(error.name,'ExitPromptError');}`;
const confirm = /Write configuration to Codex\?[^]*No|\? Confirm[^]*Esc back/;
for (const cancel of ['interrupt','decline']) test(`slot model edits require write consent and ${cancel} preserves helper and client files`,{skip:process.platform==='win32'},async()=>{
 let inspections=0;
 const inspect = text => {
  const files=JSON.parse(/CONSENT_FILES ([^\r\n]+)/.exec(text)[1]);
  assert.equal(fs.readFileSync(files.file,'utf8'),'original');
  assert.equal(fs.readFileSync(files.configFile,'utf8'),files.before);
  inspections++;
 };
 const steps=[['Select action','\r'],[/Code review[\s\S]*?Esc back/,'\x1b[F\r'],[confirm,text=>{
  inspect(text);
  return cancel==='interrupt'?'\x03':text.includes('Write configuration to Codex?')?'\x1b[B\r':'\x1b';
 }]];
 if(cancel==='decline')steps.push(['Select action',text=>{inspect(text);return '\x03';}]);
 await runPrompt(source,steps,120,{rows:42});
 assert.equal(inspections,cancel==='interrupt'?1:2);
});
