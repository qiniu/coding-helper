import type { ModelConfig } from '../config.js';
import { DESKTOP_ROUTES } from './server.js';

// 未单独选择的角色跟随主模型；映射只保存模型 ID，不把上游凭据放入 Desktop。
export function desktopModelRoutes(models: ModelConfig): Record<string, string> {
  const main = models.toolModels?.['claude-desktop'] ?? models.defaultModel;
  if (!main?.trim()) throw new Error('Claude Desktop model is required.');
  const slots = models.slotModels?.['claude-desktop'] ?? {};
  return {
    [DESKTOP_ROUTES.sonnet]: main,
    [DESKTOP_ROUTES.opus]: slots.opus?.trim() || main,
    [DESKTOP_ROUTES.haiku]: slots.haiku?.trim() || main,
  };
}

export function desktopGatewayProfile(current: Record<string, unknown>, gatewayUrl: string, localToken: string, routes: Record<string, string>): Record<string, unknown> {
  const url = new URL(gatewayUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Desktop gateway must use a loopback HTTP address with a port.');
  if (!localToken.trim()) throw new Error('Desktop gateway token is required.');
  const ids = Object.values(DESKTOP_ROUTES);
  if (Object.keys(routes).length !== ids.length || ids.some(id => typeof routes[id] !== 'string' || !routes[id].trim())) throw new Error('Desktop model routes are incomplete.');
  return { ...current, inferenceProvider: 'gateway', inferenceGatewayBaseUrl: url.origin,
    inferenceGatewayApiKey: localToken, inferenceGatewayAuthScheme: 'bearer',
    inferenceModels: ids.map(name => ({ name, labelOverride: routes[name] })) };
}
