import spawn from 'cross-spawn';
async function rejectsFailedProvider() {
  const file = getMinimaxConfigFile();
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, '# original\ndefaultModel: original\n');
  const original = fs.readFileSync(file, 'utf8');
  const saved = spawn.sync;
  try {
    for (const failure of [{status: 1}, {status: null, signal: 'SIGTERM'}, {status: 0, error: Error('secret-key')}]) {
      spawn.sync = () => failure;
      await assert.rejects(new MinimaxCodeTool().loadConfig('secret-key', 'https://api.qnaigc.com', {defaultModel: 'test/model'}), error => !error.message.includes('secret-key'));
      assert.equal(fs.readFileSync(file, 'utf8'), original);
    }
  } finally { spawn.sync = saved; }
}
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import childProcess from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'minimax-'));process.env.HOME=process.env.USERPROFILE=home;delete process.env.MINIMAX_DATA_DIR;delete process.env.MAVIS_DATA_DIR;
const {MinimaxCodeTool,getMinimaxConfigFile}=await import('../dist/lib/tools/minimax-code-tool.js');const {marketModelService}=await import('../dist/lib/market-model-service.js');marketModelService.fetchModels=async()=>[];
test('legacy provider ignoring data overrides writes only to isolated HOME and cannot change user files', async () => {
  const file=getMinimaxConfigFile();fs.mkdirSync(path.dirname(file),{recursive:true});
  const original='# keep\ndefaultModel: original\n';fs.writeFileSync(file,original);
  const previous=spawn.sync;let stage,childHome;
  spawn.sync=(_command,_args,options)=>{
    stage=options.env.MINIMAX_DATA_DIR;childHome=options.env.HOME;
    assert.notEqual(childHome,home);assert.equal(options.env.USERPROFILE,childHome);assert.equal(options.cwd,stage);
    for(const key of ['XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_CACHE_HOME','XDG_STATE_HOME','APPDATA','LOCALAPPDATA'])assert.ok(options.env[key].startsWith(childHome+path.sep));
    assert.equal(options.env.HOMEDRIVE+options.env.HOMEPATH,childHome);
    const result=childProcess.spawnSync(process.execPath,['-e',`const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const dir=path.join(os.homedir(),'.minimax');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'config.yaml'),'legacy fallback write');`],options);
    assert.equal(result.status,0);assert.equal(fs.readFileSync(path.join(childHome,'.minimax','config.yaml'),'utf8'),'legacy fallback write');
    return result;
  };
  try{
    await assert.rejects(new MinimaxCodeTool().loadConfig('secret-key','https://api.qnaigc.com',{defaultModel:'test/model'}),/staged provider/);
    assert.equal(fs.readFileSync(file,'utf8'),original);assert.equal(process.env.HOME,home);assert.equal(fs.existsSync(stage),false);
  }finally{spawn.sync=previous;}
});
test('MiniMax rejects nonzero exits, signals and spawn errors without applying staged config', rejectsFailedProvider);
test('MiniMax parsing errors never echo credential lines from source or staged YAML',async()=>{
 const file=getMinimaxConfigFile();fs.mkdirSync(path.dirname(file),{recursive:true});const broken='apiKey: "secret-parse-key\n';fs.writeFileSync(file,broken);
 const tool=new MinimaxCodeTool();const check=error=>error.message.includes('Cannot parse MiniMax')&&!error.message.includes('secret-parse-key');
 await assert.rejects(tool.loadConfig('key','https://api.qnaigc.com',{defaultModel:'test/model'}),check);assert.equal(fs.readFileSync(file,'utf8'),broken);
 fs.writeFileSync(file,'{}');const saved=spawn.sync;
 spawn.sync=(_cmd,_args,options)=>{fs.writeFileSync(path.join(options.env.MINIMAX_DATA_DIR,'config.yaml'),broken);return {status:0};};
 try{await assert.rejects(tool.loadConfig('key','https://api.qnaigc.com',{defaultModel:'test/model'}),check);assert.equal(fs.readFileSync(file,'utf8'),'{}');}finally{spawn.sync=saved;}
});
test('MiniMax passes image input capability to provider configuration',async()=>{
 const file=getMinimaxConfigFile();fs.writeFileSync(file,'{}');const saved=spawn.sync,fetch=marketModelService.fetchModels;let seen=false;
 marketModelService.fetchModels=async()=>[{id:'test/model',features:[],model_constraints:{context_length:32768,max_tokens:8192},architecture:{input_modalities:['text','image'],output_modalities:['text'],function_calling:{supported:false},reasoning:{supported:false}}}];
 spawn.sync=(_cmd,args)=>{seen=args.includes('--support-image');return {status:1};};
 try{await assert.rejects(new MinimaxCodeTool().loadConfig('key','https://api.qnaigc.com',{defaultModel:'test/model'}));assert.equal(seen,true);assert.equal(fs.readFileSync(file,'utf8'),'{}');}
 finally{spawn.sync=saved;marketModelService.fetchModels=fetch;}
});
test('MiniMax accepts image models only after verifying the persisted capability',async()=>{
 const file=getMinimaxConfigFile();fs.writeFileSync(file,'{}');const saved=spawn.sync,fetch=marketModelService.fetchModels;
 marketModelService.fetchModels=async()=>[{id:'test/model',features:[],model_constraints:{context_length:32768,max_tokens:8192},architecture:{input_modalities:['text','image'],output_modalities:['text'],function_calling:{supported:false},reasoning:{supported:false}}}];
 let supported=false;
 spawn.sync=(_cmd,args,options)=>{assert.ok(args.includes('--support-image'));fs.writeFileSync(path.join(options.env.MINIMAX_DATA_DIR,'config.yaml'),JSON.stringify({custom_provider:{qiniu:{api:'openai-completions',options:{baseURL:'https://api.qnaigc.com/v1',apiKey:'key'},models:{'test/model':{capabilities:{support_image:supported}}}}},defaultModel:'custom_provider:qiniu/test/model'}));return {status:0};};
 try{const tool=new MinimaxCodeTool();await assert.rejects(tool.loadConfig('key','https://api.qnaigc.com',{defaultModel:'test/model'}),/image capability/);assert.equal(fs.readFileSync(file,'utf8'),'{}');supported=true;await tool.loadConfig('key','https://api.qnaigc.com',{defaultModel:'test/model'});tool.unloadConfig();assert.equal(fs.readFileSync(file,'utf8'),'{}');}
 finally{spawn.sync=saved;marketModelService.fetchModels=fetch;}
});
test('MiniMax stages official provider writes and restores original; failures never alter user config or echo key',async()=>{const file=getMinimaxConfigFile();fs.mkdirSync(path.dirname(file),{recursive:true});const original='# keep\ndefaultModel: original\n';fs.writeFileSync(file,original);const exec=spawn.sync;const tool=new MinimaxCodeTool();let stage;
spawn.sync=(command,args,options)=>{assert.equal(path.basename(command),'mcode');assert.deepEqual(args.slice(0,2),['provider','add']);assert.equal(args.includes('secret-key'),false);assert.equal(options.env.QINIU_API_KEY,'secret-key');stage=options.env.MINIMAX_DATA_DIR;assert.doesNotMatch(fs.readFileSync(path.join(stage,'config.yaml'),'utf8'), /qiniu:/);assert.notEqual(stage,path.dirname(file));assert.equal(options.env.MAVIS_DATA_DIR,stage);fs.writeFileSync(path.join(stage,'config.yaml'),'custom_provider:\n  qiniu: {api: openai-completions, options: {baseURL: "https://api.qnaigc.com/v1", apiKey: secret-key}, models: {"test/model": {}}}\ndefaultModel: custom_provider:qiniu/test/model\n');return {status:0,stdout:'',stderr:''};};syncBuiltinESMExports();
try{await tool.loadConfig('secret-key','https://api.qnaigc.com',{defaultModel:'test/model'});assert.equal(fs.existsSync(stage),false);await tool.loadConfig('secret-key','https://api.qnaigc.com',{defaultModel:'test/model'});tool.unloadConfig();assert.equal(fs.readFileSync(file,'utf8'),original);spawn.sync=()=>{throw Error('secret-key');};syncBuiltinESMExports();await assert.rejects(tool.loadConfig('secret-key','https://api.qnaigc.com',{defaultModel:'test/model'}),error=>!error.message.includes('secret-key'));assert.equal(fs.readFileSync(file,'utf8'),original);}finally{spawn.sync=exec;syncBuiltinESMExports();}});


