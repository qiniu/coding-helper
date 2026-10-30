import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import childProcess from 'node:child_process';import {EventEmitter} from 'node:events';import {syncBuiltinESMExports} from 'node:module';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'run-test-'));process.env.HOME=process.env.USERPROFILE=home;
const {runCommand}=await import('../dist/commands/run.js');const {configManager}=await import('../dist/lib/config.js');const {toolManager}=await import('../dist/lib/tool-manager.js');const {createProgram}=await import('../dist/lib/command.js');
test('launcher passes literal args env and exit status; writes no client config and cleans signal listeners',async()=>{configManager.setApiKey('test-key');const base=process.listenerCount('SIGINT');const original=childProcess.spawn;const fake={name:'test-run',command:'fake',displayName:'Fake',installCommand:'install',isInstalled:()=>true,getLaunchEnv:(key)=>({TEST_KEY:key})};toolManager.register(fake);let observed;
childProcess.spawn=(file,args,options)=>{observed={file,args,options};const child=new EventEmitter();child.kill=()=>true;queueMicrotask(()=>child.emit('exit',7,null));return child;};syncBuiltinESMExports();try{await createProgram().parseAsync(['node','helper','run','test-run','--','--resume','$(echo literal)']);assert.deepEqual(observed.args,['--resume','$(echo literal)']);assert.equal(observed.options.shell,false);assert.equal(observed.options.env.TEST_KEY,'test-key');assert.equal(process.exitCode,7);assert.equal(process.listenerCount('SIGINT'),base);assert.deepEqual(fs.readdirSync(home),['.coding-helper']);}finally{childProcess.spawn=original;syncBuiltinESMExports();process.exitCode=0;}});
test('unsupported tool fails without launching a process',async()=>{await runCommand('unsupported',[]);assert.equal(process.exitCode,1);process.exitCode=0;});
test('parent shutdown bypasses menu continuation and retains the signal exit status',async()=>{
 const {launchTool}=await import('../dist/lib/wizard/menus/tool-menu.js');const {promptHelper}=await import('../dist/lib/wizard/ui/prompt-helper.js');const {LauncherShutdown}=await import('../dist/utils/launcher-shutdown.js');
 const original=childProcess.spawn,enter=promptHelper.pressEnter;let kills=0;
 const tool={name:'shutdown-test',displayName:'Test',command:'fake',installCommand:'unused',launchOnly:true,isInstalled:()=>true,getLaunchEnv:()=>({})};toolManager.register(tool);configManager.setApiKey('test-key');
 promptHelper.pressEnter=()=>assert.fail('shutdown must not wait for Enter');
 childProcess.spawn=()=>{const child=new EventEmitter();child.kill=signal=>{kills++;assert.equal(signal,'SIGTERM');queueMicrotask(()=>child.emit('exit',null,signal));};queueMicrotask(()=>process.emit('SIGTERM'));return child;};syncBuiltinESMExports();
 try{process.exitCode=9;await assert.rejects(launchTool(tool),error=>error instanceof LauncherShutdown&&error.exitCode===143);assert.equal(process.exitCode,143);assert.equal(kills,1);}
 finally{childProcess.spawn=original;syncBuiltinESMExports();promptHelper.pressEnter=enter;process.exitCode=0;}
});
test('session settings are private, excluded from argv, and removed after child exit',async()=>{
 const original=childProcess.spawn;let settingsFile;
 const tool={name:'settings-test',displayName:'Settings test',command:'fake',installCommand:'unused',isInstalled:()=>true,getLaunchEnv:()=>({}),getLaunchSettings:()=>({env:{TEST_KEY:'fake-private-key'}})};toolManager.register(tool);
 childProcess.spawn=(_file,args)=>{assert.equal(args[0],'--settings');settingsFile=args[1];assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile,'utf8')),{env:{TEST_KEY:'fake-private-key'}});assert.equal(args.some(arg=>arg.includes('fake-private-key')),false);if(process.platform!=='win32')assert.equal(fs.statSync(settingsFile).mode&0o777,0o600);const child=new EventEmitter();child.kill=()=>true;queueMicrotask(()=>child.emit('exit',0,null));return child;};syncBuiltinESMExports();
 try{await runCommand(tool.name,['--resume']);assert.equal(fs.existsSync(settingsFile),false);}finally{childProcess.spawn=original;syncBuiltinESMExports();process.exitCode=0;}
});
test('all child termination signals retain exit codes',{skip:process.platform==='win32'},async()=>{
 const original=childProcess.spawn;let kills=0;
 try{for(const signal of ['SIGKILL','SIGHUP','SIGINT']){
  childProcess.spawn=()=>{const child=new EventEmitter();child.kill=()=>{kills++;};queueMicrotask(()=>{child.emit('exit',null,signal);});return child;};syncBuiltinESMExports();
  await runCommand('test-run',[]);assert.equal(process.exitCode,128+os.constants.signals[signal]);
 }assert.equal(kills,0);}finally{childProcess.spawn=original;syncBuiltinESMExports();process.exitCode=0;}
});


