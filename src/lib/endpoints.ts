// 线路定义 - 七牛 API 端点
export interface EndpointDefinition {
  id: string;
  // i18n key，用于获取显示名称（如 'endpoint_china'）
  i18nKey: string;
  baseUrl: string;
}

export const ENDPOINT_DEFINITIONS: Record<string, EndpointDefinition> = {
  china: {
    id: 'china',
    i18nKey: 'endpoint_china',
    baseUrl: 'https://api.qnaigc.com',
  },
  international: {
    id: 'international',
    i18nKey: 'endpoint_international',
    baseUrl: 'https://api.modelink.ai',
  },
};

export const DEFAULT_ENDPOINT = 'china';

// 旧线路 id 到新线路 id 的兼容映射（历史配置迁移）
// 老用户 config.yaml 里可能存有已移除的 id，读取时规范化到对应新线路
const LEGACY_ENDPOINT_ALIASES: Record<string, string> = {
  qiniu: 'china',           // 旧 openai.qiniu.com → 国内线路 api.qnaigc.com
  modelink: 'international', // 旧 api.modelink.ai → 海外线路（地址不变）
};

// 规范化端点 id：已知旧 id 映射到新 id，其余原样返回
export function normalizeEndpointId(endpointId: string): string {
  return LEGACY_ENDPOINT_ALIASES[endpointId] ?? endpointId;
}

// 根据端点 ID 获取 base URL
export function getBaseUrl(endpointId: string): string {
  const endpoint = ENDPOINT_DEFINITIONS[normalizeEndpointId(endpointId)];
  if (!endpoint) {
    return ENDPOINT_DEFINITIONS[DEFAULT_ENDPOINT].baseUrl;
  }
  return endpoint.baseUrl;
}
