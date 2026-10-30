// 单条命令（npx qiniu-coding-helper <工具> [Key] [模型]）的纯函数：参数解析、Key 来源、模型选择

export interface QuickArgs {
  // 工具名（含别名，原样保留，由调用方解析）；'all' 表示本机已安装的全部
  tools: string[] | 'all';
  apiKey?: string;
  model?: string;
}

// sk- 前缀仅用于便捷位置参数；显式 Key/模型选项可消除任意 Key 格式的歧义。
export function parseQuickArgs(target: string, rest: string[], options: { apiKey?: string; model?: string } = {}): QuickArgs {
  const tools = target === 'all'
    ? 'all'
    : [...new Set(target.split(',').map((name) => name.trim()).filter(Boolean))];
  if (tools !== 'all' && !tools.length) throw new Error('empty_tools');
  const args: QuickArgs = { tools };
  if (options.apiKey !== undefined) {
    if (!options.apiKey.trim() || /\s/.test(options.apiKey.trim())) throw new Error('invalid_key');
    args.apiKey = options.apiKey.trim();
  }
  if (options.model !== undefined) {
    if (!options.model.trim()) throw new Error('invalid_model');
    args.model = options.model.trim();
  }
  for (const token of rest) {
    if (/^sk-/.test(token) || (options.apiKey === undefined && options.model !== undefined && !args.apiKey)) {
      if (args.apiKey) throw new Error('duplicate_key');
      args.apiKey = token;
    } else {
      if (args.model) throw new Error('duplicate_model');
      args.model = token;
    }
  }
  return args;
}

export type KeySource = 'argument' | 'env' | 'saved' | 'prompt';

// Key 来源优先级：命令参数 → QINIU_API_KEY → 已保存；都没有时返回 undefined，由调用方决定是否弹出输入
export function pickApiKey(
  args: QuickArgs,
  env: NodeJS.ProcessEnv,
  saved: string | undefined,
): { key: string; source: KeySource } | undefined {
  if (args.apiKey) return { key: args.apiKey, source: 'argument' };
  const fromEnv = env.QINIU_API_KEY?.trim();
  if (fromEnv) return { key: fromEnv, source: 'env' };
  if (saved) return { key: saved, source: 'saved' };
  return undefined;
}

// 未指定模型时按此顺序在 Key 可用的模型中自动选择；后续可改为后端下发
export const RECOMMENDED_MODELS = [
  'deepseek/deepseek-v4-flash',
  'deepseek/deepseek-v4-pro',
  'qwen/qwen3.7-plus',
  'z-ai/glm-5.2',
  'moonshotai/kimi-k3',
];

// tool_default：通用模型与该工具不兼容，改用工具自己的默认模型
export type ModelSource = 'argument' | 'saved' | 'auto' | 'tool_default';

export type ModelPick =
  | { model: string; source: ModelSource; corrected?: string }
  | { error: 'not_available' | 'no_tool_call' | 'none_available'; suggestions: string[] };

// undefined 表示能力数据不可用；空集合表示没有支持工具调用的模型。
export function pickModel(
  requested: string | undefined,
  saved: string | undefined,
  available: string[],
  toolCapable: Set<string> | undefined,
): ModelPick {
  const usable = (id: string): boolean => toolCapable === undefined || toolCapable.has(id);
  const candidates = available.filter(usable);

  if (requested) {
    let model = requested;
    let corrected: string | undefined;
    if (!available.includes(model)) {
      // 常见错误：漏写厂商前缀，如 deepseek-v4-flash → deepseek/deepseek-v4-flash
      const prefixed = available.filter((id) => id.endsWith(`/${requested}`));
      if (prefixed.length !== 1) {
        return { error: 'not_available', suggestions: suggestModels(requested, candidates) };
      }
      corrected = requested;
      model = prefixed[0];
    }
    if (!usable(model)) return { error: 'no_tool_call', suggestions: autoCandidates(candidates).slice(0, 5) };
    return { model, source: 'argument', corrected };
  }

  if (saved && available.includes(saved) && usable(saved)) return { model: saved, source: 'saved' };

  const auto = autoCandidates(candidates);
  if (auto.length === 0) return { error: 'none_available', suggestions: [] };
  return { model: auto[0], source: 'auto' };
}

function autoCandidates(candidates: string[]): string[] {
  const recommended = RECOMMENDED_MODELS.filter((id) => candidates.includes(id));
  return [...recommended, ...candidates.filter((id) => !recommended.includes(id))];
}

// 相近模型：包含关系最优先，其次共同前缀与编辑距离，最多 5 个
export function suggestModels(input: string, candidates: string[], limit = 5): string[] {
  const needle = input.toLowerCase();
  const score = (id: string): number => {
    const tail = id.toLowerCase().split('/').pop() ?? id.toLowerCase();
    if (id.toLowerCase().includes(needle) || needle.includes(tail)) return 0;
    const shared = commonPrefix(needle, tail);
    return shared >= 5 ? 1 + editDistance(needle, tail) / 10 : 2 + editDistance(needle, tail);
  };
  const threshold = 2 + Math.max(4, Math.ceil(needle.length * 0.5));
  return [...candidates]
    .map((id) => ({ id, s: score(id) }))
    .filter(({ s }) => s <= threshold)
    .sort((a, b) => a.s - b.s || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map(({ id }) => id);
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return row[b.length];
}
