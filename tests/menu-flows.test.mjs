import assert from 'node:assert/strict'; import fs from 'node:fs'; import test from 'node:test'; import {runPrompt} from './helpers/prompt-pty.mjs';
const en=JSON.parse(fs.readFileSync(new URL('../src/locales/en_US.json',import.meta.url),'utf8'));
const head=`import fs from 'node:fs';import {configManager} from './dist/lib/config.js';import {i18n} from './dist/lib/i18n.js';configManager.setLang('en_US');i18n.init();const before=fs.readFileSync(configManager.configFile,'utf8');`;
test('real PTY main menu matches the six-entry released menu and Esc exits', {skip:process.platform==='win32'},async()=>{
 const out=await runPrompt(head+`import {showMainMenu} from './dist/lib/wizard/menus/main-menu.js';await showMainMenu();console.log('UNCHANGED',fs.readFileSync(configManager.configFile,'utf8')===before);`,[[en.menu_select_action,'\x1b']]);
 for(const key of ['menu_setup_tools','menu_switch_model','menu_my_tools','menu_account','menu_doctor','menu_more'])assert.ok(out.includes(en[key]),key);assert.match(out,/UNCHANGED.*true/);
});
test('real PTY endpoint and API key flows cancel without saving or network calls', {skip:process.platform==='win32'},async()=>{
 const out=await runPrompt(head+`import {runEndpointSelectionFlow} from './dist/lib/wizard/flows/endpoint-selection-flow.js';import {runApiKeyFlow} from './dist/lib/wizard/flows/api-key-flow.js';globalThis.fetch=async()=>{throw Error('Network must not be used');};console.log('ENDPOINT',await runEndpointSelectionFlow());console.log('KEY',await runApiKeyFlow());console.log('UNCHANGED',fs.readFileSync(configManager.configFile,'utf8')===before);`,[[en.endpoint_prompt,'\x1b'],[en.apikey_prompt,'\x1b']]);assert.match(out,/ENDPOINT.*false/);assert.match(out,/KEY.*false/);assert.match(out,/UNCHANGED.*true/);
});
