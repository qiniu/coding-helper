import ora from 'ora';
import { t } from '../../i18n.js';
import { configManager } from '../../config.js';
import {
  marketModelService,
  getModelCapabilities,
  type MarketModelInfo,
} from '../../market-model-service.js';
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

  const current = getCurrentOpenCodeModels();
  if (current.length > 0) {
    uiRenderer.renderHeader();
    uiRenderer.renderHint(
      t('opencode_current_models', { models: current.join(', ') }),
    );
    const reuse = await promptHelper.confirm(t('opencode_reuse_previous_selection'), true);
    if (reuse) {
      return true;
    }
  }

  const spinner = ora(t('model_fetching')).start();
  let models: MarketModelInfo[] = [];
  try {
    models = await marketModelService.fetchModels(configManager.baseUrl, apiKey);
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

  const choices = models.map((m) => ({
    name: `${m.name}${buildCapabilityTags(m)}${current.includes(m.id) ? ' (current)' : ''}`,
    value: m.id,
  }));

  const selected = await promptHelper.checkbox(t('opencode_select_models'), choices);
  if (!selected || selected.length === 0) {
    uiRenderer.renderWarning(t('opencode_no_model_selected'));
    return false;
  }

  configManager.setModels({ opencodeModels: selected, opencodeModel: selected[0] });
  uiRenderer.renderSuccess(t('opencode_config_success', { count: selected.length.toString() }));
  return true;
}

function getCurrentOpenCodeModels(): string[] {
  const models = configManager.getModels();
  if (models.opencodeModels && models.opencodeModels.length > 0) {
    return models.opencodeModels;
  }
  return models.opencodeModel ? [models.opencodeModel] : [];
}

function buildCapabilityTags(model: MarketModelInfo): string {
  const caps = getModelCapabilities(model);
  const tags: string[] = [];
  if (caps.toolCall) tags.push(t('codebuddy_model_tag_tool_call'));
  if (caps.images) tags.push(t('codebuddy_model_tag_images'));
  if (caps.reasoning) tags.push(t('codebuddy_model_tag_reasoning'));
  return tags.length > 0 ? ` ${tags.join(' ')}` : '';
}
