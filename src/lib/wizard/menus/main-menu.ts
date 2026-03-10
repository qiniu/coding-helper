import { t } from '../../i18n.js';
import { promptHelper } from '../ui/prompt-helper.js';
import { uiRenderer } from '../ui/ui-renderer.js';
import { theme } from '../ui/theme.js';
import { runLanguageFlow } from '../flows/language-flow.js';
import { runEndpointSelectionFlow } from '../flows/endpoint-selection-flow.js';
import { runApiKeyFlow } from '../flows/api-key-flow.js';
import { showToolMenu } from './tool-menu.js';
import { toolManager } from '../../tool-manager.js';
import { configManager } from '../../config.js';
import { logger } from '../../../utils/logger.js';
import chalk from 'chalk';

// 主菜单操作
type MainMenuAction =
  | 'language'
  | 'endpoint'
  | 'apikey'
  | 'tools'
  | 'clear_config'
  | 'update'
  | 'exit';

// 主菜单
export async function showMainMenu(): Promise<void> {
  while (true) {
    uiRenderer.renderHeader();

    uiRenderer.renderTitle(t('menu_main_title'));

    const action = await promptHelper.select<MainMenuAction>(t('menu_select_action'), [
      { name: `${theme.icon('◆')} ${t('menu_configure_language')}`, value: 'language' },
      { name: `${theme.icon('◇')} ${t('menu_configure_endpoint')}`, value: 'endpoint' },
      { name: `${theme.icon('◈')} ${t('menu_configure_apikey')}`, value: 'apikey' },
      { name: `${theme.icon('▸')} ${t('menu_configure_tools')}`, value: 'tools' },
      { name: `${theme.dimIcon('▪')} ${t('menu_clear_config')}`, value: 'clear_config' },
      { name: `${theme.dimIcon('△')} ${t('menu_update_helper')}`, value: 'update' },
      { name: `${theme.dimIcon('◁')} ${t('menu_exit')}`, value: 'exit' },
    ]);

    switch (action) {
      case 'language':
        await runLanguageFlow();
        break;
      case 'endpoint':
        await runEndpointSelectionFlow();
        break;
      case 'apikey':
        await runApiKeyFlow();
        break;
      case 'tools':
        await showToolSelector();
        break;
      case 'clear_config':
        if (await handleClearConfig()) return;
        break;
      case 'update':
        await updateHelper();
        break;
      case 'exit':
        return;
    }
  }
}

// 工具选择器（当有多个工具时选择）
async function showToolSelector(): Promise<void> {
  const tools = toolManager.getAll();

  uiRenderer.renderHeader();
  uiRenderer.renderTitle(t('menu_configure_tools'));

  const choices = tools.map((tool) => ({
    name: tool.displayName,
    value: tool.name,
  }));

  const toolName = await promptHelper.select<string>(t('menu_select_action'), choices);
  const tool = toolManager.get(toolName);
  if (tool) {
    await showToolMenu(tool);
  }
}

// 更新 Coding Helper
async function updateHelper(): Promise<void> {
  logger.info(t('update_running'));
  const { execSync } = await import('node:child_process');
  try {
    execSync('npm install -g qiniu-coding-helper@latest', { stdio: 'inherit' });
    uiRenderer.renderSuccess(t('update_latest'));
  } catch {
    uiRenderer.renderError(t('error_unknown'));
  }
}

// 清除配置，成功返回 true
async function handleClearConfig(): Promise<boolean> {
  uiRenderer.renderHeader();  // 清屏，与其他选项保持一致
  const confirmed = await promptHelper.confirm(t('clear_config_confirm'), false);
  if (!confirmed) return false;

  configManager.clearConfig();
  uiRenderer.renderHeader();  // 清屏并显示更新后的配置状态
  uiRenderer.renderSuccess(t('clear_config_success'));
  return true;
}
