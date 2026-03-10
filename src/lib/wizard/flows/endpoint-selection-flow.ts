import { t } from '../../i18n.js';
import { configManager } from '../../config.js';
import { ENDPOINT_DEFINITIONS } from '../../endpoints.js';
import { promptHelper } from '../ui/prompt-helper.js';
import { uiRenderer } from '../ui/ui-renderer.js';
import { modelService } from '../../model-service.js';

// 线路选择流程
export async function runEndpointSelectionFlow(): Promise<void> {
  uiRenderer.renderHeader();
  const choices = Object.entries(ENDPOINT_DEFINITIONS).map(([id, def]) => ({
    name: t(def.i18nKey),
    value: id,
  }));

  const endpoint = await promptHelper.select<string>(t('endpoint_prompt'), choices);

  configManager.setEndpoint(endpoint);
  // 切换线路后清除模型缓存
  modelService.clearCache();
  uiRenderer.renderSuccess(t('endpoint_set', { endpoint: t(ENDPOINT_DEFINITIONS[endpoint].i18nKey) }));
}
