import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-kimi-code-')));
process.env.HOME = process.env.USERPROFILE = home;
delete process.env.KIMI_CODE_HOME; delete process.env.GROK_HOME;
const { KimiCodeTool, getKimiInstallCommand } = await import('../dist/lib/tools/kimi-code-tool.js');
const { marketModelService } = await import('../dist/lib/market-model-service.js');
const { toolManager } = await import('../dist/lib/tool-manager.js');
const { hasSavedToolModelConfig } = await import('../dist/lib/wizard/menus/tool-menu.js');
const tool = new KimiCodeTool(); tool.getVersion = () => null;
marketModelService.fetchModels = async () => [];
const files = [".kimi-code/config.toml"].map(file => path.join(home, file));
const originals = ["# keep\ndefault_model = \"original\"\n[other]\ncustom = true\n"];
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
const read = file => fs.readFileSync(file, 'utf8');
const load = (key = 'test-key') => tool.loadConfig(key, 'https://api.qnaigc.com', { toolModels: { [tool.name]: 'test/model' } });
test('Kimi appends provider definitions using the existing CRLF style',async()=>{
 const original='default_model="original"\r\n[other]\r\nkeep=true\r\n';write(files[0],original);
 await load();assert.doesNotMatch(read(files[0]),/(?<!\r)\n/);await load('second-key');await tool.unloadConfig();assert.equal(read(files[0]),original);
});
test('Kimi preserves permission and hook arrays and persists image capability',async()=>{
 const {applyKimiConfig}=await import('../dist/lib/tools/kimi-code-tool.js');const {parse}=await import('smol-toml');
 const original='[[permission.rules]]\nrule="keep"\n[[hooks]]\ncommand="echo ok"\n';
 const next=parse(applyKimiConfig(original,'https://api.qnaigc.com','key','vision',32000,{contextWindow:32000,maxOutputTokens:4000,modalities:{input:['text','image'],output:['text']}}));
 assert.deepEqual(next.permission.rules,[{rule:'keep'}]);assert.deepEqual(next.hooks,[{command:'echo ok'}]);assert.deepEqual(next.models['qiniu/vision'].capabilities,['image_in']);
 write(files[0],original);await load();await tool.unloadConfig();assert.equal(read(files[0]),original);
});
test('kimi-code is registered and recognizes saved generic model selection', () => {
  assert.ok(toolManager.get(tool.name));
  assert.equal(hasSavedToolModelConfig(tool, { toolModels: { [tool.name]: 'test/model' } }), true);
});
test('kimi-code restores bytes and refuses corrupt or changed config', async () => {
  files.forEach((file, i) => write(file, originals[i]));
  await load(); await load('second-key');
  assert.match(read(files[0]), /providers.qiniu/); assert.match(read(files[0]), /max_context_size = 128000/);
  await tool.unloadConfig(); files.forEach((file, i) => assert.equal(read(file), originals[i]));
  write(files[0], "broken = [");
  await assert.rejects(load()); assert.equal(read(files[0]), "broken = [");
  write(files[0], originals[0]); await load();
  const applied = read(files[0]); write(files[0], applied + ' ');
  await assert.rejects(load(), /changed/); assert.throws(() => tool.unloadConfig(), /changed/);
  assert.equal(read(files[0]), applied + ' '); write(files[0], applied);
  await tool.unloadConfig();
  files.forEach(file => fs.rmSync(file));
  await load(); await tool.unloadConfig(); files.forEach(file => assert.equal(fs.existsSync(file), false));
});

test('kimi installation and updates use the bundled runtime on every supported host', () => {
  for (const platform of ['darwin', 'linux']) {
    const command = getKimiInstallCommand(platform);
    assert.match(command, /bash -o pipefail/);
    assert.ok(command.includes('https://code.kimi.com/kimi-code/install.sh'));
    assert.ok(!command.includes('npm install'));
  }
  const windows = getKimiInstallCommand('win32');
  assert.match(windows, /^powershell -NoProfile/);
  assert.ok(windows.includes("$ErrorActionPreference = 'Stop'"));
  assert.ok(windows.includes('https://code.kimi.com/kimi-code/install.ps1'));
  assert.equal(tool.installCommand, getKimiInstallCommand());
  assert.equal(tool.updateCommand, tool.installCommand);
});
test('legacy Kimi guidance recommends the compatible install script without writing config', async () => {
  tool.getVersion = () => '1.0.0';
  try {
    await assert.rejects(load(), error => error.message.includes(tool.installCommand));
    files.forEach(file => assert.equal(fs.existsSync(file), false));
  } finally { tool.getVersion = () => null; }
});

test('unload without a restoration record preserves every existing target and reports recovery guidance', () => {
  files.forEach(file => fs.rmSync(file, {force:true}));
  assert.doesNotThrow(() => tool.unloadConfig());
  for (const file of files) {
    write(file, 'legacy credential bytes');
    assert.throws(() => tool.unloadConfig(), /No restoration record.*Configuration is unchanged.*manually/);
    assert.equal(read(file), 'legacy credential bytes');
    fs.rmSync(file);
  }
});
