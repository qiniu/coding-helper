import { t } from './i18n.js';
import { RECOMMENDED_MODELS } from './core/quick-args.js';

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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {

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
  } finally { clearTimeout(timeout); }
}

export interface AccountStatus {
  // null 表示网络、模型或响应格式不足以判断账户可用性。
  usable: boolean | null;
  code?: string;
}

async function rejectedAccount(response: Response): Promise<AccountStatus> {
  const error = await response.json().catch(() => ({})) as { error?: { code?: unknown } };
  const code = typeof error?.error?.code === 'string' ? error.error.code : `http_${response.status}`;
  return { usable: [401, 402, 403].includes(response.status) || code === 'account_billing_suspended' ? false : null, code };
}

// 优先探测本次配置的模型，再选推荐模型和列表中的其他模型；最多尝试三个不同模型。
export async function checkAccountStatus(apiKey: string, baseUrl: string, preferredModels: readonly string[] = []): Promise<AccountStatus> {
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  try {
    const list = await fetch(`${baseUrl}/v1/models`, { headers, signal: AbortSignal.timeout(15000) });
    if (!list.ok) return rejectedAccount(list);
    const body = await list.json() as { data?: { id?: unknown }[] };
    const ids = Array.isArray(body.data) ? body.data.map(model => model?.id).filter((id): id is string => typeof id === 'string' && !!id) : [];
    const available = new Set(ids);
    const candidates = [...new Set([...preferredModels, ...RECOMMENDED_MODELS, ...ids])]
      .filter(id => available.has(id)).slice(0, 3);
    if (!candidates.length) return { usable: null, code: 'no_probe_model' };
    // 多模型回退共用超时，避免每次重试都重新等待三十秒。
    const signal = AbortSignal.timeout(30000);
    let result: AccountStatus = { usable: null, code: 'no_probe_model' };
    for (const model of candidates) {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST', headers, signal,
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
      });
      if (response.ok) return { usable: true };
      result = await rejectedAccount(response);
      // 下架、模型参数不兼容或上游异常可换模型；鉴权、计费、限流等错误立即返回。
      if (result.usable === false || ![400, 404, 422, 500, 502, 503, 504].includes(response.status)) return result;
    }
    return result;
  } catch { return { usable: null, code: 'probe_unavailable' }; }
}

export function describeAccountStatus(status: AccountStatus): string {
  return t(status.usable === null ? 'account_unknown' : status.code === 'account_billing_suspended' ? 'account_billing_suspended' : 'account_unusable');
}
