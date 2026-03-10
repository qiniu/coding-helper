// npm registry 版本查询服务

// 从 npm registry 获取包的最新版本
export async function fetchLatestVersion(packageName: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`https://registry.npmjs.org/${packageName}/latest`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = (await response.json()) as { version?: string };
    return data.version || null;
  } catch {
    return null;
  }
}

// 简单的语义化版本比较：latest > current 返回 true
export function isNewerVersion(current: string, latest: string): boolean {
  const parseParts = (v: string) => v.split('.').map(Number);
  const c = parseParts(current);
  const l = parseParts(latest);

  for (let i = 0; i < Math.max(c.length, l.length); i++) {
    const cv = c[i] || 0;
    const lv = l[i] || 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
}
