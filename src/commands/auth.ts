import { t, i18n } from '../lib/i18n.js';
import { configManager } from '../lib/config.js';
import { validateApiKey } from '../lib/api-validator.js';
import { modelService } from '../lib/model-service.js';
import { marketModelService } from '../lib/market-model-service.js';
import { toolManager } from '../lib/tool-manager.js';
import { uiRenderer } from '../lib/wizard/ui/ui-renderer.js';
import { runApiKeyFlow } from '../lib/wizard/flows/api-key-flow.js';
import { promptHelper } from '../lib/wizard/ui/prompt-helper.js';
import ora from 'ora';
import { applyTool } from '../lib/core/tool-service.js';
import { syncAfterChange } from '../lib/wizard/flows/sync-tools-flow.js';

// 拼接已注册工具名称及别名，用于 auth reload 的提示文案
function formatAvailableTools(): string {
  return toolManager
    .getAll()
    .map(tool => {
      const aliases = tool.aliases ?? [];
      return aliases.length > 0 ? `${tool.name} (${aliases.join(', ')})` : tool.name;
    })
    .join(', ');
}

// auth 命令 - API Key 管理
export async function authCommand(tokenOrAction?: string, options: { sync?: boolean } = {}): Promise<void> {
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
    const availableTools = formatAvailableTools();
    if (!toolName) {
      process.exitCode = 1;
      uiRenderer.renderError(t('auth_reload_usage'));
      uiRenderer.renderHint(t('auth_reload_tools', { tools: availableTools }));
      return;
    }
    const tool = toolManager.get(toolName);
    if (!tool) {
      process.exitCode = 1;
      uiRenderer.renderError(t('auth_unknown_tool', { tool: toolName }));
      uiRenderer.renderHint(t('auth_reload_tools', { tools: availableTools }));
      return;
    }
    const apiKey = configManager.getConnection(tool.name).apiKey;
    if (tool.launchOnly) {
      uiRenderer.renderHint(t('setup_reason_launch_only'));
      return;
    }
    if (!apiKey) {
      process.exitCode = 1;
      uiRenderer.renderError(t('apikey_not_set'));
      return;
    }

    try {
      if (tool.name === 'codex') {
        const confirmed = await promptHelper.confirm(t('tool_config_load_confirm', { tool: tool.displayName }));
        if (!confirmed) return;
      }
      const result = await applyTool(tool);
      process.exitCode = result.status === 'success' ? 0 : 1;
      if (result.status !== 'success') throw new Error(t(result.reason ?? 'tool_config_load_failed', { tool: tool.displayName }));
      uiRenderer.renderSuccess(t('tool_config_loaded', { tool: tool.displayName }));
      for (const note of tool.getLoadConfigNotes?.() ?? []) uiRenderer.renderHint(note);
    } catch (err: unknown) {
      process.exitCode = 1;
      uiRenderer.renderError(
        err instanceof Error ? err.message : t('tool_config_load_failed', { tool: tool.displayName }),
      );
      for (const note of tool.getLoadConfigNotes?.() ?? []) uiRenderer.renderHint(note);
    }
    return;
  }

  if (tokenOrAction) {
    const spinner = ora(t('apikey_validating')).start();
    const result = await validateApiKey(tokenOrAction, configManager.baseUrl);

    if (result.valid) {
      spinner.succeed(t('apikey_valid'));
      const changed = configManager.getApiKey() !== tokenOrAction;
      configManager.setApiKey(tokenOrAction);
      modelService.clearCache();
      marketModelService.clearCache();
      uiRenderer.renderSuccess(t('apikey_saved'));
      // 显式 --sync 即使 Key 相同也重试，允许修复上次同步失败的客户端。
      if (options.sync || changed) await syncAfterChange(!!options.sync);
    } else {
      spinner.fail(t('apikey_invalid', { error: result.error || '' }));
      process.exitCode = 1;
    }
    return;
  }

  await runApiKeyFlow(!!options.sync);
}
