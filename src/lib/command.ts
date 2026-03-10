import { Command } from 'commander';
import { authCommand, doctorCommand, langShowCommand, langSetCommand } from '../commands/index.js';
import { Wizard } from './wizard/wizard.js';
import { i18n } from './i18n.js';
import { toolManager } from './tool-manager.js';
import { showToolMenu } from './wizard/menus/tool-menu.js';
import { showMainMenu } from './wizard/menus/main-menu.js';
import { VERSION } from './version.js';

// 创建并配置 Commander 程序
export function createProgram(): Command {
  const program = new Command();

  program
    .name('coding-helper')
    .description('CLI tool for configuring AI coding assistants with Qiniu API endpoints')
    .version(VERSION);

  // 默认行为（无子命令）：首次运行触发向导，否则进入主菜单
  program
    .action(async () => {
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
    .action(async (token?: string) => {
      await authCommand(token);
    });

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

  // enter - 进入菜单
  program
    .command('enter [tool]')
    .description('Enter main menu or tool configuration')
    .action(async (tool?: string) => {
      i18n.init();

      if (tool) {
        // 处理工具名称别名
        const toolName = tool === 'claude' || tool === 'claude-code' ? 'claude-code' : tool;
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
