import ora from 'ora';
import { t } from '../../i18n.js';
import { configManager } from '../../config.js';
import { validateApiKey } from '../../api-validator.js';
import { promptHelper } from '../ui/prompt-helper.js';
import { uiRenderer } from '../ui/ui-renderer.js';
import { modelService } from '../../model-service.js';

// API Key 输入和验证流程
export async function runApiKeyFlow(): Promise<boolean> {
  uiRenderer.renderHeader();
  // 显示 API Key 获取提示
  uiRenderer.renderHint(t('apikey_hint'));

  // 循环直到成功或用户取消
  while (true) {
    const apiKey = await promptHelper.password(t('apikey_prompt'));

    if (!apiKey.trim()) {
      uiRenderer.renderError(t('apikey_empty'));
      const retry = await promptHelper.confirm(t('apikey_retry'));
      if (!retry) return false;
      uiRenderer.renderHeader();
      uiRenderer.renderHint(t('apikey_hint'));
      continue;
    }

    // 验证 API Key
    const spinner = ora(t('apikey_validating')).start();

    const result = await validateApiKey(apiKey.trim(), configManager.baseUrl);

    if (result.valid) {
      spinner.succeed(t('apikey_valid'));
      configManager.setApiKey(apiKey.trim());
      // 新 API Key 需要清除模型缓存
      modelService.clearCache();
      uiRenderer.renderSuccess(t('apikey_saved'));
      return true;
    }

    spinner.fail(t('apikey_invalid', { error: result.error || '' }));

    const retry = await promptHelper.confirm(t('apikey_retry'));
    if (!retry) return false;
    // 重试前清屏并重新渲染
    uiRenderer.renderHeader();
    uiRenderer.renderHint(t('apikey_hint'));
  }
}