test('run forwards client help and version flags without interpreting them as helper options', async () => {
  const original = childProcess.spawn; let observed;
  childProcess.spawn = (file, args) => { observed = args; const child = new EventEmitter(); child.kill = () => true; queueMicrotask(() => child.emit('exit', 0, null)); return child; };
  syncBuiltinESMExports();
  try {
    for (const flag of ['--help', '--version', '-h', '-V']) {
      const program = createProgram().exitOverride();
      program.commands.forEach(command => command.exitOverride());
      await program.parseAsync(['node', 'helper', 'run', 'test-run', flag]);
      assert.deepEqual(observed, [flag]);
    }
  } finally { childProcess.spawn = original; syncBuiltinESMExports(); process.exitCode = 0; }
});

test('spawn errors and child termination clean listeners and preserve failure status', async () => {
  const original = childProcess.spawn; const count = process.listenerCount('SIGINT');
  try {
    for (const mode of ['error', 'signal']) {
      childProcess.spawn = () => { const child = new EventEmitter(); child.kill = () => true; queueMicrotask(() => mode === 'error' ? child.emit('error', Error('cannot start')) : child.emit('exit', null, 'SIGTERM')); return child; };
      syncBuiltinESMExports(); await runCommand('test-run', []);
      assert.equal(process.exitCode, mode === 'error' ? 1 : 143); assert.equal(process.listenerCount('SIGINT'), count);
    }
  } finally { childProcess.spawn = original; syncBuiltinESMExports(); process.exitCode = 0; }
});

test('launch-only menu retains errors until Enter and restores the parent exit status', async () => {
  const {launchTool}=await import('../dist/lib/wizard/menus/tool-menu.js');const {promptHelper}=await import('../dist/lib/wizard/ui/prompt-helper.js');const {uiRenderer}=await import('../dist/lib/wizard/ui/ui-renderer.js');
  const spawnOriginal=childProcess.spawn,enter=promptHelper.pressEnter,getKey=configManager.getApiKey,renderError=uiRenderer.renderError;const initialExit=process.exitCode;
  const fake={name:'menu-launch-test',displayName:'Menu tool',command:'missing-menu-test',installCommand:'install',launchOnly:true,isInstalled:()=>true,getLaunchEnv:()=>({})};toolManager.register(fake);
  try {
    for(const mode of ['missing-key','not-installed','child-exit']) {
      const messages=[];let pauses=0,spawns=0;process.exitCode=9;configManager.getApiKey=()=>mode==='missing-key'?undefined:'test-key';fake.isInstalled=()=>mode!=='not-installed';
      uiRenderer.renderError=message=>messages.push(message);promptHelper.pressEnter=async()=>{pauses++;assert.ok(messages.length);assert.equal(process.exitCode,9);};
      childProcess.spawn=()=>{spawns++;const child=new EventEmitter();child.kill=()=>true;queueMicrotask(()=>child.emit('exit',7,null));return child;};syncBuiltinESMExports();
      await launchTool(fake);assert.equal(pauses,1);assert.equal(process.exitCode,9);assert.equal(spawns,mode==='child-exit'?1:0);
    }
  } finally {childProcess.spawn=spawnOriginal;syncBuiltinESMExports();promptHelper.pressEnter=enter;configManager.getApiKey=getKey;uiRenderer.renderError=renderError;process.exitCode=initialExit;}
});
