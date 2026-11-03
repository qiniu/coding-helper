import type { ToolResult } from '../../core/tool-service.js';
import { t } from '../../i18n.js';
import { uiRenderer } from './ui-renderer.js';

const SAFE_REASON_KEYS = new Set(['apikey_not_set', 'setup_preview_unsupported', 'quick_save_failed', 'tool_config_load_failed',
  'plan_write_failed', 'plan_validation_failed', 'rebaseline_failed', 'helper_settings_failed', 'context_invalid',
  'tool_failure_unrecorded', 'tool_failure_recovery', 'tool_failure_path', 'tool_failure_changed',
  'tool_failure_retry', 'tool_failure_conflict', 'tool_failure_protected', 'tool_failure_permissions']);

// 保留可操作的恢复提示；未知解析异常可能包含旧凭据，不将原文带入终端。
export function safeToolFailureReason(reason?: string, fallback = 'tool_config_load_failed'): string {
  if (!reason) return fallback;
  if (SAFE_REASON_KEYS.has(reason)) return reason;
  if (/^(?:SyntaxError: ?)?(?:Unexpected|Expected .*?(?:property|token|document))|YAMLException|YAMLParseError|Invalid (?:JSON|YAML|TOML)/i.test(reason)) return fallback;
  if (/no restoration record/i.test(reason)) return 'tool_failure_unrecorded';
  if (/legacy.*state|requires recovery|rollback failed|recovery failed|interrupted (?:write|transaction)|restoration.*(?:invalid|incomplete|inconsistent)|invalid.*(?:state|transaction)|conflicting restoration records/i.test(reason)) return 'tool_failure_recovery';
  if (/(?:path|directory|root).*(?:changed|moved|different|switch)|(?:restore|unload).*(?:previous|recorded).*(?:path|directory)/i.test(reason)) return 'tool_failure_path';
  if (/changed before writing/i.test(reason)) return 'tool_failure_retry';
  if (/changed since loading|managed fields changed|configuration changed|file.*changed|external.*(?:change|modif)/i.test(reason)) return 'tool_failure_changed';
  if (/conflict|already.*(?:exists|owned)|ownership/i.test(reason)) return 'tool_failure_conflict';
  if (/symlink|symbolic link|read.?only|protected/i.test(reason)) return 'tool_failure_protected';
  if (/EACCES|EPERM|permissions?|not writable/i.test(reason)) return 'tool_failure_permissions';
  return fallback;
}

// 机器输出不携带可能包含配置正文和旧凭据的原始解析异常。
export function jsonToolResults(results: ToolResult[]): object[] {
  return results.map(({ tool, status, reason }) => ({ tool: tool.name, status,
    ...(reason ? { reason: status === 'failed' && reason !== 'setup_preview_unsupported' ? 'configuration_failed' : reason } : {}) }));
}

export function renderToolResults(results: ToolResult[], apiKey?: string, preview = false): void {
  for (const { tool, status, reason } of results) {
    if (status === 'success') uiRenderer.renderSuccess(t(preview ? 'setup_preview_ready' : 'tool_config_loaded', { tool: tool.displayName }));
    else if (status === 'skipped') uiRenderer.renderHint(`${tool.displayName}: ${t(reason ?? '')}`);
    else {
      const message = t(reason ?? 'tool_config_load_failed', { tool: tool.displayName });
      uiRenderer.renderError(`${tool.displayName}: ${apiKey ? message.split(apiKey).join('[REDACTED]') : message}`);
    }
  }
}
