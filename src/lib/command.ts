import { runCommand } from '../commands/run.js';
import { setupCommand } from '../commands/setup.js';
import { quickCommand, type QuickOptions } from '../commands/quick.js';
import { Command } from 'commander';
import { authCommand, doctorCommand, langShowCommand, langSetCommand, statusCommand, restoreCommand } from '../commands/index.js';
import { Wizard } from './wizard/wizard.js';
import { i18n } from './i18n.js';
import { toolManager } from './tool-manager.js';
import { showToolMenu } from './wizard/menus/tool-menu.js';
import { showMainMenu } from './wizard/menus/main-menu.js';
import { VERSION } from './version.js';

function resolveToolName(tool: string): string {
  if (tool === 'claude' || tool === 'claude-code') return 'claude-code';
  if (tool === 'codex' || tool === 'openai-codex') return 'codex';
  return tool;
}

// 创建并配置 Commander 程序
export function createProgram(): Command {
  const program = new Command();

  program
    .name('coding-helper')
    .description('CLI tool for configuring AI coding assistants with Qiniu API endpoints')
    .version(VERSION);

  // 默认行为（无子命令）：首次运行触发向导，否则进入主菜单
  program
    .argument('[tool]', 'tool name or alias for quick configuration')
    .argument('[values...]', 'API key and model ID in either order')
    .option('--context <tokens>', 'context cap for selected tools: 64k, 1m or auto')
    .option('--intl', 'prefer the international endpoint')
    .option('--json', 'print quick configuration results as JSON')
    .option('--key <key>', 'explicit API key, including non-sk formats')
    .option('--model <id>', 'explicit model ID to avoid positional ambiguity')
    .option('--dry-run', 'preview quick configuration without writing files')
    .option('--no-save', 'write client settings without saving helper connection or models')
    .action(async (tool: string | undefined, values: string[], options: QuickOptions) => {
      if (tool) { await quickCommand(tool, values, options); return; }
      const wizard = new Wizard();
      await wizard.run();
    });

  // init - 强制重新初始化
  program
    .command('init')
    .description('Run initialization wizard')
    .action(async () => {
      const wizard = new Wizard();
      i18n.init();
      await wizard.runInitWizard();
      await wizard.runMainMenu();
    });

  // auth - API Key 管理
  program
    .command('auth [token]')
    .description('Manage API Key')
    .option('--sync', 'also update clients still configured for Qiniu')
    .action(async (token: string | undefined, options: { sync?: boolean }) => {
      await authCommand(token, options);
    });

  // status - 只读查询安装与配置状态
  program.command('setup')
    .description('Configure selected or installed coding tools')
    .option('--tools <names>', 'comma-separated tool names or aliases')
    .option('-y, --yes', 'skip interactive tool and model selection')
    .option('--json', 'print results as JSON')
    .option('--key-stdin', 'read an API key from standard input')
    .option('--dry-run', 'preview files without writing client settings or journals')
    .action(async (options: import('../commands/setup.js').SetupOptions) => { await setupCommand(options); });

  // status - 只读查询安装与配置状态
  program.command('status')
    .description('Show coding tool installation and Qiniu configuration status')
    .option('--json', 'print status as JSON')
    .action((options: { json?: boolean }) => { statusCommand(options); });

  // restore - 根据原有事务记录还原，未记录的旧配置由适配器提示恢复方法。
  program.command('restore [tools]')
    .description('Restore previous client settings using saved restoration records')
    .option('-y, --yes', 'skip confirmation; required for non-interactive use')
    .action(async (tools: string | undefined, options: { yes?: boolean }) => { await restoreCommand(tools, options); });

  // doctor - 健康检查
  program
    .command('doctor')
    .description('Run health check')
    .action(async () => {
      await doctorCommand();
    });

  // lang - 语言管理
  const langCmd = program
    .command('lang')
    .description('Manage language settings');

  langCmd
    .command('show')
    .description('Show current language')
    .action(() => {
      langShowCommand();
    });

  langCmd
    .command('set <locale>')
    .description('Set language (zh_CN / en_US)')
    .action((locale: string) => {
      langSetCommand(locale);
    });

  program.enablePositionalOptions().command('run <tool> [args...]')
    .description('Launch a tool with Qiniu environment variables')
    .passThroughOptions().allowUnknownOption().allowExcessArguments()
    .action(async (tool: string, args: string[]) => { await runCommand(tool, args); });

  // enter - 进入菜单
  program
    .command('enter [tool]')
    .description('Enter main menu or tool configuration')
    .action(async (tool?: string) => {
      i18n.init();

      if (tool) {
        // 处理工具名称别名
        const toolName = resolveToolName(tool);
        const toolInstance = toolManager.get(toolName);
        if (toolInstance) {
          await showToolMenu(toolInstance);
        } else {
          console.error(`Unknown tool: ${tool}`);
          process.exit(1);
        }
      } else {
        await showMainMenu();
      }
    });

  return program;
}
