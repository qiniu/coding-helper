import { configManager } from '../lib/config.js';
import { i18n, t } from '../lib/i18n.js';
import { toolManager } from '../lib/tool-manager.js';
import { detectTool } from '../lib/core/tool-service.js';
import { uiRenderer } from '../lib/wizard/ui/ui-renderer.js';

// 只返回安装、版本与接入状态，不返回客户端配置内容或凭据。
export function statusCommand(options: { json?: boolean }): void {
  try {
    i18n.init();
    const detections = toolManager.getAll().map(detectTool);
    const exitCode = detections.some(detection => detection.errors.length > 0) ? 1 : 0;
    if (options.json) {
      console.log(JSON.stringify({
        endpoint: configManager.getEndpoint(),
        baseUrl: configManager.baseUrl,
        apiKeySet: !!configManager.getApiKey(),
        tools: detections.map(({ tool, installed, version, configured, errors }) => ({
          tool: tool.name, installed, version, configured, launchOnly: !!tool.launchOnly, errors,
        })),
        exitCode,
      }, null, 2));
    } else {
      uiRenderer.renderTitle(t('status_title'));
      uiRenderer.renderConfigItem(t('config_view_endpoint'), configManager.baseUrl);
      for (const { tool, installed, version, configured, errors } of detections) {
        const installation = installed === null
          ? t(errors.includes('installation_detection_failed') ? 'status_unknown' : 'tool_status_unknown')
          : t(installed ? 'status_installed' : 'status_not_installed');
        const connection = tool.launchOnly ? t('status_launcher')
          : t(configured === null ? 'status_unknown' : configured ? 'status_configured' : 'status_not_configured');
        uiRenderer.renderConfigItem(tool.displayName, `${installation}${version ? ` (${version})` : ''} · ${connection}`);
        if (errors.length) uiRenderer.renderWarning(t('status_detection_failed'));
      }
    }
    process.exitCode = exitCode;
  } catch {
    if (options.json) console.log(JSON.stringify({ error: 'status_failed', exitCode: 1 }));
    else uiRenderer.renderError('Cannot read helper configuration. Repair config.yaml and retry.');
    process.exitCode = 1;
  }
}
