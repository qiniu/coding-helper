import { execSync } from 'node:child_process';
import spawn from 'cross-spawn';
import { findCommand } from './find-command.js';
import type { ITool } from '../lib/tools/base-tool.js';

// 客户端自更新使用已发现的完整路径；安装脚本仅在菜单确认后调用。
export function executeToolUpdate(tool: Pick<ITool, 'command' | 'searchPaths' | 'updateCommand' | 'installCommand'>): void {
  const command = tool.updateCommand ?? tool.installCommand;
  const parts = command.trim().split(/\s+/);
  if (parts[0] === tool.command && parts.every(part => /^[A-Za-z0-9_./:@=+-]+$/.test(part))) {
    const executable = findCommand(tool.command, tool.searchPaths);
    if (!executable) throw new Error('Cannot locate tool update executable: ' + tool.command);
    const result = spawn.sync(executable, parts.slice(1), { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Tool update failed with exit status ' + result.status);
  } else execSync(command, { stdio: 'inherit' });
}
