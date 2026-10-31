// 模型搜索：忽略 - / . _ 和空格（glm5 → glm-5.2），支持中文厂商名、上下文大小（200k / 1m）与能力（看图 / vision）

export interface SearchableModel {
  id: string;
  name?: string;
  reasoning?: boolean;
  context: number;
  toolCall: boolean;
  vision: boolean;
}

export interface Vendor {
  id: string;
  label: string;
  // 搜索别名（小写）
  aliases: string[];
  match: RegExp;
}

export const VENDORS: Vendor[] = [
  { id: 'deepseek', label: 'DeepSeek', aliases: ['深度求索', 'deepseek'], match: /deepseek/ },
  { id: 'qwen', label: 'Qwen', aliases: ['千问', '通义', '通义千问', '阿里', 'qwen', 'alibaba'], match: /qwen|qwq/ },
  { id: 'glm', label: 'GLM', aliases: ['智谱', 'glm', 'zhipu', 'zai'], match: /glm|z-ai|zhipu/ },
  { id: 'kimi', label: 'Kimi', aliases: ['月之暗面', 'kimi', 'moonshot'], match: /kimi|moonshot/ },
  { id: 'minimax', label: 'MiniMax', aliases: ['minimax', '稀宇'], match: /minimax/ },
  { id: 'openai', label: 'OpenAI', aliases: ['openai', 'gpt'], match: /openai|gpt/ },
];

const TOOL_WORDS = ['工具', '工具调用', 'tool', 'tools', 'toolcall', 'tool_call'];
const REASONING_WORDS = ['思考', '深度思考', '推理', 'thinking', 'reasoning'];
const VISION_WORDS = ['看图', '图片', '图像', '视觉', '多模态', 'vision', 'image', 'vl'];

export function vendorOf(id: string): string | undefined {
  const lower = id.toLowerCase();
  return VENDORS.find((v) => v.match.test(lower))?.id;
}

export function normalizeModelText(text: string): string {
  return text.toLowerCase().replace(/[\s\-/._:]/g, '');
}

// 去掉厂商前缀：z-ai/glm-5.2 → glm-5.2
function shortName(id: string): string {
  return id.slice(id.lastIndexOf('/') + 1);
}

interface ParsedQuery {
  words: string[];
  minContext?: number;
  toolCall?: boolean;
  reasoning?: boolean;
  vision: boolean;
}

export function parseModelQuery(query: string): ParsedQuery {
  const parsed: ParsedQuery = { words: [], vision: false };
  for (const raw of query.trim().toLowerCase().split(/\s+/).filter(Boolean)) {
    const size = /^(\d+(?:\.\d+)?)([km])$/.exec(raw);
    if (size) {
      parsed.minContext = Number(size[1]) * (size[2] === 'm' ? 1_000_000 : 1000);
      continue;
    }
    if (VISION_WORDS.includes(raw)) {
      parsed.vision = true;
      continue;
    }
    if (TOOL_WORDS.includes(raw)) { parsed.toolCall = true; continue; }
    if (REASONING_WORDS.includes(raw)) { parsed.reasoning = true; continue; }
    parsed.words.push(raw);
  }
  return parsed;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const ch of haystack) if (ch === needle[i]) i++;
  return i === needle.length;
}

// 一个词与模型的匹配度：0 开头匹配 · 1 包含或厂商别名 · 2 按顺序出现；undefined 不匹配
function wordScore(word: string, id: string): number | undefined {
  const full = normalizeModelText(id);
  const short = normalizeModelText(shortName(id));
  const w = normalizeModelText(word);
  if (!w) return 0;
  if (short.startsWith(w) || full.startsWith(w)) return 0;
  if (full.includes(w)) return 1;
  const vendor = VENDORS.find((v) => v.aliases.includes(word));
  if (vendor && vendorOf(id) === vendor.id) return 1;
  if (isSubsequence(w, short)) return 2;
  return undefined;
}

// 排序分数：越小越靠前。开头匹配 > 推荐 > 最近使用；undefined 表示不匹配
export function scoreModel(
  model: SearchableModel,
  query: string,
  options: { recommended?: boolean; recent?: boolean } = {},
): number | undefined {
  const parsed = parseModelQuery(query);
  if (parsed.minContext && model.context < parsed.minContext) return undefined;
  if (parsed.vision && !model.vision) return undefined;
  if (parsed.toolCall && !model.toolCall) return undefined;
  if (parsed.reasoning && !model.reasoning) return undefined;
  if (model.id === query.trim()) return -1;
  let worst = 0;
  for (const word of parsed.words) {
    const score = wordScore(word, model.id) ?? (normalizeModelText(model.name ?? '').includes(normalizeModelText(word)) ? 1 : undefined);
    if (score === undefined) return undefined;
    worst = Math.max(worst, score);
  }
  return worst * 10 + (options.recommended ? 0 : 2) + (options.recent ? 0 : 1);
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

// 没有匹配时给出最相近的几个模型
export function closestModels(ids: string[], query: string, count = 3): string[] {
  const words = parseModelQuery(query).words.join('');
  const q = normalizeModelText(words.includes('/') ? shortName(words) : words);
  if (!q) return ids.slice(0, count);
  return ids
    .map((id) => ({ id, d: editDistance(q, normalizeModelText(shortName(id)).slice(0, q.length + 2)) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, count)
    .map((x) => x.id);
}

// 自定义模型 ID 缺厂商前缀时补全：glm-5.2 → z-ai/glm-5.2
export function resolveModelId(input: string, ids: string[]): string {
  const value = input.trim();
  if (ids.includes(value) || value.includes('/')) return value;
  const n = normalizeModelText(value);
  const matches = ids.filter((id) => normalizeModelText(shortName(id)) === n);
  return matches.length === 1 ? matches[0] : value;
}
