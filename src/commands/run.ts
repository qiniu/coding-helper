import spawn from 'cross-spawn';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { findCommand } from '../utils/find-command.js';
import { t, i18n } from '../lib/i18n.js';
import { configManager } from '../lib/config.js';
import { toolManager } from '../lib/tool-manager.js';
import { uiRenderer } from '../lib/wizard/ui/ui-renderer.js';
import { LauncherShutdown } from '../utils/launcher-shutdown.js';

// 只向子进程注入配置，不修改客户端文件；参数以数组传递，不能交给 shell 解释
export async function runCommand(toolName: string, args: string[]): Promise<void> {
  i18n.init();
  const tool = toolManager.get(toolName);
  if (!tool?.getLaunchEnv) {
    uiRenderer.renderError(t('run_unsupported', { tool: toolName }));
    uiRenderer.renderHint(t('run_supported_tools', { tools: toolManager.getAll().filter(item => item.getLaunchEnv).map(item => item.name).join(', ') }));
    process.exitCode = 1; return;
  }
  const connection = configManager.getConnection(tool.name);
  const apiKey = connection.apiKey;
  if (!apiKey) { uiRenderer.renderError(t('apikey_not_set')); process.exitCode = 1; return; }
  let temporary: string | undefined;
  try {
    const variables = tool.getLaunchEnv(apiKey, connection.baseUrl, configManager.getModels());
    if (tool.isInstalled() === false) throw new Error(t('tool_not_installed', { tool: tool.displayName, command: tool.installCommand }));
    let passArgs = args[0] === '--' ? args.slice(1) : args;
    if (tool.getLaunchSettings) {
      if (passArgs.some(arg => arg === '--settings' || arg.startsWith('--settings='))) throw new Error('The launcher manages session settings; do not pass --settings.');
      temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-helper-launch-'));
      const settings = path.join(temporary, 'settings.json');
      fs.writeFileSync(settings, JSON.stringify(tool.getLaunchSettings(apiKey, connection.baseUrl, configManager.getModels())), {mode:0o600});
      passArgs = ['--settings', settings, ...passArgs];
    }
    const executable = findCommand(tool.command, tool.searchPaths) ?? tool.command;
    const environment = { ...process.env, ...variables };
    // 工具用 undefined 清除继承值；node-pty 会将未删除的属性转成字符串 "undefined"。
    for (const key of Object.keys(environment)) {
      if (environment[key] === undefined) delete environment[key];
    }
    if (process.platform !== 'win32' && process.stdin.isTTY && process.stdout.isTTY) {
      const { launchPty } = await import('../utils/launch-pty.js');
      await launchPty(executable, passArgs, environment); return;
    }
    // 无交互终端时独立会话可使父PID/父进程组信号只转发一次。
    const child = spawn(executable, passArgs, { stdio: 'inherit', env: environment, shell: false, detached: process.platform !== 'win32' });
    let shutdown: NodeJS.Signals | undefined;
    const forward = (signal: NodeJS.Signals): void => { shutdown = signal; child.kill(signal); };
    const interrupt = () => forward('SIGINT');
    const terminate = () => forward('SIGTERM');
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => { const number = signal ? os.constants.signals[signal as keyof typeof os.constants.signals] : undefined; process.exitCode = code ?? (number ? 128 + number : 1); resolve(); });
      });
    } finally { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); }
    if (shutdown) { const error = new LauncherShutdown(shutdown); process.exitCode = error.exitCode; throw error; }
  } catch (error) { if (error instanceof LauncherShutdown) throw error; uiRenderer.renderError(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
  finally { if (temporary) fs.rmSync(temporary, {recursive:true,force:true}); }
}
