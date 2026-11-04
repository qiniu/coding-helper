import assert from 'node:assert/strict';
import test from 'node:test';
import { runPrompt } from './helpers/prompt-pty.mjs';

const source = `import fs from 'node:fs';import assert from 'node:assert/strict';
import {configManager} from './dist/lib/config.js';
import {createProgram} from './dist/lib/command.js';
import {Wizard} from './dist/lib/wizard/wizard.js';
let requests=0;globalThis.fetch=async()=>{requests++;throw Error('unexpected network');};`;
for (const entry of ['default', 'init']) for (const cancel of ['escape', 'interrupt']) {
  test(`${entry} first wizard ${cancel} at API key preserves first-run routing`, { skip: process.platform === 'win32' }, async () => {
    const script = source + `try{await createProgram().parseAsync(['node','helper',...${entry === 'init' ? "['init']" : '[]'}]);}catch(error){assert.equal(error.name,'ExitPromptError');}
    assert.equal(requests,0);assert.equal(fs.existsSync(configManager.configFile),false);assert.equal(configManager.isFirstRun(),true);
    let resumed=false;const wizard=new Wizard();wizard.runInitWizard=async()=>{resumed=true;return false;};await wizard.run();assert.equal(resumed,true);console.log('FIRST_RUN_RESTORED');`;
    const out = await runPrompt(script, [
      ['请选择语言', '\r'], ['请选择 API 线路', '\r'],
      [/请输入您的 API Key[^]*Esc 返回/, cancel === 'escape' ? '\x1b' : '\x03'],
    ]);
    assert.match(out, /FIRST_RUN_RESTORED/);
    assert.doesNotMatch(out, /API Key 不能为空|是否重新输入/);
  });
}
test('cancelling forced init preserves an existing API key', { skip: process.platform === 'win32' }, async () => {
  const out = await runPrompt(source + `configManager.setApiKey('existing-key');await createProgram().parseAsync(['node','helper','init']);assert.equal(configManager.getApiKey(),'existing-key');assert.equal(configManager.isFirstRun(),false);assert.equal(requests,0);console.log('EXISTING_KEY_KEPT');`, [
    ['请选择语言', '\r'], ['请选择 API 线路', '\r'], [/请输入您的 API Key[^]*Esc 返回/, '\x1b'],
  ]);
  assert.match(out, /EXISTING_KEY_KEPT/);
});
