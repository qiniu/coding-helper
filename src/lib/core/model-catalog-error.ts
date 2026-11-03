// 保留 HTTP 状态，避免把认证/权限失败误当成离线目录恢复。
export class ModelCatalogHttpError extends Error {
  constructor(readonly status: number) { super(`HTTP ${status}`); this.name = 'ModelCatalogHttpError'; }
}

export function isCatalogAccessError(error: unknown): boolean {
  return error instanceof ModelCatalogHttpError && [401, 402, 403].includes(error.status);
}
