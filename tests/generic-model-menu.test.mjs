import test from 'node:test';
import assert from 'node:assert/strict';
import {hasSavedToolModelConfig} from '../dist/lib/wizard/menus/tool-menu.js';
test('generic tool menu recognizes its saved model and default without affecting legacy selections', () => {
  assert.equal(hasSavedToolModelConfig({name:'custom-adapter'}, {toolModels:{'custom-adapter':'model'}}), true);
  assert.equal(hasSavedToolModelConfig({name:'custom-adapter'}, {defaultModel:'model'}), true);
  assert.equal(hasSavedToolModelConfig({name:'custom-adapter'}, {}), false);
  assert.equal(hasSavedToolModelConfig({name:'codex'}, {defaultModel:'model'}), false);
});
