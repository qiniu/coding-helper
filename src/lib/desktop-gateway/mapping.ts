import type { ModelConfig } from '../config.js';
import { DESKTOP_ROUTES } from './server.js';

export const DESKTOP_TOOL = 'claude-desktop';

// Desktop profile 中由助手负责的字段：写入时覆盖，还原时按原值恢复；其他字段（Desktop 自身设置）保持不动。
export const DESKTOP_PROFILE_OWNED = [
  'inferenceProvider',
  'inferenceGatewayBaseUrl',
  'inferenceGatewayApiKey',
  'inferenceGatewayAuthScheme',
  'inferenceModels',
  'modelDiscoveryEnabled',
] as const;

// Sonnet 为主模型；Opus、Haiku 未单独设置时跟随主模型。只保存模型 ID，上游凭据不进入 Desktop。
export function desktopModelRoutes(models: ModelConfig): Record<string, string> {
  const main = (models.toolModels?.[DESKTOP_TOOL] ?? models.defaultModel)?.trim();
  if (!main) throw new Error('Claude Desktop model is required.');
  const slots = models.slotModels?.[DESKTOP_TOOL] ?? {};
  return {
    [DESKTOP_ROUTES.sonnet]: main,
    [DESKTOP_ROUTES.opus]: slots.opus?.trim() || main,
    [DESKTOP_ROUTES.haiku]: slots.haiku?.trim() || main,
  };
}

// 菜单只列出主模型和单独设置过的角色，避免同一模型重复出现三次；未列出的角色请求仍由网关路由。
export function desktopMenuModels(routes: Record<string, string>): { name: string; labelOverride: string }[] {
  const main = routes[DESKTOP_ROUTES.sonnet];
  return [DESKTOP_ROUTES.sonnet, DESKTOP_ROUTES.opus, DESKTOP_ROUTES.haiku]
    .filter(name => name === DESKTOP_ROUTES.sonnet || (routes[name] && routes[name] !== main))
    .map(name => ({ name, labelOverride: routes[name] }));
}

export function gatewayOrigin(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Desktop gateway port is invalid.');
  return `http://127.0.0.1:${port}`;
}

export function desktopGatewayProfile(current: Record<string, unknown>, gatewayUrl: string, localToken: string, routes: Record<string, string>): Record<string, unknown> {
  const url = new URL(gatewayUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Desktop gateway must use a loopback HTTP address with a port.');
  if (!localToken.trim()) throw new Error('Desktop gateway token is required.');
  const ids = Object.values(DESKTOP_ROUTES);
  if (Object.keys(routes).length !== ids.length || ids.some(id => typeof routes[id] !== 'string' || !routes[id].trim())) throw new Error('Desktop model routes are incomplete.');
  return {
    ...current,
    inferenceProvider: 'gateway',
    inferenceGatewayBaseUrl: url.origin,
    inferenceGatewayApiKey: localToken,
    inferenceGatewayAuthScheme: 'bearer',
    inferenceModels: desktopMenuModels(routes),
    // 让 Desktop 读取本地 /v1/models 的说明，菜单显示「Qiniu · 模型名」而非 Anthropic 默认描述。
    modelDiscoveryEnabled: true,
  };
}