test('MiniMax success exit without matching staged provider never overwrites user configuration', async () => {
  const file = getMinimaxConfigFile(); const original = fs.readFileSync(file, 'utf8');
  const exec = spawn.sync;
  spawn.sync = (_command, _args, options) => {
    fs.writeFileSync(path.join(options.env.MINIMAX_DATA_DIR, 'config.yaml'), 'custom_provider: {qiniu: {options: {baseURL: wrong}}}\ndefaultModel: custom_provider:qiniu/test/model\n'); return {status:0,stdout:'',stderr:''};
  }; syncBuiltinESMExports();
  try { await assert.rejects(new MinimaxCodeTool().loadConfig('secret-key', 'https://api.qnaigc.com', {defaultModel:'test/model'}), /does not match/); }
  finally { spawn.sync = exec; syncBuiltinESMExports(); }
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('MiniMax unload without a restoration record preserves legacy credentials and reports recovery guidance', () => {
  const file=getMinimaxConfigFile(); const tool=new MinimaxCodeTool();
  fs.rmSync(file,{force:true}); assert.doesNotThrow(()=>tool.unloadConfig());
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'legacy credential bytes');
  assert.throws(()=>tool.unloadConfig(),/No restoration record.*Configuration is unchanged.*manually/);
  assert.equal(fs.readFileSync(file,'utf8'),'legacy credential bytes');
});

test('MiniMax shows progress before slow metadata and provider work without exposing credentials', async () => {
  const {logger}=await import('../dist/utils/logger.js');const {i18n}=await import('../dist/lib/i18n.js');i18n.init('en_US');
  const info=logger.info,fetch=marketModelService.fetchModels,exec=spawn.sync;const messages=[];logger.info=message=>messages.push(message);
  const file=getMinimaxConfigFile();fs.rmSync(file,{force:true});
  marketModelService.fetchModels=async()=>{assert.ok(messages.some(m=>m.includes('model limits')));return [];};
  spawn.sync=(_file,_args,options)=>{assert.ok(messages.some(m=>m.includes('90 seconds')));fs.writeFileSync(path.join(options.env.MINIMAX_DATA_DIR,'config.yaml'),'custom_provider:\n  qiniu: {api: openai-completions, options: {baseURL: "https://api.qnaigc.com/v1", apiKey: secret-key}, models: {"test/model": {}}}\ndefaultModel: custom_provider:qiniu/test/model\n');return {status:0};};syncBuiltinESMExports();
  try {const tool=new MinimaxCodeTool();await tool.loadConfig('secret-key','https://api.qnaigc.com',{defaultModel:'test/model'});assert.ok(messages.some(m=>m.includes('Validating')));assert.ok(messages.some(m=>m.includes('configuration applied')));assert.ok(messages.every(m=>!m.includes('secret-key')));tool.unloadConfig();}
  finally{logger.info=info;marketModelService.fetchModels=fetch;spawn.sync=exec;syncBuiltinESMExports();}
});
