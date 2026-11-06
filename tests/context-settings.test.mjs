import { isolateHome } from './helpers/isolated-home.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import test from 'node:test';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'context-settings-'));
isolateHome(home);
const { configManager } = await import('../dist/lib/config.js');
const { parseContextSize, formatContextSize } = await import('../dist/lib/core/context.js');
const { capContextWindow } = await import('../dist/lib/tools/openai-compat-tool.js');
test.after(() => fs.rmSync(process.env.HOME, { recursive: true, force: true }));
test('context parser accepts units, rejects unsafe values and supports auto', () => {
 assert.equal(parseContextSize('128k'), 128000); assert.equal(parseContextSize('1M'), 1000000);
 assert.equal(parseContextSize('auto'), undefined); assert.equal(formatContextSize(128000), '128K');
 for (const text of ['abc', '999', '9999999999999999999999999']) assert.throws(() => parseContextSize(text));
});
test('per tool context and explicit auto preserve the legacy value for other tools', () => {
 fs.mkdirSync(configManager.configDir, { recursive: true }); fs.writeFileSync(configManager.configFile, 'context_window: 96000\n'); configManager.reload();
 configManager.setContextWindow(64000, ['opencode']);
 assert.equal(configManager.getContextWindow('grok'), 96000); assert.equal(configManager.getContextWindow('opencode'), 64000);
 configManager.setContextWindow(undefined, ['opencode']); assert.equal(configManager.getContextWindow('opencode'), undefined);
 assert.equal(configManager.getContextWindow('grok'), 96000);
 assert.equal(capContextWindow(128000, 'grok'), 96000); assert.equal(capContextWindow(32000, 'grok'), 32000);
 assert.throws(() => configManager.setContextWindow(NaN, ['grok']));
});
