import { t } from '../../i18n.js';
import { configManager } from '../../config.js';
import { toolManager } from '../../tool-manager.js';
import { promptHelper } from '../ui/prompt-helper.js';
import { uiRenderer } from '../ui/ui-renderer.js';
import { runModelSelectionFlow } from './model-selection-flow.js';
import type { ITool } from '../../tools/base-tool.js';

// 对单个工具执行引导式配置：配置模型 → 装载配置 → 提示就绪
async function setupTool(tool: ITool): Promise<void> {
  // 步骤 1: 配置模型（全局模型选择，结果存入 configManager）
  await runModelSelectionFlow();

  // 步骤 2: 装载配置到工具（通过 ITool 接口，不关心具体实现）
  const apiKey = configManager.getApiKey();
  if (apiKey) {
    const models = configManager.getModels();
    try {
      await tool.loadConfig(apiKey, configManager.baseUrl, models);
      uiRenderer.renderHeader();
      uiRenderer.renderSuccess(t('tool_config_loaded', { tool: tool.displayName }));
    } catch {
      uiRenderer.renderHeader();
      uiRenderer.renderError(t('tool_config_load_failed', { tool: tool.displayName }));
    }
  }

  // 步骤 3: 提示可以开始使用
  uiRenderer.renderSuccess(t('tool_setup_ready', { tool: tool.displayName }));
  await promptHelper.pressEnter();
}

// 初始化向导专用：选择工具 → 引导配置
export async function runToolSetupFlow(): Promise<void> {
  const tools = toolManager.getAll();

  // 选择要配置的工具
  uiRenderer.renderHeader();
  uiRenderer.renderTitle(t('menu_configure_tools'));

  const choices = tools.map((tool) => ({
    name: tool.displayName,
    value: tool.name,
  }));

  const toolName = await promptHelper.select<string>(t('menu_select_action'), choices);
  const tool = toolManager.get(toolName);
  if (!tool) return;

  // 对选中的工具执行引导式配置
  await setupTool(tool);
}
