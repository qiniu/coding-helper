import { isCatalogAccessError } from './model-catalog-error.js';
import type { Connection } from '../config.js';
import { marketModelService, getModelCapabilities, type MarketModelInfo } from '../market-model-service.js';
import { modelService } from '../model-service.js';

export type CatalogModel = MarketModelInfo | { id: string; name: string; owned_by?: string; capabilitiesUnknown: true };

// 市场能力信息不可用时保留标准目录，未知能力不伪装成接口返回的标签。
export async function fetchModelCatalog(connection: Pick<Connection, 'apiKey' | 'baseUrl'>): Promise<CatalogModel[]> {
  if (!connection.apiKey) throw new Error('API key is not set');
  try { return await marketModelService.fetchModels(connection.baseUrl, connection.apiKey); }
  catch (error) {
    if (isCatalogAccessError(error)) throw error;
    return (await modelService.fetchModels(connection.baseUrl, connection.apiKey)).map(model => ({
      id: model.id, name: model.id, owned_by: model.owned_by, capabilitiesUnknown: true,
    }));
  }
}

// 写入端沿用选择页的回退规则。双接口都不可用时保留用户明确填写的 ID；
// 可用目录返回空或模型已下线时仍按原规则拒绝，避免把清空目录误判为离线。
export async function configurationModelCatalog(connection: Pick<Connection, 'apiKey' | 'baseUrl'>, requestedIds: string[]): Promise<CatalogModel[]> {
  if (!connection.apiKey) throw new Error('API key is not set');
  try { return await fetchModelCatalog(connection); }
  catch (error) {
    if (isCatalogAccessError(error)) throw error;
    return requestedIds.map(id => ({ id, name: id, capabilitiesUnknown: true }));
  }
}

// 这些是客户端离线配置所需的保守参数，不用于选择页的接口元数据展示。
export function configurationCapabilities(model: CatalogModel) {
  return 'capabilitiesUnknown' in model
    ? { toolCall: true, images: false, reasoning: false, maxInputTokens: 200000, maxOutputTokens: 8192 }
    : getModelCapabilities(model);
}
