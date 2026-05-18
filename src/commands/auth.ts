import { t, i18n } from '../lib/i18n.js';
import { configManager } from '../lib/config.js';
import { validateApiKey } from '../lib/api-validator.js';
import { modelService } from '../lib/model-service.js';
import { toolManager } from '../lib/tool-manager.js';
import { uiRenderer } from '../lib/wizard/ui/ui-renderer.js';
import { runApiKeyFlow } from '../lib/wizard/flows/api-key-flow.js';
import { logger } from '../utils/logger.js';
import ora from 'ora';

function resolveToolName(tool: string): string {
  if (tool === 'claude' || tool === 'claude-code') return 'claude-code';
  if (tool === 'codex' || tool === 'openai-codex') return 'codex';
  return tool;
}

// auth 命令 - API Key 管理
export async function authCommand(tokenOrAction?: string): Promise<void> {
  i18n.init();

  // auth revoke - 删除 API Key
  if (tokenOrAction === 'revoke') {
    configManager.revokeApiKey();
    modelService.clearCache();
    uiRenderer.renderSuccess(t('apikey_revoked'));
    return;
  }

  // auth reload <tool> - 重新加载配置到工具
  if (tokenOrAction === 'reload') {
    // 从 process.argv 获取工具名
    const toolName = process.argv[4];
    if (!toolName) {
      uiRenderer.renderError('Usage: coding-helper auth reload <tool>');
      return;
    }
    const tool = toolManager.get(resolveToolName(toolName));
    if (!tool) {
      uiRenderer.renderError(`Unknown tool: ${toolName}`);
      return;
    }
    const apiKey = configManager.getApiKey();
    if (!apiKey) {
      uiRenderer.renderError(t('apikey_not_set'));
      return;
    }
    const models = configManager.getModels();
    await tool.loadConfig(apiKey, configManager.baseUrl, models);
    uiRenderer.renderSuccess(t('tool_config_loaded', { tool: tool.displayName }));
    return;
  }

  // auth <token> - 直接设置 API Key
  if (tokenOrAction) {
    const spinner = ora(t('apikey_validating')).start();
    const result = await validateApiKey(tokenOrAction, configManager.baseUrl);

    if (result.valid) {
      spinner.succeed(t('apikey_valid'));
      configManager.setApiKey(tokenOrAction);
      modelService.clearCache();
      uiRenderer.renderSuccess(t('apikey_saved'));
    } else {
      spinner.fail(t('apikey_invalid', { error: result.error || '' }));
    }
    return;
  }

  // auth（无参数）- 交互式输入
  await runApiKeyFlow();
}
