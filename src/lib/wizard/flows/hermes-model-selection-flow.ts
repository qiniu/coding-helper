import { t } from '../../i18n.js';
import { configManager } from '../../config.js';
import {
  getModelCapabilities,
  type MarketModelInfo,
} from '../../market-model-service.js';
import { promptHelper, MANUAL_MODEL_VALUE, type ModelChoice } from '../ui/prompt-helper.js';
import { uiRenderer } from '../ui/ui-renderer.js';

export const HERMES_MANUAL_MODEL_VALUE = MANUAL_MODEL_VALUE;

// 让用户选择 Hermes Agent 的默认模型，返回选中的模型 ID
export async function runHermesModelSelectionFlow(): Promise<string | null> {
  const { apiKey, baseUrl } = configManager.getConnection('hermes');
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
      configManager.rememberModel(previous);
      return previous;
    }
  }

  const { toolManager } = await import('../../tool-manager.js');
  const tool = toolManager.get('hermes');
  const picked = await promptHelper.pickModel({ tools: tool ? [tool] : [], connection: configManager.getConnection('hermes'), title: t('hermes_select_model') });
  if (picked === 'back' || !('model' in picked)) return null;
  configManager.rememberModel(picked.model);
  return picked.model;
}

export function buildHermesModelChoices(
  models: MarketModelInfo[],
): ModelChoice[] {
  return [
    ...models.map(m => ({
      name: `${m.name}${buildCapabilityTags(m)}`,
      value: m.id,
      model: { id: m.id, context: getModelCapabilities(m).maxInputTokens, toolCall: getModelCapabilities(m).toolCall, vision: getModelCapabilities(m).images, reasoning: getModelCapabilities(m).reasoning },
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
