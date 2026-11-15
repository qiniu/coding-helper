import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readRuntimeConfig, DESKTOP_ROUTE, GATEWAY_RUNTIME_VERSION } from '../dist/lib/desktop-gateway/server.js';
import { startDesktopGateway, stopDesktopGateway, probeGateway, choosePort, isPortFree } from '../dist/lib/desktop-gateway/background.js';
import { autostartContent, autostartPath, AUTOSTART_LABEL } from '../dist/lib/desktop-gateway/autostart.js';

const bundled = new URL('../dist/lib/desktop-gateway/server.js', import.meta.url);
async function freePort() {
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); return port;
}
// 与安装后一致：把编译产物复制成独立的 gateway.mjs，并在同目录放私有配置。
function install(dir, config) {
  const script = path.join(dir, 'gateway.mjs');
  fs.copyFileSync(bundled, script);
  const file = path.join(dir, 'gateway.json');
  fs.writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
  return { script, file };
}
const base = port => ({ version: GATEWAY_RUNTIME_VERSION, port, upstream: 'https://api.qnaigc.com', apiKey: 'test-key', localToken: 'test-token', routes: { [DESKTOP_ROUTE]: 'qwen' } });

test('installed copy runs standalone, logs without secrets and exits on the authenticated stop request', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-runtime-'));
  const port = await freePort();
  const { script, file } = install(dir, base(port));
  const child = spawn(process.execPath, [script, file], { stdio: 'ignore' });
  const exited = once(child, 'exit');
  try {
    let response;
    for (let i = 0; i < 100 && !response; i++) {
      try { response = await fetch(`http://127.0.0.1:${port}/v1/models`, { headers: { authorization: 'Bearer test-token' } }); }
      catch { await new Promise(resolve => setTimeout(resolve, 30)); }
    }
    assert.equal(response?.status, 200);
    assert.equal((await response.json()).data[0].id, DESKTOP_ROUTE);
    assert.equal((await fetch(`http://127.0.0.1:${port}/_coding_helper/stop`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${port}/_coding_helper/stop`, { method: 'POST', headers: { authorization: 'Bearer test-token' } })).status, 200);
    const [code] = await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error('gateway did not exit')), 5000))]);
    assert.equal(code, 0);
    const log = fs.readFileSync(path.join(dir, 'gateway.log'), 'utf8');
    assert.match(log, new RegExp(`listening on 127\\.0\\.0\\.1:${port}`));
    assert.doesNotMatch(log, /test-key|test-token/);
  } finally {
    if (child.exitCode === null) { child.kill('SIGTERM'); await exited; }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runtime refuses non-private config, symlinks and invalid configuration', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-config-'));
  try {
    const file = path.join(dir, 'config.json'); fs.writeFileSync(file, JSON.stringify(base(1234)), { mode: 0o644 });
    assert.throws(() => readRuntimeConfig(file), /inaccessible/);
    fs.chmodSync(file, 0o600); assert.equal(readRuntimeConfig(file).port, 1234);
    for (const bad of [{}, { ...base(1234), version: 99 }, { ...base(1234), upstream: 'http://example.com' }, { ...base(1234), routes: { 'gpt-5': 'x' } }, { ...base(0) }]) {
      fs.writeFileSync(file, JSON.stringify(bad)); assert.throws(() => readRuntimeConfig(file), /Invalid|HTTPS/);
    }
    const link = path.join(dir, 'link'); fs.symlinkSync(file, link); assert.throws(() => readRuntimeConfig(link), /regular file/);
    assert.throws(() => readRuntimeConfig('relative.json'), /absolute/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('background manager distinguishes current, stale, free and foreign listeners', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-background-'));
  const port = await freePort();
  const config = base(port);
  const { script, file } = install(dir, config);
  try {
    assert.equal(await probeGateway(config), 'free');
    await startDesktopGateway(script, file);
    assert.equal(await probeGateway(config), 'current');
    assert.equal(await probeGateway({ ...config, routes: { [DESKTOP_ROUTE]: 'other' } }), 'stale');
    assert.equal(await probeGateway({ ...config, localToken: 'wrong' }), 'occupied');
    assert.equal(await choosePort(config), port);
    assert.equal(await stopDesktopGateway({ ...config, localToken: 'wrong' }), false);
    // 重复启动同一配置不会产生第二个进程。
    await startDesktopGateway(script, file);
    // 配置改变后启动会先停止旧网关，再以新配置运行。
    const next = { ...config, routes: { [DESKTOP_ROUTE]: 'next-model' } };
    fs.writeFileSync(file, JSON.stringify(next), { mode: 0o600 });
    await startDesktopGateway(script, file);
    assert.equal(await probeGateway(next), 'current');
    assert.equal(await stopDesktopGateway(next), true);
    assert.equal(await isPortFree(port), true);
    assert.equal(await stopDesktopGateway(next), false);
  } finally { await stopDesktopGateway(config).catch(() => {}); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('foreign port owners are never stopped and a new port is chosen', async () => {
  const foreign = net.createServer(socket => socket.destroy());
  foreign.listen(0, '127.0.0.1'); await once(foreign, 'listening');
  const port = foreign.address().port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-foreign-'));
  const { script, file } = install(dir, base(port));
  try {
    assert.equal(await probeGateway(base(port)), 'occupied');
    await assert.rejects(startDesktopGateway(script, file), /another program/);
    assert.notEqual(await choosePort(base(port)), port);
    assert.equal(foreign.listening, true);
  } finally { foreign.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('autostart entries launch the installed gateway at login on each platform', () => {
  assert.equal(autostartPath('darwin', '/Users/u', {}), `/Users/u/Library/LaunchAgents/${AUTOSTART_LABEL}.plist`);
  assert.equal(autostartPath('linux', '/home/u', { XDG_CONFIG_HOME: '/xdg' }), '/xdg/autostart/coding-helper-claude-desktop-gateway.desktop');
  assert.equal(autostartPath('linux', '/home/u', { XDG_CONFIG_HOME: 'relative' }), '/home/u/.config/autostart/coding-helper-claude-desktop-gateway.desktop');
  assert.match(autostartPath('win32', '/home/u', { APPDATA: '/roaming' }), /Startup[\\/]coding-helper-claude-desktop-gateway\.vbs$/);
  const plist = autostartContent('darwin', '/usr/local/bin/node', '/Users/a&b/.coding-helper/claude-desktop/gateway.mjs', '/Users/a&b/.coding-helper/claude-desktop/gateway.json');
  assert.match(plist, /<string>\/Users\/a&amp;b\/\.coding-helper\/claude-desktop\/gateway\.mjs<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  const desktop = autostartContent('linux', '/usr/bin/node', '/home/u/.coding-helper/claude-desktop/gateway.mjs', '/home/u/.coding-helper/claude-desktop/gateway.json');
  assert.match(desktop, /^Exec="\/usr\/bin\/node" "\/home\/u\/\.coding-helper\/claude-desktop\/gateway\.mjs" "\/home\/u\/\.coding-helper\/claude-desktop\/gateway\.json"$/m);
  assert.throws(() => autostartContent('linux', '/usr/bin/node', '/home/$(id)/gateway.mjs', '/x.json'), /unsupported/);
  const vbs = autostartContent('win32', 'C:\\Program Files\\nodejs\\node.exe', 'C:\\Users\\u\\gateway.mjs', 'C:\\Users\\u\\gateway.json');
  assert.match(vbs, /Run """C:\\Program Files\\nodejs\\node\.exe"" ""C:\\Users\\u\\gateway\.mjs"" ""C:\\Users\\u\\gateway\.json""", 0, False/);
  assert.throws(() => autostartContent('freebsd', 'node', 'a', 'b'), /not supported/);
});
