// 上下文大小：支持 128k / 1m / 131072；auto、0 表示使用模型上限（返回 undefined）
export function parseContextSize(input: string): number | undefined {
  const text = input.trim().toLowerCase();
  if (!text || text === 'auto' || text === '0') return undefined;
  const match = text.match(/^(\d+(?:\.\d+)?)\s*([km]?)$/);
  if (!match) throw new Error('invalid_context');
  const value = Number(match[1]) * (match[2] === 'k' ? 1000 : match[2] === 'm' ? 1000000 : 1);
  if (!Number.isSafeInteger(Math.round(value)) || value < 1000) throw new Error('invalid_context');
  return Math.round(value);
}

// 显示用：131072 → 131K，1000000 → 1M
export function formatContextSize(tokens: number): string {
  if (tokens >= 1000000 && tokens % 1000000 === 0) return `${tokens / 1000000}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
}
