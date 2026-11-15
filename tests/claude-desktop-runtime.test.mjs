import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readRuntimeConfig } from '../dist/lib/desktop-gateway/runtime.js';
import { DESKTOP_ROUTE } from '../dist/lib/desktop-gateway/server.js';

const fileName = new URL('../dist/lib/desktop-gateway/runtime.js', import.meta.url);
test('background runtime reads private config and serves an authenticated model catalog', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-runtime-'));
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({port, upstream:'https://api.qnaigc.com', apiKey:'test-key', localToken:'test-token', routes:{[DESKTOP_ROUTE]:'qwen'}}), {mode:0o600});
  const child = spawn(process.execPath, [fileName.pathname, file], {stdio:['ignore','ignore','pipe']});
  try {
    let response;
    for (let i = 0; i < 100; i++) {
      try { response = await fetch(`http://127.0.0.1:${port}/v1/models`, {headers:{authorization:'Bearer test-token'}}); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 20)); }
    }
    assert.equal(response?.status, 200);
    assert.equal((await response.json()).data[0].id, DESKTOP_ROUTE);
    assert.equal((await fetch(`http://127.0.0.1:${port}/v1/models`)).status, 401);
  } finally {
    const done = once(child, 'exit'); child.kill('SIGTERM'); await done;
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
test('runtime refuses non-private config, symlinks and invalid configuration', {skip:process.platform === 'win32'}, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-config-'));
  try {
    const file = path.join(dir,'config.json'); fs.writeFileSync(file,'{}',{mode:0o644});
    assert.throws(()=>readRuntimeConfig(file), /inaccessible/);
    fs.chmodSync(file,0o600); assert.throws(()=>readRuntimeConfig(file), /Invalid/);
    const link = path.join(dir,'link'); fs.symlinkSync(file,link); assert.throws(()=>readRuntimeConfig(link), /regular file/);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('background manager starts and stops only the matching authenticated service', async () => {
  const { startDesktopGateway, stopDesktopGateway, isDesktopGatewayRunning } = await import('../dist/lib/desktop-gateway/background.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-background-'));
  const probe = net.createServer(); probe.listen(0,'127.0.0.1'); await once(probe,'listening'); const port=probe.address().port; await new Promise(resolve=>probe.close(resolve));
  const config={port,upstream:'https://api.qnaigc.com',apiKey:'key',localToken:'secret',routes:{[DESKTOP_ROUTE]:'model'}};
  const file=path.join(dir,'config.json');fs.writeFileSync(file,JSON.stringify(config),{mode:0o600});
  try {
    await startDesktopGateway(file,fileName.pathname); assert.equal(await isDesktopGatewayRunning(config),true);
    assert.equal(await isDesktopGatewayRunning({...config,apiKey:'different'}),false);
    assert.equal(await stopDesktopGateway({...config,localToken:'wrong'}),false);
    await startDesktopGateway(file,fileName.pathname);
    assert.equal(await stopDesktopGateway(config),true);
  } finally { await stopDesktopGateway(config);fs.rmSync(dir,{recursive:true,force:true}); }
});
