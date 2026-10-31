import chalk from 'chalk';

// 像素角色：每个 12×10 像素，用半块字符 ▀▄ 渲染，1 个字符 = 上下 2 个像素（终端里约 12 列 × 5 行）
export interface SpriteDef {
  rows: string[];
  // 字母 → 颜色；'.' 表示透明
  pal: Record<string, string>;
}

const K = '#0A0F14';

// 角色 id 与工具名一致，'qiniu' 为七牛小牛吉祥物
export const SPRITES: Record<string, SpriteDef> = {
  qiniu: { pal: { a: '#19C2F0', b: '#0B86B8', l: '#8BE9FF', k: '#062230' }, rows: [
    'l..........l', 'll........ll', '.aaaaaaaaaa.', 'aaakaaaakaaa', '.aaaaaaaaaa.',
    '.abbbbbbbba.', '.abkbbbbkba.', '.aaaaaaaaaa.', '.a.a....a.a.', '.a.a....a.a.'] },
  'claude-code': { pal: { a: '#D97757', k: K }, rows: [
    '............', '............', '..aaaaaaaa..', '..akaaaaka..', 'aaaaaaaaaaaa',
    '..aaaaaaaa..', '..aaaaaaaa..', '..a.a..a.a..', '..a.a..a.a..', '............'] },
  codex: { pal: { a: '#E6E9EE', k: '#11161C' }, rows: [
    '............', '.aaaaaaaaaa.', 'aakkkkkkkkaa', 'aakakkkkkkaa', 'aakkakkkkkaa',
    'aakakkaaakaa', 'aakkkkkkkkaa', '.aaaaaaaaaa.', '.a.a....a.a.', '............'] },
  opencode: { pal: { a: '#5B626E', l: '#E6E9EE' }, rows: [
    '............', '.aaaaaaaaaa.', 'aaaaaaaaaaaa', 'alaaaaaaaala', 'alaalaalaala',
    'alaaaaaaaala', 'aaaaaaaaaaaa', '.aaaaaaaaaa.', '.a.a....a.a.', '............'] },
  'qwen-code': { pal: { a: '#7C5CFF', b: '#5A3FD6', k: K }, rows: [
    '.....a......', '.....a......', '...aaaaaa...', '..aaaaaaaa..', '..akaaaaka..',
    '.aaaaaaaaaa.', '.aaabbbbaaa.', '..aaaaaaaa..', '..a.a..a.a..', '............'] },
  'kimi-code': { pal: { a: '#33457A', l: '#E8ECF5' }, rows: [
    '............', '...aaaaaa...', '..aaaaalaa..', '.aaaalaaaaa.', '.alaalaaaaa.',
    '.aaaalaaaaa.', '.aaaaallaaa.', '..aaaaaaaa..', '..a.a..a.a..', '............'] },
  droid: { pal: { a: '#9AA3AD', k: '#1A1F25', l: '#F59E0B' }, rows: [
    '............', '..aaaaaaaa..', '.aaaaaaaaaa.', '.akkkkkkkka.', '.aklkkkklka.',
    '.akkkkkkkka.', '.aaaaaaaaaa.', '..aaaaaaaa..', '..a.a..a.a..', '............'] },
  grok: { pal: { a: '#59616C', l: '#E6E9EE' }, rows: [
    '............', '.aaaaaaaaaa.', 'aaaaaaaaaaaa', 'aaaaaaaalaaa', 'aalaaaalaala',
    'aaaaaalaaaaa', 'aaaaaaaaaaaa', '.aaaaaaaaaa.', '.a.a....a.a.', '............'] },
  openclaw: { pal: { a: '#E5433A', k: K }, rows: [
    'a..........a', 'aa........aa', '.aa......aa.', '..aaaaaaaa..', '.aaakaakaaa.',
    'aaaaaaaaaaaa', '..aaaaaaaa..', '.a.a.aa.a.a.', 'a..a....a..a', '............'] },
  'minimax-code': { pal: { a: '#F0506E', k: K }, rows: [
    '............', '...aaaaaa...', '..aaaaaaaa..', '.aaaaaaaaaa.', '.akkaaaakka.',
    '.aaaaaaaaaa.', '.aaakkkkaaa.', '.aaaaaaaaaa.', '.a.a.aa.a.a.', '............'] },
  copilot: { pal: { a: '#8B5CF6', w: '#F3F0FF', k: K }, rows: [
    '............', '............', '..aaaaaaaa..', '.aaaaaaaaaa.', '.awkwaawkwa.',
    '.awwwaawwwa.', '.aaaaaaaaaa.', '..aaaaaaaa..', '..a.a..a.a..', '............'] },
  codebuddy: { pal: { a: '#2F6BFF', b: '#1E4FD1', l: '#DCE7FF' }, rows: [
    '............', '...aaaaaa...', '..aaaaaaaa..', '.aaaaaaaaaa.', '.aalaaaalaa.',
    '.aaaaaaaaaa.', '.aaabbbbaaa.', '.aaaaaaaaaa.', '.a.a....a.a.', '............'] },
  workbuddy: { pal: { a: '#14B8A6', y: '#F5B90B', k: K }, rows: [
    '............', '..aaaaaaaa..', '.aaaaaaaaaa.', '.akaaaaaaka.', '.aaaayyaaaa.',
    '.aaaayyaaaa.', '.aaaaaaaaaa.', '..aaaaaaaa..', '..a.a..a.a..', '............'] },
  hermes: { pal: { a: '#E8B931', w: '#F7F3E3', k: K }, rows: [
    'w..........w', 'ww........ww', '.w.aaaaaa.w.', '..aaaaaaaa..', '..akaaaaka..',
    '..aaaaaaaa..', '..aakkkkaa..', '..aaaaaaaa..', '..a.a..a.a..', '............'] },
};

