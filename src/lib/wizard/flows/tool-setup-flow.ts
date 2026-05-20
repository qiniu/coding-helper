import { t } from '../../i18n.js';
import { configManager } from '../../config.js';
import { toolManager } from '../../tool-manager.js';
import { promptHelper } from '../ui/prompt-helper.js';
import { uiRenderer } from '../ui/ui-renderer.js';
import type { ITool } from '../../tools/base-tool.js';

async function setupTool(tool: ITool): Promise<void> {
  // 用户取消模型配置时跳过后续装载与就绪提示，避免误报"配置成功"
  const completed = await tool.runModelConfigFlow();
  if (!completed) return;

  const apiKey = configManager.getApiKey();
  if (apiKey) {
    const models = configManager.getModels();
    try {
      await tool.loadConfig(apiKey, configManager.baseUrl, models);
      uiRenderer.renderHeader();
      uiRenderer.renderSuccess(t('tool_config_loaded', { tool: tool.displayName }));
    } catch (err: unknown) {
      uiRenderer.renderHeader();
      uiRenderer.renderError(
        err instanceof Error ? err.message : t('tool_config_load_failed', { tool: tool.displayName }),
      );
      await promptHelper.pressEnter();
      return;
    }
  }

  uiRenderer.renderSuccess(t('tool_setup_ready', { tool: tool.displayName }));
  await promptHelper.pressEnter();
}

// 初始化向导专用：选择工具 → 引导配置
export async function runToolSetupFlow(): Promise<void> {
  const tools = toolManager.getAll();

  uiRenderer.renderHeader();
  uiRenderer.renderTitle(t('menu_configure_tools'));

  const choices = tools.map((tool) => ({
    name: tool.displayName,
    value: tool.name,
  }));

  const toolName = await promptHelper.select<string>(t('menu_select_action'), choices);
  const tool = toolManager.get(toolName);
  if (!tool) return;

  await setupTool(tool);
}
