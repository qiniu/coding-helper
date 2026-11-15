import fs from 'node:fs';
import { i18n, t } from '../lib/i18n.js';
import { uiRenderer } from '../lib/wizard/ui/ui-renderer.js';
import { autostartPath } from '../lib/desktop-gateway/autostart.js';
import { gatewayConfigPath, gatewayLogPath, gatewayScriptPath, probeGateway, readGatewayConfig, startDesktopGateway, stopDesktopGateway, type GatewayProbe } from '../lib/desktop-gateway/background.js';
import { gatewayOrigin } from '../lib/desktop-gateway/mapping.js';
import { DESKTOP_ROUTES } from '../lib/desktop-gateway/server.js';

export type DesktopGatewayAction = 'start' | 'stop' | 'status';

// 网关状态只含端口、模型和文件位置，不输出七牛 Key 或本地令牌。
async function gatewayStatus(): Promise<{ configured: boolean; state?: GatewayProbe; url?: string; models?: Record<string, string>; autostart: boolean; log: string }> {
  const config = readGatewayConfig();
  const autostart = fs.existsSync(autostartPath());
  if (!config) return { configured: false, autostart, log: gatewayLogPath() };
  const roles = Object.entries(DESKTOP_ROUTES).map(([role, route]) => [role, config.routes[route]]).filter(([, model]) => !!model);
  return { configured: true, state: await probeGateway(config), url: gatewayOrigin(config.port), models: Object.fromEntries(roles), autostart, log: gatewayLogPath() };
}

export async function desktopGatewayCommand(action: string, options: { json?: boolean } = {}): Promise<void> {
  i18n.init();
  try {
    if (!['start', 'stop', 'status'].includes(action)) throw new Error(t('desktop_gateway_unknown_action', { action }));
    if (action === 'start') {
      if (!readGatewayConfig()) throw new Error(t('desktop_gateway_not_configured'));
      await startDesktopGateway(gatewayScriptPath(), gatewayConfigPath());
    } else if (action === 'stop') {
      const config = readGatewayConfig();
      if (config) await stopDesktopGateway(config);
    }
    const status = await gatewayStatus();
    if (options.json) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      uiRenderer.renderTitle(t('desktop_gateway_title'));
      if (!status.configured) uiRenderer.renderWarning(t('desktop_gateway_not_configured'));
      else {
        uiRenderer.renderConfigItem(t('desktop_gateway_state'), t(`desktop_gateway_state_${status.state}`));
        uiRenderer.renderConfigItem(t('desktop_gateway_url'), status.url!);
        for (const [role, model] of Object.entries(status.models ?? {})) uiRenderer.renderConfigItem(role[0].toUpperCase() + role.slice(1), model);
      }
      uiRenderer.renderConfigItem(t('desktop_gateway_autostart'), t(status.autostart ? 'status_configured' : 'status_not_configured'));
      uiRenderer.renderConfigItem(t('desktop_gateway_log'), status.log);
    }
    // status 在网关未运行时返回 1，便于脚本检测。
    process.exitCode = status.configured && (action === 'stop' || status.state === 'current') ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) console.log(JSON.stringify({ error: message }));
    else uiRenderer.renderError(message);
    process.exitCode = 1;
  }
}