// QINIU 像素字：7 行高，按行渐变
const LOGO_GLYPHS: string[][] = [
  ['.aaaaaa.', 'aa....aa', 'aa....aa', 'aa....aa', 'aa..a.aa', 'aa...aa.', '.aaaa.aa'],
  ['aa', 'aa', 'aa', 'aa', 'aa', 'aa', 'aa'],
  ['aa....aa', 'aaa...aa', 'aaaa..aa', 'aa.aa.aa', 'aa..aaaa', 'aa...aaa', 'aa....aa'],
  ['aa', 'aa', 'aa', 'aa', 'aa', 'aa', 'aa'],
  ['aa....aa', 'aa....aa', 'aa....aa', 'aa....aa', 'aa....aa', 'aa....aa', '.aaaaaa.'],
];
const LOGO_GRADIENT = ['#8BEDFF', '#52DBFF', '#22C8F5', '#12B1E6', '#0C98D2', '#0A80BC', '#0A6AA6'];

// 像素网格：每格是颜色或 undefined（透明）
export type PixelGrid = (string | undefined)[][];

export function spriteGrid(id: string): PixelGrid | undefined {
  const def = SPRITES[id];
  if (!def) return undefined;
  return def.rows.map((row) => [...row].map((ch) => (ch === '.' ? undefined : def.pal[ch])));
}

export function logoGrid(): PixelGrid {
  return LOGO_GRADIENT.map((color, r) => {
    const line = LOGO_GLYPHS.map((glyph) => glyph[r]).join('.');
    return [...line].map((ch) => (ch === '.' ? undefined : color));
  });
}

// 工具的主色（列表里的色块、纯文本降级时使用）
export function spriteColor(id: string): string {
  return SPRITES[id]?.pal.a ?? '#19C2F0';
}

// 能否画像素：交互终端、至少 256 色，且没有用 CODING_HELPER_ART=0 关闭
export function pixelsSupported(): boolean {
  const art = process.env.CODING_HELPER_ART?.toLowerCase();
  if (art === '0' || art === 'off' || art === 'false') return false;
  return chalk.level >= 2 && !!process.stdout.isTTY;
}

function mix(hex: string, target: string, amount: number): string {
  const parse = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = parse(hex);
  const b = parse(target);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, '0')).join('');
}

// 未接入的角色：压暗成灰
export function dimGrid(grid: PixelGrid): PixelGrid {
  return grid.map((row) => row.map((c) => (c ? mix(c, '#232B35', 0.72) : undefined)));
}

// 半块字符渲染：每两行像素合成一行字符
export function renderGrid(grid: PixelGrid): string[] {
  const lines: string[] = [];
  const width = Math.max(...grid.map((row) => row.length));
  for (let r = 0; r < grid.length; r += 2) {
    let line = '';
    for (let c = 0; c < width; c++) {
      const top = grid[r]?.[c];
      const bottom = grid[r + 1]?.[c];
      if (!top && !bottom) line += ' ';
      else if (top && !bottom) line += chalk.hex(top)('▀');
      else if (!top && bottom) line += chalk.hex(bottom)('▄');
      else if (top === bottom) line += chalk.hex(top!)('█');
      else line += chalk.hex(top!).bgHex(bottom!)('▀');
    }
    lines.push(line);
  }
  return lines;
}

export function renderSprite(id: string, dim = false): string[] {
  const grid = spriteGrid(id);
  if (!grid) return [];
  return renderGrid(dim ? dimGrid(grid) : grid);
}

// 多个已渲染的块横向拼接（每块行数可不同，底部对齐），gap 为列间距
export function joinBlocks(blocks: string[][], widths: number[], gap = 2): string[] {
  const height = Math.max(...blocks.map((b) => b.length));
  const lines: string[] = [];
  for (let i = 0; i < height; i++) {
    lines.push(blocks.map((block, j) => {
      const offset = height - block.length;
      const line = i >= offset ? block[i - offset] : '';
      return line + ' '.repeat(Math.max(0, widths[j] - visibleLength(line)));
    }).join(' '.repeat(gap)).replace(/\s+$/, ''));
  }
  return lines;
}

// 像素块里只有单宽字符，去掉颜色后的长度即可见宽度
function visibleLength(line: string): number {
  return line.replace(/\x1B\[[0-9;]*m/g, '').length;
}

export const SPRITE_WIDTH = 12;
export const LOGO_WIDTH = 32;
