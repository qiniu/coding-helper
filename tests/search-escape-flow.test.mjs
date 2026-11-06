import assert from 'node:assert/strict';
import test from 'node:test';
import { runPrompt } from './helpers/prompt-pty.mjs';
const pty = { skip: process.platform === 'win32' };
const head = `import assert from 'node:assert/strict';import fs from 'node:fs';import {configManager} from './dist/lib/config.js';import {i18n} from './dist/lib/i18n.js';import {promptHelper} from './dist/lib/wizard/ui/prompt-helper.js';import {marketModelService} from './dist/lib/market-model-service.js';import {modelService} from './dist/lib/model-service.js';i18n.init('en_US');configManager.setApiKey('fixture');marketModelService.fetchModels=async()=>[{id:'fixture/model',name:'Fixture',features:[]}];modelService.fetchModels=async()=>[{id:'fixture/model'}];`;
test('searchSelect distinguishes Esc cancellation from an explicit skipped role', pty, async () => {
 const source = head + `assert.equal(await promptHelper.searchSelect('CANCEL_READY',[],true),null);assert.equal(await promptHelper.searchSelect('SKIP_READY',[],true),undefined);console.log('DISTINCT_OK');`;
 const out = await runPrompt(source, [['CANCEL_READY','\x1b'],['SKIP_READY','\r']]);
 assert.match(out,/DISTINCT_OK/);
});
for (const role of ['Haiku','Sonnet','Opus','Subagent']) test(`Claude ${role} Esc cancels without confirming or changing saved settings`, pty, async () => {
 const source = head + `import {runModelSelectionFlow} from './dist/lib/wizard/flows/model-selection-flow.js';configManager.setModels({claudeCode:{haikuModel:'saved/model',useDefaultModels:false}});const before=fs.readFileSync(configManager.configFile,'utf8');let confirmations=0;promptHelper.confirm=async()=>{confirmations++;return true;};assert.equal(await runModelSelectionFlow(),false);assert.equal(confirmations,1);assert.equal(fs.readFileSync(configManager.configFile,'utf8'),before);console.log('CANCEL_OK');`;
 const roles = ['Haiku','Sonnet','Opus','Subagent'];
 const steps = roles.slice(0,roles.indexOf(role)+1).map(name => [new RegExp('Select '+name+' model[^]*Esc'), name === role ? '\x1b' : '\r']);
 const out = await runPrompt(source,steps,110,{rows:40});
 assert.match(out,/CANCEL_OK/);
});
