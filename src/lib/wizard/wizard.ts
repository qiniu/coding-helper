import { t, i18n } from '../i18n.js';
import { configManager } from '../config.js';
import { uiRenderer } from './ui/ui-renderer.js';
import { runLanguageFlow } from './flows/language-flow.js';
import { runEndpointSelectionFlow } from './flows/endpoint-selection-flow.js';
import { runApiKeyFlow } from './flows/api-key-flow.js';
import { showMainMenu } from './menus/main-menu.js';
import { runToolSetupFlow } from './flows/tool-setup-flow.js';

// Wizard 协调器 - 管理首次运行向导和主菜单
export class Wizard {
  // 运行首次初始化向导
  async runInitWizard(): Promise<boolean> {
    // 清屏后显示欢迎界面（首次使用固定中文提示选择语言）
    uiRenderer.renderHeader();
    uiRenderer.renderWelcome(
      t('welcome'),
      t('welcome_description'),
      t('privacy_notice'),
    );

    // 1. 选择语言
    if (!await runLanguageFlow()) return false;

    // 2. 选择线路
    if (!await runEndpointSelectionFlow()) return false;

    // 3. 输入 API Key
    if (!await runApiKeyFlow()) return false;

    // 4. 选择工具并引导配置（配置模型 → 装载配置 → 提示就绪）
    if (!await runToolSetupFlow()) return false;

    // 初始化完成
    uiRenderer.renderSuccess(t('init_complete'));
    return true;
  }

  // 进入主菜单
  async runMainMenu(): Promise<void> {
    await showMainMenu();
  }

  // 智能入口：首次运行走向导，否则进主菜单
  async run(): Promise<void> {
    // 初始化 i18n
    i18n.init();

    if (configManager.isFirstRun()) {
      if (!await this.runInitWizard()) return;
    }

    // 向导完成后或非首次运行，直接进入主菜单（内部已包含 renderHeader）
    await this.runMainMenu();
  }
}
