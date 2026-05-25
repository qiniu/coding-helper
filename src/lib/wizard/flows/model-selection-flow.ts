import ora from 'ora';
import { t } from '../../i18n.js';
import { configManager } from '../../config.js';
import { modelService, type ModelInfo } from '../../model-service.js';
import { promptHelper } from '../ui/prompt-helper.js';
import { uiRenderer } from '../ui/ui-renderer.js';

// 单个模型角色选择（搜索+自动补全）
async function selectModel(
  models: ModelInfo[],
  promptKey: string,
  currentValue?: string,
): Promise<string | undefined> {
  const choices = models.map((m) => ({
    name: m.id + (currentValue === m.id ? ' (current)' : ''),
    value: m.id,
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
      haikuModel: undefined,
      sonnetModel: undefined,
      opusModel: undefined,
      subagentModel: undefined,
      claudeCodeUseDefaultModels: true,
    });
    uiRenderer.renderSuccess(t('model_saved'));
    return true;
  }

  // 清屏后重新绘制，避免 confirm 行残留
  uiRenderer.renderHeader();

  const apiKey = configManager.getApiKey();
  if (!apiKey) {
    uiRenderer.renderError(t('apikey_not_set'));
    return false;
  }

  // 获取模型列表
  const spinner = ora(t('model_fetching')).start();

  let models: ModelInfo[];
  try {
    models = await modelService.fetchModels(configManager.baseUrl, apiKey);
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

  // 四步选择: Haiku → Sonnet → Opus → Subagent
  const haikuModel = await selectModel(models, 'model_select_haiku', currentModels.haikuModel);
  const sonnetModel = await selectModel(models, 'model_select_sonnet', currentModels.sonnetModel);
  const opusModel = await selectModel(models, 'model_select_opus', currentModels.opusModel);
  const subagentModel = await selectModel(models, 'model_select_subagent', currentModels.subagentModel);

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
    haikuModel,
    sonnetModel,
    opusModel,
    subagentModel,
    claudeCodeUseDefaultModels: false,
  });

  uiRenderer.renderSuccess(t('model_saved'));
  return true;
}
