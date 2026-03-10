// 模型信息接口
export interface ModelInfo {
  id: string;
  object?: string;
  owned_by?: string;
}

// OpenAI 兼容的模型列表响应
interface ModelsResponse {
  object: string;
  data: ModelInfo[];
}

// 模型服务 - 获取和缓存模型列表
class ModelService {
  private cache: ModelInfo[] | null = null;
  private cacheKey: string | null = null;

  // 从 /v1/models 获取模型列表
  async fetchModels(baseUrl: string, apiKey: string): Promise<ModelInfo[]> {
    // 检查缓存
    const key = `${baseUrl}:${apiKey}`;
    if (this.cache && this.cacheKey === key) {
      return this.cache;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(`${baseUrl}/v1/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as ModelsResponse;
      const models = data.data || [];

      // 按 ID 排序
      models.sort((a, b) => a.id.localeCompare(b.id));

      // 更新缓存
      this.cache = models;
      this.cacheKey = key;

      return models;
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  // 清除缓存
  clearCache(): void {
    this.cache = null;
    this.cacheKey = null;
  }
}

// 导出单例
export const modelService = new ModelService();
