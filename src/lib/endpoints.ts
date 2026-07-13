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

// 根据端点 ID 获取 base URL
export function getBaseUrl(endpointId: string): string {
  const endpoint = ENDPOINT_DEFINITIONS[endpointId];
  if (!endpoint) {
    return ENDPOINT_DEFINITIONS[DEFAULT_ENDPOINT].baseUrl;
  }
  return endpoint.baseUrl;
}
