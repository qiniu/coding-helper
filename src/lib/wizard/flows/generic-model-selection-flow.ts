import { t } from '../../i18n.js';
import { configManager } from '../../config.js';
import { promptHelper } from '../ui/prompt-helper.js';
import { uiRenderer } from '../ui/ui-renderer.js';

// 通用客户端（OpenCode、Qwen Code 等）的模型选择：选一个模型，保存到 toolModels[toolName]
// 首次选择时同时设为 defaultModel，供其他通用客户端在 --yes 模式下复用
export async function runGenericModelSelectionFlow(toolName: string, displayName: string): Promise<string | null> {
  const { apiKey, baseUrl } = configManager.getConnection(toolName);
  if (!apiKey) {
    uiRenderer.renderError(t('apikey_not_set'));
    return null;
  }

  const saved = configManager.getModels();
  const previous = saved.toolModels?.[toolName] ?? saved.defaultModel;
  if (previous) {
    uiRenderer.renderHeader();
    uiRenderer.renderHint(t('generic_current_model', { tool: displayName, model: previous }));
    if (await promptHelper.confirm(t('hermes_reuse_previous_selection'), true)) {
      save(toolName, previous);
      return previous;
    }
  }

  const { toolManager } = await import('../../tool-manager.js');
  const tool = toolManager.get(toolName);
  const picked = await promptHelper.pickModel({ tools: tool ? [tool] : [], connection: configManager.getConnection(toolName), title: t('generic_select_model', { tool: displayName }) });
  if (picked === 'back' || !('model' in picked)) return null;
  const selected = picked.model;
  save(toolName, selected);
  return selected;
}

function save(toolName: string, model: string): void {
  const models = configManager.getModels();
  configManager.setModels({
    toolModels: { [toolName]: model },
    ...(models.defaultModel ? {} : { defaultModel: model }),
  });
  configManager.rememberModel(model);
}
