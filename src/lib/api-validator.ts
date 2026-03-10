import { t } from './i18n.js';

// API Key 验证结果
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

// 通过 GET {baseUrl}/v2/stat/usage 验证 API Key
export async function validateApiKey(
  apiKey: string,
  baseUrl: string,
): Promise<ValidationResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    // 构造当天日期，最小化查询范围
    const today = new Date().toISOString().slice(0, 10);
    const url = `${baseUrl}/v2/stat/usage?granularity=day&start=${today}T00:00:00%2B08:00&end=${today}T23:59:59%2B08:00`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.ok) {
      return { valid: true };
    }

    // 根据状态码返回错误
    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: 'Invalid API Key' };
    }

    return { valid: false, error: `HTTP ${response.status}` };
  } catch (error: unknown) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return { valid: false, error: t('error_timeout') };
      }
      return { valid: false, error: error.message };
    }
    return { valid: false, error: t('error_unknown') };
  }
}
