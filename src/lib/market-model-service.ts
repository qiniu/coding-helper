// 市场模型信息接口（详细版本，包含能力信息）
export interface MarketModelInfo {
  id: string;
  name: string;
  description: string;
  features: string[];
  model_constraints: {
    context_length: number;
    max_tokens: number;
    max_completion_tokens: number;
    max_default_completion_tokens: number;
    max_chain_of_thought_length: number;
  };
  architecture: {
    input_modalities: string[];
    output_modalities: string[];
    function_calling: {
      supported: boolean;
    };
    schema_output: {
      supported: boolean;
    };
    reasoning: {
      supported: boolean;
    };
    content_cache: {
      supported: boolean;
    };
  };
  issuer: {
    name: string;
    avatar: string;
    model_page: string;
  };
}

// 七牛 features 字段中的能力标签
const FEATURE_TOOL_CALL = '工具调用';
const FEATURE_REASONING = '深度思考';
const MODALITY_IMAGE = 'image';

// 当 model_constraints 字段为 0 时的默认值
const DEFAULT_CONTEXT_LENGTH = 200000;
const DEFAULT_MAX_TOKENS = 8192;

// 模型能力（用于 UI 标签和 CodeBuddy 配置）
export interface ModelCapabilities {
  toolCall: boolean;
  images: boolean;
  reasoning: boolean;
  maxInputTokens: number;
  maxOutputTokens: number;
}

// 推断模型能力（features 字段优先，architecture 兜底）
export function getModelCapabilities(model: MarketModelInfo): ModelCapabilities {
  const contextLength = model.model_constraints.context_length;
  const maxTokens = model.model_constraints.max_tokens;
  return {
    toolCall:
      model.features.includes(FEATURE_TOOL_CALL) ||
      model.architecture.function_calling.supported,
    images: model.architecture.input_modalities.includes(MODALITY_IMAGE),
    reasoning:
      model.features.includes(FEATURE_REASONING) ||
      model.architecture.reasoning.supported,
    maxInputTokens: contextLength > 0 ? contextLength : DEFAULT_CONTEXT_LENGTH,
    maxOutputTokens: maxTokens > 0 ? maxTokens : DEFAULT_MAX_TOKENS,
  };
}

// Market Models API 响应
interface MarketModelsResponse {
  status: boolean;
  data: MarketModelInfo[];
}

// 市场模型服务 - 获取和缓存模型列表及能力信息
class MarketModelService {
  private cache: MarketModelInfo[] | null = null;
  private cacheKey: string | null = null;

  // 缓存键使用 baseUrl + apiKey 哈希，避免 apiKey 明文驻留
  private buildCacheKey(baseUrl: string, apiKey: string): string {
    let hash = 0;
    for (let i = 0; i < apiKey.length; i++) {
      hash = ((hash << 5) - hash + apiKey.charCodeAt(i)) | 0;
    }
    return `${baseUrl}:${hash}`;
  }

  async fetchModels(baseUrl: string, apiKey: string): Promise<MarketModelInfo[]> {
    const key = this.buildCacheKey(baseUrl, apiKey);
    if (this.cache && this.cacheKey === key) {
      return this.cache;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(`${baseUrl}/v1/market/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as MarketModelsResponse;

      if (!data.status || !Array.isArray(data.data)) {
        throw new Error('Invalid response format');
      }

      const models = data.data;
      models.sort((a, b) => a.id.localeCompare(b.id));

      this.cache = models;
      this.cacheKey = key;

      return models;
    } finally {
      clearTimeout(timeout);
    }
  }

  clearCache(): void {
    this.cache = null;
    this.cacheKey = null;
  }
}

export const marketModelService = new MarketModelService();
