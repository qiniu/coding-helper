import ora from 'ora';
import { t } from '../../i18n.js';
import { configManager } from '../../config.js';
import { marketModelService, getModelCapabilities } from '../../market-model-service.js';
import type { SearchableModel } from '../../core/model-search.js';
import { modelService, type ModelInfo } from '../../model-service.js';
import { promptHelper } from '../ui/prompt-helper.js';
import { uiRenderer } from '../ui/ui-renderer.js';

// 单个模型角色选择（搜索+自动补全）
async function selectModel(
  models: ModelInfo[],
  promptKey: string,
  currentValue?: string,
  metadata = new Map<string, SearchableModel>(),
): Promise<string | undefined> {
  const choices = models.map((m) => ({
    name: m.id + (currentValue === m.id ? ' (current)' : ''),
    value: m.id,
    model: metadata.get(m.id),
  }));

  return promptHelper.searchSelect(t(promptKey), choices, true);
}

// 模型选择流程 (Haiku → Sonnet → Opus → Subagent)
export async function runModelSelectionFlow(): Promise<boolean> {
  uiRenderer.renderHeader();

  // 提示: 七牛 API 支持 Claude 默认模型 ID，自定义配置是可选的
  uiRenderer.renderHint(t('model_skip_hint'));
  const needsCustomModels = await promptHelper.confirm(t('model_skip_prompt'), false);

  if (!needsCustomModels) {
    // 用户选择不配置，清除已有的自定义模型配置
    configManager.setModels({
      claudeCode: {
        haikuModel: undefined,
        sonnetModel: undefined,
        opusModel: undefined,
        subagentModel: undefined,
        useDefaultModels: true,
      },
    });
    uiRenderer.renderSuccess(t('model_saved'));
    return true;
  }

  // 清屏后重新绘制，避免 confirm 行残留
  uiRenderer.renderHeader();

  const { apiKey, baseUrl } = configManager.getConnection('claude-code');
  if (!apiKey) {
    uiRenderer.renderError(t('apikey_not_set'));
    return false;
  }

  // 获取模型列表
  const spinner = ora(t('model_fetching')).start();

  let models: ModelInfo[];
  let metadata = new Map<string, SearchableModel>();
  try {
    models = await modelService.fetchModels(baseUrl, apiKey);
    if (models.length) try {
      const market = await marketModelService.fetchModels(baseUrl, apiKey);
      metadata = new Map(market.map(model => { const caps = getModelCapabilities(model); return [model.id,
        { id: model.id, name: model.name, context: caps.maxInputTokens, toolCall: caps.toolCall, vision: caps.images, reasoning: caps.reasoning }]; }));
    } catch { /* 市场能力不可用时仍允许按标准目录或手动 ID 选择。 */ }
    spinner.succeed();
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : t('error_unknown');
    spinner.fail(t('model_fetch_failed', { error: msg }));
    // 即使获取失败也允许手动输入
    models = [];
  }

  if (models.length === 0) {
    uiRenderer.renderWarning(t('model_no_models'));
  }

  // 清屏后重新绘制，避免 spinner 行残留
  uiRenderer.renderHeader();

  const currentModels = configManager.getModels();
  const currentClaudeCode = currentModels.claudeCode || {};

  // 四步选择: Haiku → Sonnet → Opus → Subagent
  const haikuModel = await selectModel(models, 'model_select_haiku', currentClaudeCode.haikuModel, metadata);
  const sonnetModel = await selectModel(models, 'model_select_sonnet', currentClaudeCode.sonnetModel, metadata);
  const opusModel = await selectModel(models, 'model_select_opus', currentClaudeCode.opusModel, metadata);
  const subagentModel = await selectModel(models, 'model_select_subagent', currentClaudeCode.subagentModel, metadata);

  // 展示配置摘要面板，等待用户确认
  uiRenderer.renderHeader();
  uiRenderer.renderTitle(t('model_confirm_title'));

  const notSet = t('model_confirm_not_set');
  uiRenderer.renderConfigPanel([
    { label: 'Haiku',    value: haikuModel ?? notSet,    configured: !!haikuModel },
    { label: 'Sonnet',   value: sonnetModel ?? notSet,   configured: !!sonnetModel },
    { label: 'Opus',     value: opusModel ?? notSet,     configured: !!opusModel },
    { label: 'Subagent', value: subagentModel ?? notSet, configured: !!subagentModel },
  ]);

  const confirmed = await promptHelper.confirm(t('model_confirm_prompt'), true);
  if (!confirmed) {
    // 用户取消，重新进入模型选择流程
    return runModelSelectionFlow();
  }

  // 保存配置
  configManager.setModels({
    claudeCode: {
      haikuModel,
      sonnetModel,
      opusModel,
      subagentModel,
      useDefaultModels: false,
    },
  });

  uiRenderer.renderSuccess(t('model_saved'));
  return true;
}
