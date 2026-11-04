import assert from 'node:assert/strict';
import test from 'node:test';
import { runPrompt } from './helpers/prompt-pty.mjs';

const source = `import assert from 'node:assert/strict';
import {configManager} from './dist/lib/config.js';
import {i18n} from './dist/lib/i18n.js';
import {toolManager} from './dist/lib/tool-manager.js';
import {toolsUsingProfile,runProfileFlow} from './dist/lib/wizard/flows/profile-flow.js';
configManager.setLang('en_US');i18n.init('en_US');
configManager.saveProfile('work','fixture-key','china');
configManager.setToolProfile('copilot','work');
configManager.setModels({toolModels:{copilot:'fixture-model'}});
for(const tool of toolManager.getAll()){tool.isConfigured=()=>false;tool.isInstalled=()=>false;}
const copilot=toolManager.get('copilot');copilot.isInstalled=()=>true;
`;

test('profiles count an installed and ready launch-only tool', {skip:process.platform==='win32'}, async () => {
  const out = await runPrompt(source + `assert.deepEqual(toolsUsingProfile('work'),['copilot']);copilot.isInstalled=()=>false;assert.deepEqual(toolsUsingProfile('work'),[]);console.log('BINDING_COUNT_OK');`, []);
  assert.match(out, /BINDING_COUNT_OK/);
});

test('deleting a Copilot-bound profile warns, and declining retains the binding', {skip:process.platform==='win32'}, async () => {
  const out = await runPrompt(source + `await runProfileFlow();assert.equal(configManager.getConnection('copilot').profile,'work');assert.ok(configManager.getProfile('work'));console.log('BINDING_RETAINED');`, [
    [/New profile[^]*Used by: GitHub Copilot CLI[^]*Esc back/, '\r'],
    [/Profile work[^]*Delete[^]*Esc back/, '\x1b[H\x1b[B\x1b[B\r'],
    [/In use by GitHub Copilot CLI[^]*Delete profile work\?[^]*Esc back/, '\x1b'],
    [/Profile work[^]*Delete[^]*Esc back/, '\x1b'],
    [/New profile[^]*Esc back/, '\x1b'],
  ], 110, {rows:40});
  assert.match(out, /BINDING_RETAINED/);
});
