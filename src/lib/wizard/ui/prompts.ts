import {
  createPrompt,
  useKeypress,
  useState,
  useEffect,
  usePagination,
  useMemo,
  useRef,
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
// 搜索框模拟光标的闪烁间隔（与常见终端光标一致）
const BLINK_MS = 530;
const CURSOR_ON = chalk.bgHex('#19C2F0')(' ');

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
export function standardHints(options: { back?: boolean; search?: boolean; tabs?: boolean; enter?: string; page?: boolean } = {}): KeyHint[] {
  return [
    ['↑↓', t('ui_key_move')],
    ...(options.page ? [['PgUp/PgDn', t('ui_key_page')] as KeyHint] : []),
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
  // 选中时显示的说明（默认在列表下方，detailPosition: 'top' 时在列表上方）
  description?: string;
  // 当前正在使用的项：行首显示 ▪ 标记
  current?: boolean;
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

// 分类横向滚动，当前分类始终可见，避免接口新增发布方后撑高菜单。
function renderMenuTabs<T>(tabs: MenuTab<T>[], selected: number): string {
    const available = Math.max(1, terminalWidth() - 2);
    const renderTab = (i: number): string => {
      const text = ` ${truncate(tabs[i].label, Math.max(1, available - 6))} `;
      return i === selected ? chalk.bgHex('#1C2733').hex('#E8F6FF')(text) : theme.subtle(text);
    };
    let start = selected, end = selected + 1;
    const line = (from: number, to: number): string => [
      ...(from > 0 ? [theme.subtle('‹')] : []),
      ...Array.from({ length: to - from }, (_, i) => renderTab(from + i)),
      ...(to < tabs.length ? [theme.subtle('›')] : []),
    ].join(' ');
    while (start > 0 && visibleWidth(line(start - 1, end)) <= available) start--;
    while (end < tabs.length && visibleWidth(line(start, end + 1)) <= available) end++;
    return `  ${line(start, end)}`;
}

export interface MenuConfig<T> {
  // 多选搜索共用同一绘制器；搜索和分类只改变可见项，不改变已选集合。
  multiple?: {
    initial: T[];
    summary: (values: T[]) => string;
    acceptLabel: (count: number) => string;
    parseCustom?: (query: string) => T[];
    toggleable?: (item: MenuItem<T>) => boolean;
    customItem?: (value: T) => MenuItem<T>;
  };
  statusText?: string;
  statusUpdate?: Promise<string>;
  customFirst?: boolean | ((query: string) => boolean);
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
  // 选中项说明的位置：'top' 放在提示行之后、搜索框与标签之前（固定高度，随选中项实时更新），
  // 并按终端高度缩小列表，保证说明、搜索框、列表与操作提示在一屏内
  detailPosition?: 'top' | 'bottom';
  pageSize?: number;
}

// 文本在当前终端宽度下占用的行数（含自动折行）
function screenRows(text: string): number {
  const columns = process.stdout.columns || 100;
  return text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(visibleWidth(line) / columns)), 0);
}

export interface MenuResult<T> {
  value: T;
  selected?: T[];
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
const ACCEPT = Symbol('accept');


function defaultFilter<T>(item: MenuItem<T>, query: string): number | undefined {
  const text = `${item.search ?? ''} ${item.label} ${String(item.value)}`.toLowerCase();
  const index = text.indexOf(query.toLowerCase());
  return index === -1 ? undefined : index;
}

const menuView = createPrompt(<T,>(config: MenuConfig<T>, done: (result: MenuResult<T>) => void) => {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(new Set(config.multiple?.initial));
  const [added, setAdded] = useState<MenuItem<T>[]>([]);
  const entries = useMemo(() => {
    const control = config.multiple ? config.items.findIndex(entry => selectable(entry) && config.multiple!.toggleable?.(entry) === false) : -1;
    const index = control > 0 && isSeparator(config.items[control - 1]) ? control - 1 : control;
    return index < 0 ? [...config.items, ...added] : [...config.items.slice(0, index), ...added, ...config.items.slice(index)];
  }, [config.items, added]);
  const [tab, setTab] = useState(0);
  const [status, setStatus] = useState<'idle' | 'done' | 'cancel'>('idle');
  const [statusText, setStatusText] = useState(config.statusText ?? '');
  useEffect(() => {
    if (!config.statusUpdate) return;
    let active = true;
    config.statusUpdate.then(text => { if (active) setStatusText(text); }).catch(() => {});
    return () => { active = false; };
  }, [config.statusUpdate]);
  const [details] = useState(new Map<T, string | undefined>());
  const [, refreshDetails] = useState({});

  // 可搜索菜单在搜索框里显示闪烁光标：真实终端光标在列表重绘时会跳到末尾，这里用模拟光标；
  // 按键后先保持常亮再继续闪烁。菜单结束时 inquirer 会清理定时器并恢复终端光标
  const cursorOn = useRef(true);
  const lastKey = useRef(0);
  const [, redraw] = useState(0);
  const blinks = useRef(0);
  useEffect(() => {
    if (!config.searchable) return;
    const timer = setInterval(() => {
      // 刚按过键时保持常亮，和真实终端光标一致
      if (Date.now() - lastKey.current < BLINK_MS) return;
      cursorOn.current = !cursorOn.current;
      redraw(++blinks.current);
    }, BLINK_MS);
    timer.unref?.();
    return () => clearInterval(timer);
  }, []);

  // 搜索时跨所有标签过滤并排序；没有搜索时按当前标签筛选
  const items = useMemo((): MenuEntry<T | typeof CUSTOM | typeof ACCEPT>[] => {
    if (query) {
      const filter = config.filter ?? defaultFilter;
      const scored = entries
        .filter(selectable)
        .filter((item) => !item.pinned)
        .map((item, order) => ({ item, order, score: filter(item, query) }))
        .filter((x): x is { item: MenuItem<T>; order: number; score: number } => x.score !== undefined)
        .sort((a, b) => a.score - b.score || a.order - b.order)
        .map((x) => x.item);
      const customText = config.multiple && scored.some(item => String(item.value) === query.trim()) ? undefined : config.customLabel?.(query);
      const custom: MenuItem<typeof CUSTOM>[] = customText ? [{ value: CUSTOM, label: customText }] : [];
      const suggested = scored.length ? [] : config.suggest?.(query) ?? [];
      const preferCustom = typeof config.customFirst === 'function' ? config.customFirst(query) : config.customFirst;
      if (custom.length && (preferCustom || !scored.length)) return [...custom, ...((scored.length || suggested.length) ? [{ separator: '' }, ...scored, ...suggested] : [])];
      return [...scored, ...suggested, ...(custom.length ? [{ separator: '' }, ...custom] : [])];
    }
    const current = config.tabs?.[tab];
    const visible = !current || tab === 0 ? entries : entries.filter((e) => !isSeparator(e) && !e.pinned && current.match(e));
    return config.multiple ? [
      { value: ACCEPT, label: config.multiple.acceptLabel(picked.size), disabled: !picked.size },
      { separator: '' }, ...visible,
    ] : visible;
  }, [query, tab, entries, picked]);

  const first = items.findIndex(selectable);
  const last = items.length - 1 - [...items].reverse().findIndex(selectable);
  const defaultValue = config.multiple?.initial.length ? ACCEPT : config.default;
  const defaultIndex = defaultValue === undefined ? -1 : items.findIndex((e) => selectable(e) && e.value === defaultValue);
  const [active, setActive] = useState(defaultIndex === -1 ? first : defaultIndex);
  const activeIndex = selectable(items[active]) ? active : first;
  const current = activeIndex >= 0 ? items[activeIndex] as MenuItem<T | typeof CUSTOM | typeof ACCEPT> : undefined;
  const detailKey = current?.value;

  // 选中项变化时取补充信息（只取一次，结果缓存）
  useEffect(() => {
    if (!config.asyncDetail || !current || current.value === CUSTOM || current.value === ACCEPT || details.has(current.value)) return;
    const item = current as MenuItem<T>;
    // Map 保留值的身份；先占位，避免切换行时重复发起尚未完成的请求。
    details.set(item.value, undefined);
    Promise.resolve().then(() => config.asyncDetail!(item)).then((text) => {
      details.set(item.value, text);
      refreshDetails({});
    }).catch(() => {});
  }, [detailKey]);

  const finish = (result: MenuResult<T>): void => {
    setStatus(result.action === 'escape' ? 'cancel' : 'done');
    done(result);
  };

  const updateQuery = (next: string): void => {
    setQuery(next);
    setActive(0);
  };

  useKeypress((key) => {
    cursorOn.current = true;
    lastKey.current = Date.now();
    if (config.multiple && (key.name === 'tab' || (isEnterKey(key) && current?.value === ACCEPT))) {
      if (picked.size) finish({ value: undefined as T, selected: [...picked], action: 'accept' });
      return;
    }
    if (isEnterKey(key)) {
      if (!current || current.value === ACCEPT) return;
      if (config.multiple && (current.value === CUSTOM || config.multiple.toggleable?.(current as MenuItem<T>) !== false)) {
        const values = current.value === CUSTOM ? config.multiple.parseCustom?.(query) ?? [] : [current.value];
        if (!values.length) return;
        const next = new Set(picked);
        for (const value of values) {
          if (current.value !== CUSTOM && next.has(value)) next.delete(value); else next.add(value);
        }
        const extra = values.filter(value => !entries.some(entry => selectable(entry) && entry.value === value));
        if (extra.length) setAdded([...added, ...extra.map(value => config.multiple!.customItem?.(value) ?? { value, label: String(value) })]);
        setPicked(next);
        updateQuery('');
        return;
      }
      if (current.value === CUSTOM) return finish({ value: undefined as T, action: 'custom', query });
      return finish({ value: current.value as T, query, ...(config.multiple ? { selected: [...picked] } : {}) });
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
    // 长列表翻页：PageUp / PageDown 一次移动一页，Home / End 跳到首尾（落在最近的可选项上）
    if (['pageup', 'pagedown', 'home', 'end'].includes(key.name)) {
      if (activeIndex < 0) return;
      const target = key.name === 'home' ? first : key.name === 'end' ? last
        : Math.max(first, Math.min(last, activeIndex + (key.name === 'pageup' ? -pageSize : pageSize)));
      const step = target >= activeIndex ? -1 : 1;
      let next = target;
      while (next !== activeIndex && !selectable(items[next])) next += step;
      setActive(next);
      return;
    }
    if (key.name === 'left' || key.name === 'right') {
      if (config.tabs?.length && !query) {
        const count = config.tabs.length;
        setTab((tab + (key.name === 'right' ? 1 : count - 1)) % count);
        setActive(0);
        return;
      }
      if (config.arrows && current && current.value !== CUSTOM && current.value !== ACCEPT) finish({ value: current.value as T, action: key.name });
      return;
    }
    if (config.searchable) {
      if (isBackspaceKey(key)) return updateQuery([...query].slice(0, -1).join(''));
      if (isPrintable(key)) return updateQuery(query + sequenceOf(key));
      return;
    }

  });

  const all: MenuItem<T | typeof ACCEPT>[] = entries.filter((e): e is MenuItem<T> => !isSeparator(e));
  if (config.multiple) all.push({ value: ACCEPT, label: config.multiple.acceptLabel(picked.size) });
  const labelWidth = Math.max(0, ...all.map((e) => visibleWidth(e.label)));
  const iconWidth = (config.multiple ? 2 : 0) + Math.max(0, ...all.map((e) => (e.icon ? visibleWidth(e.icon) + 1 : 0)));
  const showHints = hintFits(4 + iconWidth, labelWidth, Math.max(0, ...all.map((e) => visibleWidth(e.hint ?? ''))));
  const hintOf = (item: MenuItem<unknown>): string => (showHints ? item.hint ?? '' : '');
  // 选中行底色铺满：前缀「 ❯  」4 列 + 图标 + 标签 + 4 列间距 + 右侧值 + 2 列留白
  const width = Math.min(terminalWidth() - 2, Math.max(
    48,
    ...all.map((e) => 4 + iconWidth + labelWidth + 4 + visibleWidth(hintOf(e)) + 2),
  ));

  // 列表之外的各行：提示行、搜索框、标签、无结果提示、说明区与操作提示
  const detailTop = config.detailPosition === 'top';
  const searchLine = config.searchable ? (() => {
    const matches = !query ? 0 : entries.filter((e) => selectable(e) && !e.pinned && (config.filter ?? defaultFilter)(e, query) !== undefined).length;
    // 光标：输入后跟在搜索词末尾；未输入或清空后位于占位文字起始处
    const cursor = cursorOn.current ? CURSOR_ON : ' ';
    return query
      ? `  ${theme.brand('⌕')} ${theme.value(query)}${cursor}   ${theme.subtle(t('ui_search_found', { count: String(matches) }))}`
      : `  ${theme.subtle('⌕')} ${cursor}${theme.subtle(config.placeholder ?? t('ui_search_placeholder'))}`;
  })() : undefined;
  const tabsLine = config.tabs?.length ? renderMenuTabs(config.tabs, query ? 0 : tab) : undefined;
  const hasMatches = query ? entries.some((e) => selectable(e) && !e.pinned && (config.filter ?? defaultFilter)(e, query) !== undefined) : true;
  const emptyLine = hasMatches ? undefined : `  ${theme.subtle(config.emptyText?.(query) ?? t('ui_search_empty'))}`;
  // 操作提示：列表超出一页时加上翻页键
  const footerFor = (overflow: boolean): string => {
    if (config.multiple) return `  ${renderKeyHints([
      ['↑↓', t('ui_key_move')], ...(overflow ? [['PgUp/PgDn', t('ui_key_page')] as KeyHint] : []),
      [t('ui_key_enter'), t('model_multi_toggle')], ['Tab', t('model_multi_continue')],
      ['Esc', query ? t('ui_key_clear_search') : t('ui_key_back')],
      ['←→', t('ui_key_tabs')], [t('ui_key_type'), t('ui_key_search')],
    ])}`;
    const hints = config.footer ?? standardHints({ back: !!config.escape, search: config.searchable, tabs: !!config.tabs?.length, page: overflow });
    return `  ${renderKeyHints(query ? [['Esc', t('ui_key_clear_search')], [t('ui_key_enter'), t('ui_key_confirm')]] : hints)}`;
  };
  const extra = current && current.value !== CUSTOM && current.value !== ACCEPT ? details.get(current.value) : undefined;
  const detailText = [current?.description, extra].filter(Boolean).join('\n');
  // 上方说明区按所有选项中最多的行数固定高度，移动选中项时列表不跳动；放不下的行截断，避免折行
  const detailRows = detailTop
    ? Math.max(0, ...all.map((e) => (e.description ? e.description.split('\n').length : 0))) + (config.asyncDetail ? 1 : 0)
    : 0;
  const detailLines = detailTop ? Array.from({ length: detailRows }, (_, i) => {
    const line = detailText.split('\n')[i] ?? '';
    return visibleWidth(line) > terminalWidth() - 4 ? `  ${theme.subtle(truncate(stripAnsi(line), terminalWidth() - 4))}` : `  ${line}`;
  }) : [];
  const requestedPageSize = config.pageSize ?? 14;
  // 列表之外占用的行数；超出一页时多一行「上面 / 下面还有几个」，操作提示也多出翻页键
  const selectionLine = config.multiple ? `  ${theme.brand(truncate(config.multiple.summary([...picked]), Math.max(1, terminalWidth() - 4)))}` : undefined;
  const fixedRows = (overflow: boolean): number => (selectionLine ? 1 : 0) + (statusText ? screenRows(statusText) : 0) + 1 + (searchLine ? screenRows(searchLine) : 0) + (tabsLine ? screenRows(tabsLine) : 0) + (emptyLine ? 1 : 0)
    + (detailTop ? detailRows + 1 : 0) + (overflow ? 1 : 0) + 1 + screenRows(footerFor(overflow)) + 1;
  const fitPage = (overflow: boolean): number => detailTop && process.stdout.rows
    ? Math.max(Math.min(3, requestedPageSize), Math.min(requestedPageSize, process.stdout.rows - fixedRows(overflow)))
    : requestedPageSize;
  // 先按不超出估算；放不下全部选项时再按超出（多一行提示）重新计算页高
  const overflows = items.length > fitPage(false);
  const pageSize = fitPage(overflows);
  const footerText = footerFor(overflows);

  const page = usePagination({
    items,
    active: Math.max(0, activeIndex),
    pageSize,
    loop: false,
    renderItem({ item, isActive }) {
      if (isSeparator(item)) return item.separator ? `  ${theme.subtle(item.separator)}` : '';
      const check = config.multiple && item.value !== ACCEPT && config.multiple.toggleable?.(item as MenuItem<T>) !== false ? (picked.has(item.value as T) ? theme.success('☑') : theme.subtle('☐')) + ' ' : '';
      const icon = check + (item.icon ? `${item.icon} ` : '');
      const rawLabel = query && item.value !== CUSTOM ? highlightMatch(item.label, config.highlight?.(query) ?? query) : item.label;
      const label = padVisible((visibleWidth(rawLabel) > Math.max(1, terminalWidth() - 8 - iconWidth) ? truncate(stripAnsi(rawLabel), Math.max(1, terminalWidth() - 8 - iconWidth)) : rawLabel), Math.min(labelWidth, Math.max(1, terminalWidth() - 8 - iconWidth)));
      // 当前正在使用的项在第 3 列显示 ▪，标签仍与其他行对齐
      const mark = item.current ? theme.brand('▪') : ' ';
      if (item.disabled) {
        return `  ${mark} ${icon}${theme.subtle(label)}    ${theme.subtle(hintOf(item))}`;
      }
      if (isActive) {
        const text = ` ${theme.brandBold('❯')}${mark} ${icon}${chalk.bold.hex('#E8F6FF')(label)}    ${chalk.hex('#8BE9FF')(hintOf(item))}`;
        return highlightRow(text, width);
      }
      return `  ${mark} ${icon}${theme.value(label)}    ${theme.subtle(hintOf(item))}`;
    },
  });

  if (status === 'cancel') return '';
  if (status === 'done') {
    return `${theme.success('✔')} ${theme.heading(config.message)} ${theme.brand(config.multiple ? config.multiple.summary([...picked]) : current?.value === CUSTOM ? query : current?.label ?? '')}`;
  }
  const lines = [...(statusText ? [statusText] : []), `${theme.brand('?')} ${theme.heading(config.message)}`];
  // 说明在上方：紧跟提示行，下面一条分隔线，再是搜索框与标签
  if (detailTop && detailRows) lines.push(...detailLines, `  ${theme.border('─'.repeat(Math.max(1, Math.min(terminalWidth() - 4, 60))))}`);
  if (selectionLine) lines.push(selectionLine);
  if (searchLine) lines.push(searchLine);
  if (tabsLine) lines.push(tabsLine);
  if (emptyLine) lines.push(emptyLine);
  if (items.length) lines.push(page);
  // 与 usePagination（不循环）相同的规则推算可见窗口：选中项尽量居中，靠近首尾时贴边
  if (items.length > pageSize) {
    const middle = Math.floor(pageSize / 2);
    const active = Math.max(0, activeIndex);
    const below = items.length - active;
    const start = below < pageSize - middle ? items.length - pageSize : Math.max(0, active - middle);
    const count = (from: number, to: number): number => items.slice(from, to).filter(selectable).length;
    const above = count(0, start), rest = count(start + pageSize, items.length);
    const more = [above ? `↑ ${t('ui_more_above', { count: String(above) })}` : '', rest ? `↓ ${t('ui_more_below', { count: String(rest) })}` : ''].filter(Boolean).join('   ');
    if (more) lines.push(`  ${theme.subtle(more)}`);
  }
  if (!detailTop && detailText) {
    lines.push('');
    for (const line of detailText.split('\n')) lines.push(`  ${line}`);
  }
  lines.push('', footerText);
  return `${lines.join('\n')}${CURSOR_HIDE}`;
});

export function menuPrompt<T>(config: MenuConfig<T>, context?: { signal?: AbortSignal }): Promise<MenuResult<T>> {
  return menuView(config as MenuConfig<unknown>, context) as Promise<MenuResult<T>>;
}

// 返回勾选的值；按 Esc 返回 undefined

// ─── 多选：空格勾选，回车确认（没勾选时直接处理当前行），第一行「全选」，最后一行「继续」 ───

export interface CheckItem<T> {
  value: T;
  label: string;
  icon?: string;
  tag?: string;
  checked?: boolean;
  // 「全选」时选中的项（如已安装的工具）
  preferred?: boolean;
}

export interface CheckConfig<T> {
  message: string;
  items: CheckItem<T>[];
  // 「全选」行的文字
  allLabel?: string;
  // 「继续」行的文字（已选数量会自动附上）
  nextLabel?: string;
  // 允许一个都不选就继续（如「只保存，不改工具」）
  allowEmpty?: boolean;
  // 根据当前勾选生成底部提示
  summary?: (values: T[]) => string;
}

const checkView = createPrompt(<T,>(config: CheckConfig<T>, done: (values: T[] | undefined) => void) => {
  const { items } = config;
  const [checked, setChecked] = useState<boolean[]>(items.map((i) => !!i.checked));
  // 行号：0 = 全选，1..n = 工具，n + 1 = 继续
  const [active, setActive] = useState(1);
  const [status, setStatus] = useState<'idle' | 'done' | 'cancel'>('idle');
  const [warning, setWarning] = useState('');

  const count = checked.filter(Boolean).length;
  const preferred = items.map((i) => i.preferred !== false);
  const allChecked = preferred.some(Boolean) && preferred.every((included, i) => !included || checked[i]);
  const toggleAll = (): void => setChecked(checked.map((value, i) => preferred[i] ? !allChecked : value));
  const nextRow = items.length + 1;

  const finish = (values: T[]): void => {
    setStatus('done');
    done(values);
  };

  const proceed = (): void => {
    if (count === 0 && !config.allowEmpty) {
      setWarning(t('ui_check_empty'));
      return;
    }
    finish(items.filter((_, i) => checked[i]).map((i) => i.value));
  };

  useKeypress((key) => {
    setWarning('');
    if (isEscape(key)) {
      setStatus('cancel');
      done(undefined);
      return;
    }
    if (isUpKey(key)) return setActive(Math.max(0, active - 1));
    if (isDownKey(key)) return setActive(Math.min(nextRow, active + 1));
    if (key.name === 'right') return proceed();
    if (isSpaceKey(key)) {
      if (active === nextRow) return;
      if (active === 0) return toggleAll();
      setChecked(checked.map((c, i) => (i === active - 1 ? !c : c)));
      return;
    }
    if (isEnterKey(key)) {
      // 「全选」行：回车切换全选
      if (active === 0) return toggleAll();
      // 工具行：没勾选任何项时直接处理当前行，否则按已勾选的继续；
      // allowEmpty 时「不勾选」本身有含义（如只保存），回车按当前勾选继续
      if (active !== nextRow && count === 0 && !config.allowEmpty) return finish([items[active - 1].value]);
      return proceed();
    }
    // 不设字母快捷键：只用 ↑↓→、空格、回车、Esc，避免误以为能打字搜索时按到字母就全选或清空
  });

  const labelWidth = Math.min(Math.max(0, ...items.map((i) => visibleWidth(i.label))), Math.max(1, terminalWidth() - 12));
  const rowWidth = terminalWidth() - 2;
  const row = (index: number, text: string): string =>
    index === active ? highlightRow(` ${theme.brandBold('❯')} ${text}`, rowWidth) : `   ${text}`;
  const enterText = active !== 0 && active !== nextRow && count === 0 && !config.allowEmpty ? t('ui_key_this_one') : t('ui_key_next');
  const footer = renderKeyHints([['↑↓', t('ui_key_move')], [t('ui_key_space'), t('ui_key_toggle')], [t('ui_key_enter'), enterText], ['Esc', t('ui_key_back')]]);
  const summary = config.summary?.(items.filter((_, i) => checked[i]).map((i) => i.value));
  const extraRows = warning || summary ? 2 + (warning || summary || '').split('\n').length - 1 : 0;
  // 全选、继续与操作提示固定保留，只滚动中间的选项。
  const page = usePagination({ items, active: Math.max(0, Math.min(items.length - 1, active - 1)), loop: false,
    pageSize: Math.max(1, Math.min(14, (process.stdout.rows || 28) - 7 - footer.split('\n').length - extraRows)),
    renderItem({ item, index }) {
      const box = checked[index] ? theme.brand('☑') : theme.subtle('☐');
      const icon = item.icon ? `${item.icon} ` : '';
      const label = padVisible(truncate(item.label, labelWidth), labelWidth);
      const name = index + 1 === active ? chalk.bold.hex('#E8F6FF')(label) : item.preferred !== false ? theme.value(label) : theme.subtle(label);
      const tag = visibleWidth(`${icon}${label}    ${item.tag ?? ''}`) <= terminalWidth() - 8 ? item.tag ?? '' : '';
      return row(index + 1, `${box} ${icon}${name}    ${theme.subtle(tag)}`);
    },
  });
  if (status !== 'idle') {
    // 回车直接处理当前行时没有勾选，显示当前行
    const picked = items.filter((_, i) => checked[i]);
    const single = picked.length || config.allowEmpty ? [] : items.filter((_, i) => i === active - 1);
    const names = (picked.length ? picked : single).map((i) => i.label.trim()).join(', ');
    return status === 'cancel' ? '' : `${theme.success('✔')} ${theme.heading(config.message)} ${theme.brand(truncate(names || '—', 60))}`;
  }

  const lines = [`${theme.brand('?')} ${theme.heading(config.message)}`];
  lines.push(row(0, `${allChecked ? theme.brand('☑') : theme.subtle('☐')} ${theme.value(config.allLabel ?? t('ui_check_all'))}`));
  if (items.length) lines.push(page);
  lines.push(`   ${theme.border('─'.repeat(Math.max(1, rowWidth - 4)))}`);
  const nextText = `${config.nextLabel ?? t('ui_check_next')}${theme.subtle(`（${t('ui_selected_count', { count: String(count) })}）`)}  →`;
  lines.push(row(nextRow, active === nextRow ? chalk.bold.hex('#E8F6FF')(nextText) : theme.brand(nextText)));

  if (warning) lines.push('', `  ${theme.warning(warning)}`);
  else if (summary) lines.push('', `  ${summary}`);
  lines.push('', `  ${footer}`);
  return `${lines.join('\n')}${CURSOR_HIDE}`;
});

// ─── 密钥输入：编辑期间完全遮蔽，提交后显示摘要 ────────────────────────────────────

export interface SecretConfig {
  message: string;
  hint?: string;
  footer?: KeyHint[];
  // 允许 Esc 返回（返回 undefined）
  escape?: boolean;
  // 输入停顿片刻后，值满足条件就自动提交（粘贴 Key 后自动校验）
  autoSubmit?: (value: string) => boolean;
}

export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '•'.repeat(value.length);
  return `${value.slice(0, 4)}${theme.subtle('•'.repeat(Math.min(value.length - 8, 24)))}${value.slice(-4)}`;
}

const secretView = createPrompt((config: SecretConfig, done: (value: string | undefined) => void) => {
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<'idle' | 'done' | 'cancel'>('idle');

  // 粘贴完成（停顿 400ms）且格式完整时自动提交
  useEffect(() => {
    if (status !== 'idle' || !config.autoSubmit?.(value.trim())) return;
    const timer = setTimeout(() => {
      setStatus('done');
      done(value.trim());
    }, 400);
    return () => clearTimeout(timer);
  }, [value]);

  useKeypress((key, rl) => {
    if (isEnterKey(key)) {
      setStatus('done');
      done(value.trim());
      return;
    }
    if (isEscape(key) && config.escape) {
      setStatus('cancel');
      done(undefined);
      return;
    }
    if (isBackspaceKey(key) && !rl.line) {
      setValue('');
      return;
    }
    setValue(rl.line);
  });

  if (status === 'cancel') return '';
  if (status === 'done') {
    return value ? `${theme.success('✔')} ${theme.heading(config.message)} ${maskSecret(value)}` : '';
  }
  const count = value ? theme.subtle(`  ${t('ui_secret_length', { count: String(value.length) })}`) : '';
  const lines = [
    `${theme.brand('?')} ${theme.heading(config.message)}`,
    `  ${theme.brandBold('❯')} ${'•'.repeat(Math.min([...value].length, 32))}${chalk.bgHex('#19C2F0')(' ')}${count}`,
  ];
  if (config.hint) lines.push(`  ${theme.subtle(config.hint)}`);
  lines.push('', `  ${renderKeyHints(config.footer ?? [[t('ui_key_paste'), t('ui_key_paste_hint')], [t('ui_key_enter'), t('ui_key_confirm')], ...(config.escape ? [['Esc', t('ui_key_back')] as KeyHint] : [])])}`);
  return `${lines.join('\n')}${CURSOR_HIDE}`;
});

// ─── 文本输入：Esc 返回 ─────────────────────────────────────────────

export interface TextConfig {
  message: string;
  // 预填的值，可直接修改
  default?: string;
}

const textView = createPrompt((config: TextConfig, done: (value: string | undefined) => void) => {
  const [value, setValue] = useState(config.default ?? '');
  const [cursor, setCursor] = useState(config.default?.length ?? 0);
  const [status, setStatus] = useState<'idle' | 'done' | 'cancel'>('idle');

  useEffect((rl) => {
    if (config.default) rl.write(config.default);
  }, []);

  useKeypress((key, rl) => {
    if (isEnterKey(key)) {
      setStatus('done');
      done(value.trim());
      return;
    }
    if (isEscape(key)) {
      setStatus('cancel');
      done(undefined);
      return;
    }
    setValue(rl.line);
    setCursor((rl as typeof rl & { cursor: number }).cursor);
  });

  if (status === 'cancel') return '';
  if (status === 'done') return `${theme.success('✔')} ${theme.heading(config.message)} ${theme.brand(value.trim())}`;
  return [
    `${theme.brand('?')} ${theme.heading(config.message)}`,
    `  ${theme.brandBold('❯')} ${value.slice(0, cursor)}${chalk.bgHex('#19C2F0')([...value.slice(cursor)][0] ?? ' ')}${value.slice(cursor + ([...value.slice(cursor)][0]?.length ?? 0))}`,
    '',
    `  ${renderKeyHints([[t('ui_key_enter'), t('ui_key_confirm')], ['Esc', t('ui_key_back')]])}`,
  ].join('\n') + CURSOR_HIDE;
});

// ─── 按回车（或 Esc）继续 ────────────────────────────────────────────

const continueView = createPrompt((config: { message: string }, done: (value: void) => void) => {
  const [status, setStatus] = useState<'idle' | 'done'>('idle');
  useKeypress((key) => {
    if (isEnterKey(key) || isEscape(key)) {
      setStatus('done');
      done();
    }
  });
  if (status === 'done') return '';
  return `${theme.subtle(config.message)}${CURSOR_HIDE}`;
});

export function checkPrompt<T>(config: CheckConfig<T>): Promise<T[] | undefined> {
  return checkView(config as CheckConfig<unknown>) as Promise<T[] | undefined>;
}

// 返回输入的值；按 Esc 返回 undefined
export function secretPrompt(config: SecretConfig): Promise<string | undefined> {
  return secretView(config) as Promise<string | undefined>;
}

// 返回输入的值；按 Esc 返回 undefined
export function textPrompt(config: TextConfig): Promise<string | undefined> {
  return textView(config) as Promise<string | undefined>;
}

// 等待回车或 Esc
export function continuePrompt(message: string): Promise<void> {
  return continueView({ message }) as Promise<void>;
}
