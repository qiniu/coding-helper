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

// 让用户多选 CodeBuddy/WorkBuddy 要配置的模型，返回选中的模型 ID 列表
export async function runCodeBuddyWorkBuddyModelSelectionFlow(
  reuseExisting = false,
): Promise<string[] | null> {
  const apiKey = configManager.getApiKey();
  if (!apiKey) {
    uiRenderer.renderError(t('apikey_not_set'));
    return null;
  }

  if (reuseExisting) {
    const previous = configManager.getModels().codeBuddyModels;
    if (previous && previous.length > 0) {
      uiRenderer.renderHeader();
      uiRenderer.renderHint(
        t('codebuddy_current_models', { models: previous.join(', ') }),
      );
      const reuse = await promptHelper.confirm(t('codebuddy_reuse_previous_selection'), true);
      if (reuse) {
        return previous;
      }
    }
  }

  uiRenderer.renderHeader();
  const spinner = ora(t('codebuddy_fetching_models')).start();

  let models: MarketModelInfo[];
  try {
    models = await marketModelService.fetchModels(configManager.baseUrl, apiKey);
    spinner.succeed();
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : t('error_unknown');
    spinner.fail(t('codebuddy_fetch_models_failed', { error: msg }));
    return null;
  }

  if (models.length === 0) {
    uiRenderer.renderWarning(t('model_no_models'));
    return null;
  }

  uiRenderer.renderHeader();

  const choices = models.map(m => ({
    name: `${m.name}${buildCapabilityTags(m)}`,
    value: m.id,
  }));

  const selected = await promptHelper.checkbox(t('codebuddy_select_models'), choices);

  if (!selected || selected.length === 0) {
    uiRenderer.renderWarning(t('codebuddy_no_models_selected'));
    return null;
  }

  return selected;
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
