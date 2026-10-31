import { t } from '../../i18n.js';
import { configManager } from '../../config.js';
import { CUSTOM_ENDPOINT, ENDPOINT_DEFINITIONS, normalizeCustomBaseUrl } from '../../endpoints.js';
import { promptHelper } from '../ui/prompt-helper.js';
import { uiRenderer } from '../ui/ui-renderer.js';
import { modelService } from '../../model-service.js';
import { marketModelService } from '../../market-model-service.js';
import { toolManager } from '../../tool-manager.js';
import { getSyncTargets } from '../../core/tool-service.js';
import { syncAfterChange } from './sync-tools-flow.js';

// 线路选择流程
export async function runEndpointSelectionFlow(): Promise<void> {
  uiRenderer.renderHeader();
  const choices = Object.entries(ENDPOINT_DEFINITIONS).map(([id, def]) => ({
    name: t(def.i18nKey),
    value: id,
  }));

  choices.push({ name: t('endpoint_custom_option'), value: CUSTOM_ENDPOINT });
  const endpoint = await promptHelper.select<string>(t('endpoint_prompt'), choices);

  const previous = configManager.baseUrl;
  let baseUrl: string | undefined;
  if (endpoint === CUSTOM_ENDPOINT) {
    while (baseUrl === undefined) {
      const input = await promptHelper.input(t('endpoint_custom_prompt'));
      if (!input.trim()) return;
      try { baseUrl = normalizeCustomBaseUrl(input); }
      catch { uiRenderer.renderError(t('endpoint_custom_invalid', { value: '' })); }
    }
  }
  // 替换自定义地址注册表前捕获仍指向旧线路的客户端。
  const targets = getSyncTargets(toolManager.getAll());
  configManager.setEndpoint(endpoint, baseUrl);
  // 切换线路后清除模型缓存
  modelService.clearCache();
  marketModelService.clearCache();
  uiRenderer.renderSuccess(t('endpoint_set', { endpoint: endpoint === CUSTOM_ENDPOINT ? configManager.baseUrl : t(ENDPOINT_DEFINITIONS[endpoint].i18nKey) }));
  if (previous !== configManager.baseUrl) await syncAfterChange(false, targets);
}
