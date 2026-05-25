import ora from 'ora';
import { t } from '../../i18n.js';
import { configManager } from '../../config.js';
import { modelService, type ModelInfo } from '../../model-service.js';
import { promptHelper } from '../ui/prompt-helper.js';
import { uiRenderer } from '../ui/ui-renderer.js';

// OpenCode 模型单选流程
export async function runOpenCodeModelSelectionFlow(): Promise<boolean> {
  uiRenderer.renderHeader();

  const apiKey = configManager.getApiKey();
  if (!apiKey) {
    uiRenderer.renderError(t('apikey_not_set'));
    return false;
  }

  const spinner = ora(t('model_fetching')).start();
  let models: ModelInfo[] = [];
  try {
    models = await modelService.fetchModels(configManager.baseUrl, apiKey);
    spinner.succeed();
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : t('error_unknown');
    spinner.fail(t('model_fetch_failed', { error: msg }));
    // 获取失败时仍允许手动输入
  }

  uiRenderer.renderHeader();

  if (models.length === 0) {
    uiRenderer.renderWarning(t('model_no_models'));
  }

  const current = configManager.getModels().opencodeModel;
  const choices = models.map((m) => ({
    name: m.id + (current === m.id ? ' (current)' : ''),
    value: m.id,
  }));

  const picked = await promptHelper.searchSelect(t('opencode_select_model'), choices, true);
  if (!picked) {
    uiRenderer.renderWarning(t('opencode_no_model_selected'));
    return false;
  }

  configManager.setModels({ opencodeModel: picked });
  uiRenderer.renderSuccess(t('opencode_config_success', { model: picked }));
  return true;
}
