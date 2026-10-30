import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-config-')));
process.env.HOME = process.env.USERPROFILE = home;
const { CodeBuddyTool } = await import('../dist/lib/tools/codebuddy-tool.js');
const { WorkBuddyTool } = await import('../dist/lib/tools/workbuddy-tool.js');
const { marketModelService } = await import('../dist/lib/market-model-service.js');
const { stateStore } = await import('../dist/lib/core/state-store.js');
const { uiRenderer } = await import('../dist/lib/wizard/ui/ui-renderer.js');
const market = { id: 'test/model', name: 'Test Model', features: ['工具调用'], model_constraints: { context_length: 32000, max_tokens: 4000 }, architecture: { input_modalities: ['text', 'image'], function_calling: { supported: true }, reasoning: { supported: false } } };
const cases = [[CodeBuddyTool, '.codebuddy', 'codeBuddyModels'], [WorkBuddyTool, '.workbuddy', 'workbuddyModels']];
function write(file, content) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
const read = file => fs.readFileSync(file, 'utf8');
for (const [Tool, dir, field] of cases) {
  const file = path.join(home, dir, 'models.json');
  test(Tool.name + ' preserves exact original across reloads', async () => {
    stateStore.clear();
    const original = '{\r\n\t"models": [{"id":"prior","vendor":"Qiniu","apiKey":"original"}],\r\n\t"availableModels": ["prior"], "custom": null\r\n}\r\n';
    write(file, original);
    const tool = new Tool(); const fetch = marketModelService.fetchModels;
    marketModelService.fetchModels = async () => [market];
    try {
      await tool.loadConfig('first-key', 'https://api.qnaigc.com/', { [field]: [market.id] });
      await tool.loadConfig('second-key', 'https://api.qnaigc.com/', { [field]: [market.id] });
      const configured = JSON.parse(read(file)).models[0];
      assert.equal(configured.apiKey, 'second-key'); assert.equal(configured.url, 'https://api.qnaigc.com/v1/chat/completions');
      assert.equal(configured.supportsImages, true); assert.equal(configured.maxInputTokens, 32000);
      await tool.unloadConfig(); assert.equal(read(file), original);
      assert.equal(stateStore.getState(tool.name, file), undefined);
    } finally { marketModelService.fetchModels = fetch; }
  });
  test(Tool.name + ' rejects corruption and conflicting edits', async () => {
    stateStore.clear(); const tool = new Tool(); const fetch = marketModelService.fetchModels;
    marketModelService.fetchModels = async () => [market];
    try {
      write(file, '{broken');
      await assert.rejects(tool.loadConfig('key', 'https://api.qnaigc.com', { [field]: [market.id] }), /Cannot parse/);
      assert.equal(read(file), '{broken');
      write(file, '{}'); await tool.loadConfig('key', 'https://api.qnaigc.com', { [field]: [market.id] });
      const altered = JSON.parse(read(file)); altered.availableModels.push('user-added'); write(file, JSON.stringify(altered));
      await assert.rejects(tool.unloadConfig(), /changed since loading/);
      assert.deepEqual(JSON.parse(read(file)), altered); assert.ok(stateStore.getState(tool.name, file));
    } finally { marketModelService.fetchModels = fetch; }
  });
  test(Tool.name + ' handles partial and fully unavailable market models', async () => {
    stateStore.clear(); write(file, '{}'); const tool = new Tool(); const fetch = marketModelService.fetchModels; const warning = uiRenderer.renderWarning;
    let warnings = 0; uiRenderer.renderWarning = () => { warnings++; }; marketModelService.fetchModels = async () => [market];
    try {
      await tool.loadConfig('key', 'https://api.qnaigc.com', { [field]: [market.id, 'gone'] });
      assert.equal(warnings, 1); assert.equal(JSON.parse(read(file)).models.length, 1);
      const before = read(file); marketModelService.fetchModels = async () => [];
      await assert.rejects(tool.loadConfig('key', 'https://api.qnaigc.com', { [field]: ['gone'] })); assert.equal(read(file), before);
      await tool.unloadConfig(); assert.equal(read(file), '{}');
    } finally { marketModelService.fetchModels = fetch; uiRenderer.renderWarning = warning; }
  });
}

test('Buddy tools load concurrently with independent restoration state', async () => {
  stateStore.clear(); const fetch = marketModelService.fetchModels; marketModelService.fetchModels = async () => [market];
  const files = cases.map(([, dir]) => path.join(home, dir, 'models.json'));
  files.forEach((file, index) => write(file, JSON.stringify({ original: index })));
  const tools = [new CodeBuddyTool(), new WorkBuddyTool()];
  try {
    await Promise.all(tools.map((tool, i) => tool.loadConfig('key', 'https://api.qnaigc.com', { [cases[i][2]]: [market.id] })));
    await tools[0].unloadConfig(); assert.ok(stateStore.getState(tools[1].name, files[1]));
    await tools[1].unloadConfig(); files.forEach((file, i) => assert.equal(read(file), JSON.stringify({ original: i })));
  } finally { marketModelService.fetchModels = fetch; }
});

for(const [Tool,dir] of cases)test(Tool.name+' legacy unload reports unchanged configuration',async()=>{
  stateStore.clear();const file=path.join(home,dir,'models.json');const original='{"models":[{"id":"legacy","vendor":"Qiniu","apiKey":"legacy-key"}]}';write(file,original);
  await assert.rejects(new Tool().unloadConfig(),/No restoration record/);assert.equal(read(file),original);
});
