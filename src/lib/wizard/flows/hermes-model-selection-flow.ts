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

export const HERMES_MANUAL_MODEL_VALUE = '__manual_model__';

// 让用户选择 Hermes Agent 的默认模型，返回选中的模型 ID
export async function runHermesModelSelectionFlow(): Promise<string | null> {
  const apiKey = configManager.getApiKey();
  if (!apiKey) {
    uiRenderer.renderError(t('apikey_not_set'));
    return null;
  }

  const previous = configManager.getModels().hermesModel;
  if (previous) {
    uiRenderer.renderHeader();
    uiRenderer.renderHint(t('hermes_current_model', { model: previous }));
    const reuse = await promptHelper.confirm(t('hermes_reuse_previous_selection'), true);
    if (reuse) {
      return previous;
    }
  }

  uiRenderer.renderHeader();
  const spinner = ora(t('hermes_fetching_models')).start();

  let models: MarketModelInfo[];
  try {
    models = await marketModelService.fetchModels(configManager.baseUrl, apiKey);
    spinner.succeed();
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : t('error_unknown');
    spinner.fail(t('hermes_fetch_models_failed', { error: msg }));
    return null;
  }

  if (models.length === 0) {
    uiRenderer.renderWarning(t('model_no_models'));
    return null;
  }

  uiRenderer.renderHeader();

  const choices = buildHermesModelChoices(models);

  const selected = await promptHelper.searchSelect(t('hermes_select_model'), choices);

  if (!selected) {
    uiRenderer.renderWarning(t('hermes_no_model_selected'));
    return null;
  }

  if (selected === HERMES_MANUAL_MODEL_VALUE) {
    const manual = await promptHelper.input(t('model_manual_prompt'));
    const model = manual.trim();
    if (!model) {
      uiRenderer.renderWarning(t('hermes_no_model_selected'));
      return null;
    }
    return model;
  }

  return selected;
}

export function buildHermesModelChoices(
  models: MarketModelInfo[],
): { name: string; value: string }[] {
  return [
    ...models.map(m => ({
      name: `${m.name}${buildCapabilityTags(m)}`,
      value: m.id,
    })),
    {
      name: t('model_manual_input'),
      value: HERMES_MANUAL_MODEL_VALUE,
    },
  ];
}

// 构建模型能力标签字符串（如 " [工具调用] [图像] [思考]"）
function buildCapabilityTags(model: MarketModelInfo): string {
  const caps = getModelCapabilities(model);
  const tags: string[] = [];
  if (caps.toolCall) tags.push(t('codebuddy_model_tag_tool_call'));
  if (caps.images) tags.push(t('codebuddy_model_tag_images'));
  if (caps.reasoning) tags.push(t('codebuddy_model_tag_reasoning'));
  return tags.length > 0 ? ` ${tags.join(' ')}` : '';
}
