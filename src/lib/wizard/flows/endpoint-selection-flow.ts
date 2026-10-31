import { t } from '../../i18n.js';
import { configManager } from '../../config.js';
import { CUSTOM_ENDPOINT, ENDPOINT_DEFINITIONS, normalizeCustomBaseUrl } from '../../endpoints.js';
import { uiRenderer, type StepInfo } from '../ui/ui-renderer.js';
import { theme } from '../ui/theme.js';
import { promptHelper } from '../ui/prompt-helper.js';
import { menuPrompt, textPrompt } from '../ui/prompts.js';
import { modelService } from '../../model-service.js';
import { marketModelService } from '../../market-model-service.js';
import { toolManager } from '../../tool-manager.js';
import { getSyncTargets } from '../../core/tool-service.js';
import { syncAfterChange } from './sync-tools-flow.js';

// 选择线路：当前线路标「当前」，选中时下方显示适用场景；current 为空时不标
export async function pickEndpoint(current?: string, currentBaseUrl?: string): Promise<[string, string | undefined] | undefined> {
  const mark = (id: string): string => id === current ? theme.success(`● ${t('profile_action_use_current')}`) : '';
  const { value, action } = await menuPrompt({ message: t('endpoint_prompt'), escape: true, default: current ?? configManager.getEndpoint(), items: [
    ...Object.entries(ENDPOINT_DEFINITIONS).map(([id, definition]) => ({ value: id, label: t(definition.i18nKey), hint: mark(id), description: theme.subtle(t(`endpoint_desc_${id}`)) })),
    { value: CUSTOM_ENDPOINT, label: t('endpoint_custom_option'), hint: current === CUSTOM_ENDPOINT ? `${mark(CUSTOM_ENDPOINT)}  ${theme.subtle(currentBaseUrl?.replace(/^https?:\/\//, '') ?? '')}` : '',
      description: theme.subtle(t('endpoint_desc_custom')) },
  ] });
  if (action === 'escape') return undefined;
  if (value !== CUSTOM_ENDPOINT) return [value, undefined];
  while (true) {
    const input = await textPrompt({ message: t('endpoint_custom_prompt') });
    if (!input?.trim()) return undefined;
    try { return [CUSTOM_ENDPOINT, normalizeCustomBaseUrl(input)]; }
    catch { uiRenderer.renderError(t('endpoint_custom_invalid', { value: '' })); }
  }
}
export async function runEndpointSelectionFlow(step?: StepInfo): Promise<boolean> {
  uiRenderer.renderPage(t('page_endpoint'), step, t('page_endpoint_hint'));
  const previous = configManager.baseUrl;
  // 首次向导里还没有「当前」线路，不做标记
  const picked = step ? await pickEndpoint() : await pickEndpoint(configManager.getEndpoint(), configManager.baseUrl);
  if (!picked) return false;
  const targets = getSyncTargets(toolManager.getAll());
  configManager.setEndpoint(...picked);
  modelService.clearCache(); marketModelService.clearCache();
  uiRenderer.renderSuccess(t('endpoint_set', { endpoint: configManager.baseUrl }));
  // 有同步结果时等用户看完再回菜单
  if (previous !== configManager.baseUrl && (await syncAfterChange(false, targets)).length) await promptHelper.pressEnter();
  return true;
}
