import {
  createPrompt,
  useKeypress,
  useState,
  useEffect,
  usePagination,
  useMemo,
  isEnterKey,
  isUpKey,
  isDownKey,
  isSpaceKey,
  isBackspaceKey,
  type KeypressEvent,
} from '@inquirer/core';
import chalk from 'chalk';
import { theme } from './theme.js';
import { t } from '../../i18n.js';
import { padVisible, visibleWidth, truncate, stripAnsi } from '../../../utils/string-width.js';

// 交互只依赖 ↑↓←→、回车、Esc；字母 / 数字键只作为隐藏的加速键，界面上不提示

// 底部提示：[按键, 说明]
export type KeyHint = [string, string];

const ACTIVE_BG = '#0F2633';
const MATCH = chalk.hex('#19C2F0').underline;

// 光标隐藏（与 @inquirer/select 一致，避免闪烁）
const CURSOR_HIDE = '\x1B[?25l';

function sequenceOf(key: KeypressEvent): string {
  return (key as KeypressEvent & { sequence?: string }).sequence ?? '';
}

function isEscape(key: KeypressEvent): boolean {
  return key.name === 'escape';
}

function isPrintable(key: KeypressEvent): boolean {
  const seq = sequenceOf(key);
  return !key.ctrl && [...seq].length === 1 && seq >= ' ' && seq !== '\x7f';
}

