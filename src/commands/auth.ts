import { t, i18n } from '../lib/i18n.js';
import { configManager } from '../lib/config.js';
import { validateApiKey } from '../lib/api-validator.js';
import { modelService } from '../lib/model-service.js';
import { marketModelService } from '../lib/market-model-service.js';
import { toolManager } from '../lib/tool-manager.js';
import { uiRenderer } from '../lib/wizard/ui/ui-renderer.js';
import { runApiKeyFlow } from '../lib/wizard/flows/api-key-flow.js';
import ora from 'ora';

// auth 命令 - API Key 管理
export async function authCommand(tokenOrAction?: string): Promise<void> {
  i18n.init();

  if (tokenOrAction === 'revoke') {
    configManager.revokeApiKey();
    modelService.clearCache();
    marketModelService.clearCache();
    uiRenderer.renderSuccess(t('apikey_revoked'));
    return;
  }

  if (tokenOrAction === 'reload') {
    const toolName = process.argv[4];
    if (!toolName) {
      uiRenderer.renderError(t('auth_reload_usage'));
      uiRenderer.renderHint(t('auth_reload_tools'));
      return;
    }
    const tool = toolManager.get(toolName);
    if (!tool) {
      uiRenderer.renderError(t('auth_unknown_tool', { tool: toolName }));
      uiRenderer.renderHint(t('auth_reload_tools'));
      return;
    }
    const apiKey = configManager.getApiKey();
    if (!apiKey) {
      uiRenderer.renderError(t('apikey_not_set'));
      return;
    }

    try {
      await tool.loadConfig(apiKey, configManager.baseUrl, configManager.getModels());
      uiRenderer.renderSuccess(t('tool_config_loaded', { tool: tool.displayName }));
    } catch (err: unknown) {
      uiRenderer.renderError(
        err instanceof Error ? err.message : t('tool_config_load_failed', { tool: tool.displayName }),
      );
    }
    return;
  }

  if (tokenOrAction) {
    const spinner = ora(t('apikey_validating')).start();
    const result = await validateApiKey(tokenOrAction, configManager.baseUrl);

    if (result.valid) {
      spinner.succeed(t('apikey_valid'));
      configManager.setApiKey(tokenOrAction);
      modelService.clearCache();
      marketModelService.clearCache();
      uiRenderer.renderSuccess(t('apikey_saved'));
    } else {
      spinner.fail(t('apikey_invalid', { error: result.error || '' }));
    }
    return;
  }

  await runApiKeyFlow();
}
