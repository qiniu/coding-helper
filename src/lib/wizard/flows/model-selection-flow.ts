import { t } from '../../i18n.js';
import { configManager } from '../../config.js';
import { promptHelper } from '../ui/prompt-helper.js';
import { uiRenderer } from '../ui/ui-renderer.js';

// 单个模型角色选择（搜索+自动补全）
async function selectModel(promptKey: string, currentValue?: string): Promise<string | undefined> {
  const { toolManager } = await import('../../tool-manager.js');
  const tool = toolManager.get('claude-code');
  const picked = await promptHelper.pickModel({ tools: tool ? [tool] : [], connection: configManager.getConnection('claude-code'), title: t(promptKey), current: currentValue, allowSkip: true });
  return picked !== 'back' && 'model' in picked ? picked.model : undefined;
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
      slotModels: { 'claude-code': {} },
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

  const currentModels = configManager.getModels();
  const currentClaudeCode = currentModels.claudeCode || {};

  // 四步选择: Haiku → Sonnet → Opus → Subagent
  const haikuModel = await selectModel('model_select_haiku', currentClaudeCode.haikuModel);
  const sonnetModel = await selectModel('model_select_sonnet', currentClaudeCode.sonnetModel);
  const opusModel = await selectModel('model_select_opus', currentClaudeCode.opusModel);
  const subagentModel = await selectModel('model_select_subagent', currentClaudeCode.subagentModel);

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

  const recent = sonnetModel ?? opusModel ?? haikuModel;
  if (recent) configManager.rememberModel(recent);
  uiRenderer.renderSuccess(t('model_saved'));
  return true;
}
