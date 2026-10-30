// npm registry 版本查询服务

// 从 npm registry 获取包的最新版本
export async function fetchLatestVersion(packageName: string, supportedMajor?: number): Promise<string | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`https://registry.npmjs.org/${packageName}/latest`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });


    if (!response.ok) return null;

    const data = (await response.json()) as { version?: string };
    const version = data.version;
    if (typeof version !== 'string' || !version) return null;
    if (supportedMajor !== undefined && Number(version.match(/^(\d+)\./)?.[1]) !== supportedMajor) return null;
    return version;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
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
