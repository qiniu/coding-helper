import type { ToolResult } from '../../core/tool-service.js';
import { t } from '../../i18n.js';
import { uiRenderer } from './ui-renderer.js';

// 机器输出不携带可能包含配置正文和旧凭据的原始解析异常。
export function jsonToolResults(results: ToolResult[]): object[] {
  return results.map(({ tool, status, reason }) => ({ tool: tool.name, status,
    ...(reason ? { reason: status === 'failed' ? 'configuration_failed' : reason } : {}) }));
}

export function renderToolResults(results: ToolResult[], apiKey?: string): void {
  for (const { tool, status, reason } of results) {
    if (status === 'success') uiRenderer.renderSuccess(t('tool_config_loaded', { tool: tool.displayName }));
    else if (status === 'skipped') uiRenderer.renderHint(`${tool.displayName}: ${t(reason ?? '')}`);
    else {
      const message = t(reason ?? 'tool_config_load_failed', { tool: tool.displayName });
      uiRenderer.renderError(`${tool.displayName}: ${apiKey ? message.split(apiKey).join('[REDACTED]') : message}`);
    }
  }
}