// 底部提示：一行，淡色；放不下时按整组换行
export function renderKeyHints(hints: KeyHint[]): string {
  const max = terminalWidth() - 4;
  const lines: string[] = [];
  let line = '';
  for (const [k, text] of hints) {
    const part = `${theme.value(k)} ${theme.subtle(text)}`;
    if (line && visibleWidth(line) + 5 + visibleWidth(part) > max) {
      lines.push(line);
      line = part;
    } else {
      line = line ? `${line}${theme.subtle('  ·  ')}${part}` : part;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n  ');
}

// 标准提示：↑↓ 选择 · 回车 确认 · Esc 返回
export function standardHints(options: { back?: boolean; search?: boolean; tabs?: boolean; enter?: string } = {}): KeyHint[] {
  return [
    ['↑↓', t('ui_key_move')],
    ...(options.tabs ? [['←→', t('ui_key_tabs')] as KeyHint] : []),
    [t('ui_key_enter'), options.enter ?? t('ui_key_confirm')],
    ...(options.back !== false ? [['Esc', t('ui_key_back')] as KeyHint] : []),
    ...(options.search ? [[t('ui_key_type'), t('ui_key_search')] as KeyHint] : []),
  ];
}

function terminalWidth(): number {
  return Math.max(12, Math.min(process.stdout.columns || 100, 140));
}

// 右侧值放不下时整列隐藏（选中项的说明里仍有完整信息）
function hintFits(prefix: number, labelWidth: number, hintWidth: number): boolean {
  return prefix + labelWidth + 4 + hintWidth <= terminalWidth() - 2;
}

// 选中行：整行铺底色
function highlightRow(text: string, width: number): string {
  return chalk.bgHex(ACTIVE_BG)(padVisible(text, width));
}

// 在标签里高亮搜索词：按顺序匹配字母数字（忽略 - / . 和空格），匹配到的字符加下划线
export function highlightMatch(label: string, query: string): string {
  const q = query.toLowerCase().replace(/[^a-z0-9一-鿿]/g, '');
  if (!q) return label;
  let qi = 0;
  let out = '';
  for (const ch of label) {
    if (qi < q.length && ch.toLowerCase() === q[qi]) {
      out += MATCH(ch);
      qi++;
    } else {
      out += ch;
    }
  }
  return qi === q.length ? out : label;
}

// ─── 菜单 ─────────────────────────────────────────────────────────

export interface MenuItem<T> {
  value: T;
  label: string;
  // 右侧的当前值/状态
  hint?: string;
  // 选中时显示在列表下方
  description?: string;
  // 隐藏的加速键（数字或字母），按下直接选中并确认；不可搜索的菜单才生效
  key?: string;
  // 左侧图标（已着色），需定宽
  icon?: string;
  disabled?: boolean;
  // 搜索时额外匹配的文本
  search?: string;
  // 只在没有搜索词、且在第一个标签页时显示（如「最近使用」）
  pinned?: boolean;
}

export interface MenuSeparator {
  separator: string;
}

export type MenuEntry<T> = MenuItem<T> | MenuSeparator;

export interface MenuTab<T> {
  label: string;
  match: (item: MenuItem<T>) => boolean;
}

export interface MenuConfig<T> {
  message: string;
  items: MenuEntry<T>[];
  default?: T;
  footer?: KeyHint[];
  // 作用于当前选中项的隐藏加速键，按下后返回 { value, action }
  actions?: string[];
  // 允许 Esc 返回（返回 action 'escape'）
  escape?: boolean;
  // 直接打字即过滤；filter 返回匹配分数（越小越靠前），undefined 表示不匹配
  searchable?: boolean;
  filter?: (item: MenuItem<T>, query: string) => number | undefined;
  // 搜索时附加「使用输入的值」，选中返回 action 'custom' 与 query
  customLabel?: (query: string) => string | undefined;
  // 没有匹配时显示的提示，以及可直接选择的建议（如最相近的几项）
  emptyText?: (query: string) => string;
  suggest?: (query: string) => MenuItem<T>[];
  // 搜索框里的提示文字
  placeholder?: string;
  // 高亮用的搜索词（如去掉 200k、看图 这类过滤词）
  highlight?: (query: string) => string;
  // ←→ 切换的标签页；搜索时自动看全部
  tabs?: MenuTab<T>[];
  // 没有标签页时，→ / ← 返回 action 'right' / 'left'（如展开一行的详情）
  arrows?: boolean;
  // 选中项变化时异步取一行补充信息（如模型兼容性），结果按 value 缓存
  asyncDetail?: (item: MenuItem<T>) => Promise<string> | string | undefined;
  pageSize?: number;
}

export interface MenuResult<T> {
  value: T;
  // 'escape' | 'custom' | 'left' | 'right' | 隐藏加速键；回车选中时为 undefined
  action?: string;
  query?: string;
}

function isSeparator<T>(entry: MenuEntry<T>): entry is MenuSeparator {
  return 'separator' in entry;
}

function selectable<T>(entry: MenuEntry<T> | undefined): entry is MenuItem<T> {
  return !!entry && !isSeparator(entry) && !entry.disabled;
}

const CUSTOM = Symbol('custom');

function defaultFilter<T>(item: MenuItem<T>, query: string): number | undefined {
  const text = `${item.search ?? ''} ${item.label} ${String(item.value)}`.toLowerCase();
  const index = text.indexOf(query.toLowerCase());
  return index === -1 ? undefined : index;
}

const menuView = createPrompt(<T,>(config: MenuConfig<T>, done: (result: MenuResult<T>) => void) => {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState(0);
  const [status, setStatus] = useState<'idle' | 'done'>('idle');
  const [details] = useState(new Map<T, string | undefined>());
  const [, refreshDetails] = useState({});

  // 搜索时跨所有标签过滤并排序；没有搜索时按当前标签筛选
  const items = useMemo((): MenuEntry<T | typeof CUSTOM>[] => {
    if (query) {
      const filter = config.filter ?? defaultFilter;
      const scored = config.items
        .filter(selectable)
        .filter((item) => !item.pinned)
        .map((item, order) => ({ item, order, score: filter(item, query) }))
        .filter((x): x is { item: MenuItem<T>; order: number; score: number } => x.score !== undefined)
        .sort((a, b) => a.score - b.score || a.order - b.order)
        .map((x) => x.item);
      const customText = config.customLabel?.(query);
      const custom: MenuItem<typeof CUSTOM>[] = customText ? [{ value: CUSTOM, label: customText }] : [];
      const suggested = scored.length ? [] : config.suggest?.(query) ?? [];
      if (!scored.length && custom.length) return [...custom, ...(suggested.length ? [{ separator: '' }, ...suggested] : [])];
      return [...scored, ...suggested, ...(custom.length ? [{ separator: '' }, ...custom] : [])];
    }
    const current = config.tabs?.[tab];
    if (!current || tab === 0) return config.items;
    return config.items.filter((e) => !isSeparator(e) && !e.pinned && current.match(e));
  }, [query, tab, config.items]);

  const first = items.findIndex(selectable);
  const last = items.length - 1 - [...items].reverse().findIndex(selectable);
  const defaultIndex = config.default === undefined ? -1 : items.findIndex((e) => selectable(e) && e.value === config.default);
  const [active, setActive] = useState(defaultIndex === -1 ? first : defaultIndex);
  const activeIndex = selectable(items[active]) ? active : first;
  const current = activeIndex >= 0 ? items[activeIndex] as MenuItem<T | typeof CUSTOM> : undefined;
  const detailKey = current?.value;

  // 选中项变化时取补充信息（只取一次，结果缓存）
  useEffect(() => {
    if (!config.asyncDetail || !current || current.value === CUSTOM || details.has(current.value)) return;
    const item = current as MenuItem<T>;
    // Map 保留值的身份；先占位，避免切换行时重复发起尚未完成的请求。
    details.set(item.value, undefined);
    Promise.resolve().then(() => config.asyncDetail!(item)).then((text) => {
      details.set(item.value, text);
      refreshDetails({});
    }).catch(() => {});
  }, [detailKey]);

  const finish = (result: MenuResult<T>): void => {
    setStatus('done');
    done(result);
  };

  const updateQuery = (next: string): void => {
    setQuery(next);
    setActive(0);
  };

  useKeypress((key) => {
    if (isEnterKey(key)) {
      if (!current) return;
      if (current.value === CUSTOM) return finish({ value: undefined as T, action: 'custom', query });
      return finish({ value: current.value as T, query });
    }
    if (isEscape(key)) {
      // 有搜索词时 Esc 先清空搜索
      if (query) return updateQuery('');
      if (config.escape) finish({ value: current?.value as T, action: 'escape' });
      return;
    }
    if (isUpKey(key) || isDownKey(key)) {
      if (activeIndex < 0) return;
      const offset = isUpKey(key) ? -1 : 1;
      let next = activeIndex;
      do {
        next += offset;
      } while (next >= first && next <= last && !selectable(items[next]));
      if (next >= first && next <= last) setActive(next);
      return;
    }
    if (key.name === 'left' || key.name === 'right') {
      if (config.tabs?.length && !query) {
        const count = config.tabs.length;
        setTab((tab + (key.name === 'right' ? 1 : count - 1)) % count);
        setActive(0);
        return;
      }
      if (config.arrows && current && current.value !== CUSTOM) finish({ value: current.value as T, action: key.name });
      return;
    }
    if (config.searchable) {
      if (isBackspaceKey(key)) return updateQuery([...query].slice(0, -1).join(''));
      if (isPrintable(key)) return updateQuery(query + sequenceOf(key));
      return;
    }

  });

  const all = config.items.filter((e): e is MenuItem<T> => !isSeparator(e));
  const labelWidth = Math.max(0, ...all.map((e) => visibleWidth(e.label)));
  const iconWidth = Math.max(0, ...all.map((e) => (e.icon ? visibleWidth(e.icon) + 1 : 0)));
  const showHints = hintFits(4 + iconWidth, labelWidth, Math.max(0, ...all.map((e) => visibleWidth(e.hint ?? ''))));
  const hintOf = (item: MenuItem<unknown>): string => (showHints ? item.hint ?? '' : '');
  // 选中行底色铺满：前缀「 ❯  」4 列 + 图标 + 标签 + 4 列间距 + 右侧值 + 2 列留白
  const width = Math.min(terminalWidth() - 2, Math.max(
    48,
    ...all.map((e) => 4 + iconWidth + labelWidth + 4 + visibleWidth(hintOf(e)) + 2),
  ));

  const page = usePagination({
    items,
    active: Math.max(0, activeIndex),
    pageSize: config.pageSize ?? 14,
    loop: false,
    renderItem({ item, isActive }) {
      if (isSeparator(item)) return item.separator ? `  ${theme.subtle(item.separator)}` : '';
      const icon = item.icon ? `${item.icon} ` : '';
      const rawLabel = query && item.value !== CUSTOM ? highlightMatch(item.label, config.highlight?.(query) ?? query) : item.label;
      const label = padVisible((visibleWidth(rawLabel) > Math.max(1, terminalWidth() - 8 - iconWidth) ? truncate(stripAnsi(rawLabel), Math.max(1, terminalWidth() - 8 - iconWidth)) : rawLabel), Math.min(labelWidth, Math.max(1, terminalWidth() - 8 - iconWidth)));
      if (item.disabled) {
        return `    ${icon}${theme.subtle(label)}    ${theme.subtle(hintOf(item))}`;
      }
      if (isActive) {
        const text = ` ${theme.brandBold('❯')}  ${icon}${chalk.bold.hex('#E8F6FF')(label)}    ${chalk.hex('#8BE9FF')(hintOf(item))}`;
        return highlightRow(text, width);
      }
      return `    ${icon}${theme.value(label)}    ${theme.subtle(hintOf(item))}`;
    },
  });

  if (status === 'done') {
    return `${theme.success('✔')} ${theme.heading(config.message)} ${theme.brand(current?.value === CUSTOM ? query : current?.label ?? '')}`;
  }
  const lines = [`${theme.brand('?')} ${theme.heading(config.message)}`];
  if (config.searchable) {
    const matches = !query ? 0 : config.items.filter((e) => selectable(e) && !e.pinned && (config.filter ?? defaultFilter)(e, query) !== undefined).length;
    lines.push(query
      ? `  ${theme.brand('⌕')} ${theme.value(query)}${chalk.bgHex('#19C2F0')(' ')}   ${theme.subtle(t('ui_search_found', { count: String(matches) }))}`
      : `  ${theme.subtle('⌕')} ${theme.subtle(config.placeholder ?? t('ui_search_placeholder'))}`);
  }
  if (config.tabs?.length) {
    lines.push(`  ${config.tabs.map((x, i) => {
      const on = query ? i === 0 : i === tab;
      return on ? chalk.bgHex('#1C2733').hex('#E8F6FF')(` ${x.label} `) : theme.subtle(` ${x.label} `);
    }).join(' ')}`);
  }
  const hasMatches = query ? config.items.some((e) => selectable(e) && !e.pinned && (config.filter ?? defaultFilter)(e, query) !== undefined) : true;
  if (!hasMatches) {
    lines.push(`  ${theme.subtle(config.emptyText?.(query) ?? t('ui_search_empty'))}`);
  }
  if (items.length) lines.push(page);
  const extra = current && current.value !== CUSTOM ? details.get(current.value) : undefined;
  if (current?.description || extra) {
    lines.push('');
    for (const line of [current?.description, extra].filter(Boolean).join('\n').split('\n')) lines.push(`  ${line}`);
  }
  const footer = config.footer ?? standardHints({ back: !!config.escape, search: config.searchable, tabs: !!config.tabs?.length });
  lines.push('', `  ${renderKeyHints(query ? [['Esc', t('ui_key_clear_search')], [t('ui_key_enter'), t('ui_key_confirm')]] : footer)}`);
  return `${lines.join('\n')}${CURSOR_HIDE}`;
});

export function menuPrompt<T>(config: MenuConfig<T>, context?: { signal?: AbortSignal }): Promise<MenuResult<T>> {
  return menuView(config as MenuConfig<unknown>, context) as Promise<MenuResult<T>>;
}

// 返回勾选的值；按 Esc 返回 undefined
