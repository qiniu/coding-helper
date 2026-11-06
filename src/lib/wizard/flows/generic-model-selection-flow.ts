import ora from 'ora';
import { t } from '../../i18n.js';
import { configManager } from '../../config.js';
import { marketModelService, type MarketModelInfo } from '../../market-model-service.js';
import { promptHelper } from '../ui/prompt-helper.js';
import { uiRenderer } from '../ui/ui-renderer.js';
import { HERMES_MANUAL_MODEL_VALUE, buildHermesModelChoices } from './hermes-model-selection-flow.js';

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

  uiRenderer.renderHeader();
  const spinner = ora(t('hermes_fetching_models')).start();
  let models: MarketModelInfo[];
  try {
    models = await marketModelService.fetchModels(baseUrl, apiKey);
    spinner.succeed();
  } catch (error: unknown) {
    spinner.fail(t('hermes_fetch_models_failed', { error: error instanceof Error ? error.message : t('error_unknown') }));
    return null;
  }

  uiRenderer.renderHeader();
  let selected = await promptHelper.searchSelect(
    t('generic_select_model', { tool: displayName }),
    buildHermesModelChoices(models),
  );
  if (selected === HERMES_MANUAL_MODEL_VALUE) {
    selected = (await promptHelper.input(t('model_manual_prompt'))).trim() || undefined;
  }
  if (!selected) {
    uiRenderer.renderWarning(t('hermes_no_model_selected'));
    return null;
  }
  save(toolName, selected);
  return selected;
}

function save(toolName: string, model: string): void {
  const models = configManager.getModels();
  configManager.setModels({
    toolModels: { [toolName]: model },
    ...(models.defaultModel ? {} : { defaultModel: model }),
  });
}
