import assert from 'node:assert/strict';import test from 'node:test';import {runPrompt} from './helpers/prompt-pty.mjs';
const source=`import {configManager} from './dist/lib/config.js';import {i18n} from './dist/lib/i18n.js';import {toolManager} from './dist/lib/tool-manager.js';import {promptHelper} from './dist/lib/wizard/ui/prompt-helper.js';import {isPreview} from './dist/lib/core/safe-write.js';import {showToolMenu} from './dist/lib/wizard/menus/tool-menu.js';configManager.setApiKey('fake');configManager.setModels({codexModel:'main',slotModels:{codex:{review:'review'}}});i18n.init('en_US');let written;const tool=toolManager.get('codex');tool.getVersion=()=> '1.0.0';tool.isInstalled=()=>true;tool.isConfigured=()=>true;tool.npmPackageName=undefined;tool.checkModel=async()=>undefined;tool.loadConfig=async(_key,_url,models)=>{if(!isPreview())written=models;};promptHelper.pressEnter=async()=>console.log('WRITE_ACK');`;
const saveSteps=[['Select action','\r'],[/Code review[\s\S]*?Esc back/,'\r'],[/Confirm[\s\S]*?Esc back/,'\x1b[A\x1b[A\r'],[/WRITE_ACK[\s\S]*?Select action/,'\x1b[B'.repeat(6)+'\r']];
const failureSteps=[['Select action','\r'],[/Code review[\s\S]*?Esc back/,'\r'],[/Confirm[\s\S]*?Esc back/,'\x1b'],[/Select action[\s\S]*?Esc back/,'\x1b[B'.repeat(6)+'\r']];
test('tool menu exposes slot editor and applies its complete plan',{skip:process.platform==='win32'},async()=>{
 const out=await runPrompt(source+`await showToolMenu(tool);console.log('RESULT',JSON.stringify({main:written?.codexModel,review:written?.slotModels.codex.review}));`,saveSteps);assert.match(out,/RESULT.*"main":"main","review":"review"/);
});
test('slot entry handles unreadable client state without exposing parser details',{skip:process.platform==='win32'},async()=>{
 const out=await runPrompt(source+`tool.isConfigured=()=>{throw Error('SENSITIVE_SNAPSHOT')};await showToolMenu(tool);console.log('WRITTEN',!!written);console.log('EXIT',process.exitCode);process.exitCode=0;`,[['Select action','\r'],[/Code review[\s\S]*?Esc back/,'\r'],[/WRITE_ACK[\s\S]*?Select action/,'\x1b[B'.repeat(6)+'\r']]);assert.match(out,/WRITTEN false/);assert.match(out,/EXIT 1/);assert.doesNotMatch(out,/SENSITIVE_SNAPSHOT/);
});

test('slot editor keeps Ctrl+C cancellation available',{skip:process.platform==='win32'},async()=>{
 const out=await runPrompt(source+`try{await showToolMenu(tool);}catch(error){console.log('CANCEL',error.name);}`, [['Select action','\r'],[/Code review[\s\S]*?Esc back/,'\x03']]);assert.match(out,/CANCEL ExitPromptError/);assert.doesNotMatch(out,/WRITE_ACK/);
});

test('saved helper model survives a disconnected client',{skip:process.platform==='win32'},async()=>{
 const out=await runPrompt(source+`tool.isConfigured=()=>false;tool.defaultModel='default-model';await showToolMenu(tool);console.log('MODEL',written?.codexModel);console.log('HELPER',configManager.getModels().codexModel);`,saveSteps);assert.match(out,/MODEL main/);assert.match(out,/HELPER main/);
});

test('slot write conflicts retain actionable recovery guidance',{skip:process.platform==='win32'},async()=>{
 const out=await runPrompt(source+`tool.loadConfig=async()=>{throw Error('Configuration changed since loading. Restore from backup before retrying.')};await showToolMenu(tool);process.exitCode=0;console.log('FAILURE_DONE');`,failureSteps);assert.match(out,/Restore a known backup/);assert.match(out,/FAILURE_DONE/);
});
test('slot write parser errors never reveal old credential content',{skip:process.platform==='win32'},async()=>{
 const out=await runPrompt(source+`tool.loadConfig=async()=>{throw Error('Unexpected token SENSITIVE_OLD_KEY in JSON')};await showToolMenu(tool);process.exitCode=0;console.log('FAILURE_DONE');`,failureSteps);assert.doesNotMatch(out,/SENSITIVE_OLD_KEY/);assert.match(out,/FAILURE_DONE/);
});
