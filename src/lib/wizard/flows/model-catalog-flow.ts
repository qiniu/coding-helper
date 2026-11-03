import ora from 'ora';
import type { Connection } from '../../config.js';
import { isCatalogAccessError } from '../../core/model-catalog-error.js';
import { fetchModelCatalog, type CatalogModel } from '../../core/model-catalog.js';
import { marketModelService } from '../../market-model-service.js';
import { modelService } from '../../model-service.js';
import { t } from '../../i18n.js';
import { uiRenderer, type StepInfo } from '../ui/ui-renderer.js';
import { menuPrompt } from '../ui/prompts.js';

type CatalogResult = { kind: 'catalog'; models: CatalogModel[] } | { kind: 'manual' } | { kind: 'back' };

// 请求失败时停留在模型步骤，默认重试；用户可以手动输入或明确返回，不以成功退出掩盖失败。
export async function loadModelCatalog(connection: Connection, title: string, step?: StepInfo): Promise<CatalogResult> {
  while (true) {
    uiRenderer.renderPage(title, step, undefined, connection);
    const spinner = ora({ text: t('hermes_fetching_models'), indent: 2 }).start();
    let empty = false;
    let accessDenied = false;
    try {
      const models = await fetchModelCatalog(connection);
      if (models.length) return { kind: 'catalog', models };
      empty = true;
    } catch (error) {
      // 使用固定提示，不打印网关原文；拒绝访问不能转为手动配置成功。
      accessDenied = isCatalogAccessError(error);
    }
    finally { spinner.stop(); }
    if (accessDenied) uiRenderer.renderError(t('model_catalog_access_denied'));
    else if (empty) uiRenderer.renderWarning(t('model_no_models'));
    else uiRenderer.renderError(t('model_catalog_failed'));
    const result = await menuPrompt({
      message: t('model_catalog_recovery'), default: accessDenied ? 'back' : 'retry', escape: true,
      items: [
        ...(!accessDenied ? [
          { value: 'retry', label: t('model_catalog_retry') },
          { value: 'manual', label: t('model_manual_input') },
        ] : []),
        { value: 'back', label: t('tool_back') },
      ],
    });
    if (result.action === 'escape' || result.value === 'back') return { kind: 'back' };
    if (result.value === 'manual') return { kind: 'manual' };
    marketModelService.clearCache();
    modelService.clearCache();
  }
}
