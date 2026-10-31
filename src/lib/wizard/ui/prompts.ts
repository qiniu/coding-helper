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
      const preferCustom = typeof config.customFirst === 'function' ? config.customFirst(query) : config.customFirst;
      if (custom.length && (preferCustom || !scored.length)) return [...custom, ...((scored.length || suggested.length) ? [{ separator: '' }, ...scored, ...suggested] : [])];
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
    setStatus(result.action === 'escape' ? 'cancel' : 'done');
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

  if (status === 'cancel') return '';
  if (status === 'done') {
    return `${theme.success('✔')} ${theme.heading(config.message)} ${theme.brand(current?.value === CUSTOM ? query : current?.label ?? '')}`;
  }
  const lines = [...(statusText ? [statusText] : []), `${theme.brand('?')} ${theme.heading(config.message)}`];
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
    // 兼容老习惯的隐藏加速键
    if (key.name === 'a') setChecked(checked.map((value, i) => preferred[i] || value));
    else if (key.name === 'n') setChecked(items.map(() => false));
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
