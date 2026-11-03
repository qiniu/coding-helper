import { modelConfigFor, savedModelFor } from '../../core/model-mapping.js';
import { slotOverrides, toolSlots } from '../../core/model-slots.js';
import type { PlanItem, PlanChange } from '../../core/write-plan.js';
import ora from 'ora';
import { modelService } from '../../model-service.js';
import { t, i18n } from '../../i18n.js';
import { configManager, type ModelConfig, type Connection } from '../../config.js';
import { marketModelService, getModelCapabilities, type MarketModelInfo } from '../../market-model-service.js';
import { formatContextSize } from '../../core/context.js';
import { closestModels, parseModelQuery, resolveModelId, scoreModel, publisherOf, modelPublishers } from '../../core/model-search.js';
import type { ITool } from '../../tools/base-tool.js';
import { uiRenderer, type StepInfo } from '../ui/ui-renderer.js';
import { menuPrompt, type MenuEntry, type MenuItem } from '../ui/prompts.js';
import { theme } from '../ui/theme.js';
import { logger } from '../../../utils/logger.js';

type PickerModel = MarketModelInfo | { id: string; name: string; owned_by?: string; capabilitiesUnknown: true };
function capabilities(model: PickerModel) {
  if ('capabilitiesUnknown' in model) return { toolCall: true, maxInputTokens: 0, maxOutputTokens: 0, images: false, reasoning: false };
  // 选择页只显示接口给出的限额，不能把写入配置时的保守兜底值当成模型元数据。
  return { ...getModelCapabilities(model), maxInputTokens: Math.max(0, model.model_constraints?.context_length ?? 0), maxOutputTokens: Math.max(0, model.model_constraints?.max_tokens ?? 0) };
}

const FOLLOW = '__follow__';
const SHOW_ALL = '__show_all__';
const SKIP = '__skip_model__';

export type PickResult = { model: string } | { follow: true } | 'back';

export interface PickOptions {
  connection?: Connection;
  allowSkip?: boolean;
  // 用来显示兼容性的工具
  tools: ITool[];
  title?: string;
  step?: StepInfo;
  // 默认选中的模型
  current?: string;
  // 设置槽位时传入主模型：第一行显示「跟随主模型」
  follow?: string;
}



// 按当前工具连接获取模型列表，缓存由市场服务维护。
async function loadModels(connection: Connection): Promise<PickerModel[] | undefined> {
  const apiKey = connection.apiKey;
  if (!apiKey) {
    uiRenderer.renderError(t('apikey_not_set'));
    return undefined;
  }
  const spinner = ora({ text: t('hermes_fetching_models'), indent: 2 }).start();
  try {
    return await marketModelService.fetchModels(connection.baseUrl, apiKey);
  } catch {
    // 自定义网关可能只提供标准模型目录；元数据不可用时仍保留手动输入。
    try {
      return (await modelService.fetchModels(connection.baseUrl, apiKey)).map(model => ({ id: model.id, name: model.id, owned_by: model.owned_by, capabilitiesUnknown: true as const }));
    } catch { return []; }
  } finally { spinner.stop(); }
}

// 某个工具能否用这个模型：工具自己的预判优先，其次看是否支持工具调用
function supports(tool: ITool, m: PickerModel): boolean | undefined {
  if ('capabilitiesUnknown' in m) return undefined;
  if (!capabilities(m).toolCall) return false;
  return tool.checkModel ? undefined : true;
}

// 模型广场的能力标签（features）在英文界面下的显示名；未收录的标签原样显示
const FEATURE_LABELS_EN: Record<string, string> = {
  '工具调用': 'Tool calls', '深度思考': 'Thinking', '图像理解': 'Image input', 'AI 编程': 'Coding',
  '结构化输出': 'Structured output', '联网搜索': 'Web search', '长上下文': 'Long context', '视频理解': 'Video input',
  '全模态理解': 'Omni-modal', '流式输出': 'Streaming', '上下文缓存': 'Context cache', '音频理解': 'Audio input',
};
const HOT_TAG_LABELS_EN: Record<string, string> = { '热门': 'Hot', '推荐': 'Recommended', '上新': 'New', '免费': 'Free', '限时免费': 'Free (limited time)' };
// 中文界面显示接口原文，其他语言按表翻译
function localized(map: Record<string, string>, text: string): string {
  return i18n.getLocale() === 'zh_CN' ? text : map[text] ?? text;
}

// 列表上方的选中模型概览，参照七牛模型广场的能力标签与 OpenCode 等 CLI 的模型详情行，只展示能力：
//   第 1 行：名称 · 发布方 · 上下文 · 最大输出，以及热门 / 上新 / 免费 / 即将下线标记
//   第 2 行：能力标签（工具调用、深度思考、图像理解、AI 编程……）
//   第 3 行：每个要配置的工具能否使用
// 内容全部取自 /v1/market/models，接口新增的标签无需改代码即可显示
function describe(m: PickerModel, tools: ITool[]): string {
  const compat = tools.map((tool) => {
    const ok = supports(tool, m);
    if (ok === true) return `${theme.success('✔')} ${theme.value(tool.displayName)}`;
    if (ok === false) return `${theme.danger('✖')} ${theme.subtle(tool.displayName)}`;
    return `${theme.warning('?')} ${theme.subtle(`${tool.displayName} ${t('model_check_later')}`)}`;
  }).join('  ');
  const issuer = publisherOf(m) ?? t('model_publisher_unknown');
  if ('capabilitiesUnknown' in m) {
    return [`${theme.value(m.id)}  ${theme.subtle(issuer)}`, theme.subtle(t('model_info_unknown')), compat].join('\n');
  }
  const caps = capabilities(m);
  const today = new Date().toISOString().slice(0, 10);
  const badges = [
    ...(m.hot_tags ?? []).map((tag) => (tag.includes('免费') ? theme.success : tag === '热门' ? theme.warning : theme.brand)(localized(HOT_TAG_LABELS_EN, tag))),
    ...(m.retirement_at && m.retirement_at >= today ? [theme.danger(t('model_retiring', { date: m.retirement_at }))] : []),
  ];
  const facts = [
    issuer,
    t('model_context', { size: caps.maxInputTokens ? formatContextSize(caps.maxInputTokens) : '—' }),
    t('model_max_output', { size: caps.maxOutputTokens ? formatContextSize(caps.maxOutputTokens) : '—' }),
  ].join(' · ');
  const title = [`${theme.value(m.name || m.id)}  ${theme.subtle(facts)}`, ...badges].join('  ');
  // 能力标签：模型广场的 features，缺失时由 architecture 补齐工具调用 / 深度思考 / 图像理解
  const features = [...(m.features ?? [])];
  if (caps.toolCall && !features.includes('工具调用')) features.unshift('工具调用');
  if (caps.reasoning && !features.includes('深度思考')) features.push('深度思考');
  if (caps.images && !features.includes('图像理解')) features.push('图像理解');
  const tags = [
    ...(caps.toolCall ? [] : [theme.warning(t('model_tool_call_no'))]),
    ...features.map((feature) => theme.brand(localized(FEATURE_LABELS_EN, feature))),
  ].join(theme.subtle(' · '));
  return [title, tags, compat].join('\n');
}

function modelRow(m: PickerModel, options: PickOptions, extra: Partial<MenuItem<string>> = {}): MenuItem<string> {
  const caps = capabilities(m);
  const blocked = options.tools.filter((tool) => supports(tool, m) === false);
  const tags = [
    ...('hot_tags' in m ? (m.hot_tags ?? []).map(tag => theme.success(localized(HOT_TAG_LABELS_EN, tag))) : []),
    m.id === options.current ? theme.brand(t('model_tag_current')) : '',
    !caps.toolCall ? theme.warning(t('model_tag_no_tool_call')) : blocked.length ? theme.warning(`✖ ${blocked.map((tool) => tool.displayName).join(' ')}`) : '',
  ].filter(Boolean).join(' ');
  return {
    value: m.id,
    label: m.id,
    hint: `${theme.subtle((caps.maxInputTokens ? formatContextSize(caps.maxInputTokens) : '—').padStart(5))}  ${tags}`,
    description: describe(m, options.tools),
    current: m.id === options.current,
    search: m.name,
    ...extra,
  };
}

// 只根据接口的推荐 / 热门标签排序，不为本地固定模型添加推荐标记。
function featured(model: PickerModel): boolean {
  return 'hot_tags' in model && (model.hot_tags ?? []).some(tag => tag === '推荐' || tag === '热门');
}

function sortModels(models: PickerModel[]): PickerModel[] {
  return [...models].sort((a, b) => Number(featured(b)) - Number(featured(a)) || a.id.localeCompare(b.id));
}

// 选模型：直接打字搜索，←→ 切换厂商，默认只列支持工具调用的模型；Esc 返回上一步
export async function pickModel(options: PickOptions): Promise<PickResult> {
  const title = options.title ?? t('model_pick_title');
  const connection = { ...(options.connection ?? configManager.getConnection(options.tools[0]?.name)) };
  uiRenderer.renderPage(title, options.step, undefined, connection);
  const models = await loadModels(connection);
  if (!models) return 'back';

  let showAll = false;
  let last: string | undefined = options.current;
  while (true) {
    uiRenderer.renderPage(title, options.step, undefined, connection);
    const usable = sortModels(models.filter((m) => showAll || capabilities(m).toolCall));
    const byId = new Map(models.map((m) => [m.id, m]));
    const publishers = modelPublishers(usable);
    const recent = (configManager.getModels().recentModels ?? []).filter((id) => usable.some((m) => m.id === id));
    logger.log(`  ${theme.subtle(t('model_pick_summary', {
      tools: options.tools.map((tool) => tool.displayName).join(' · '),
      count: String(usable.length),
      filter: showAll ? t('model_filter_all') : t('model_filter_tool_call'),
    }))}`);
    logger.newLine();

    const items: MenuEntry<string>[] = [
      ...(options.allowSkip ? [{ value: SKIP, label: t('model_skip_option') }, { separator: '' }] : []),
      ...(options.follow ? [{ value: FOLLOW, label: t('slot_follow_main'), hint: theme.subtle(options.follow) }, { separator: '' }] : []),
      ...(recent.length ? [
        { separator: theme.subtle(t('model_section_recent')) },
        ...recent.map((id) => modelRow(byId.get(id)!, options, { pinned: true })),
        { separator: theme.subtle(t('model_section_all')) },
      ] : []),
      ...usable.map((m) => modelRow(m, options)),
      { separator: '' },
      { value: SHOW_ALL, label: showAll ? t('model_show_tool_call_only') : t('model_show_all', { count: String(models.length) }) },
    ];

    const { value, action, query } = await menuPrompt<string>({
      message: options.follow ? t('slot_pick_prompt') : t('model_pick_prompt'),
      default: last,
      escape: true,
      searchable: true,
      customFirst: q => q.trim().includes('/') && !q.trim().endsWith('/') && !byId.has(q.trim()),
      pageSize: 12,
      // 概览放在列表上方，随选中项、搜索与厂商切换实时更新
      detailPosition: 'top',
      items,
      tabs: [
        { label: t('model_tab_all'), match: () => true },
        ...publishers.map(name => ({ label: name, match: (item: MenuItem<string>) => item.value === SHOW_ALL || publisherOf(byId.get(item.value))?.toLowerCase() === name.toLowerCase() })),
        ...(usable.some(m => !publisherOf(m)) ? [{ label: t('model_publisher_unknown'), match: (item: MenuItem<string>) => item.value === SHOW_ALL || (byId.has(item.value) && !publisherOf(byId.get(item.value)!)) }] : []),
      ],
      filter: (item, q) => {
        const m = byId.get(item.value);
        if (!m) return undefined;
        const caps = capabilities(m);
        if (parseModelQuery(q).toolCall && 'capabilitiesUnknown' in m) return undefined;
        return scoreModel({ id: m.id, name: m.name, publisher: publisherOf(m), reasoning: caps.reasoning, context: caps.maxInputTokens, toolCall: caps.toolCall, vision: caps.images }, q, {
          recommended: featured(m),
          recent: recent.includes(m.id),
        });
      },
      placeholder: t('model_search_placeholder'),
      highlight: (q) => parseModelQuery(q).words.join(''),
      emptyText: (q) => t('model_search_none', { query: q }),
      suggest: (q) => {
        const parsed = parseModelQuery(q);
        const candidates = usable.filter(m => { const caps = capabilities(m); return (!parsed.vision || caps.images) && (!parsed.minContext || caps.maxInputTokens >= parsed.minContext) && (!parsed.toolCall || (!('capabilitiesUnknown' in m) && caps.toolCall)) && (!parsed.reasoning || caps.reasoning); });
        return closestModels(candidates.map(m => m.id), q).map(id => modelRow(byId.get(id)!, options));
      },
      // 像模型 ID 的输入才提供「使用自定义模型 ID」（中文厂商名、200k、看图 这类过滤词不算）
      customLabel: (q) => /^[\w.\-/:]+$/.test(q.trim()) && !parseModelQuery(q).minContext && !parseModelQuery(q).vision && !parseModelQuery(q).toolCall && !parseModelQuery(q).reasoning && !byId.has(q.trim())
        ? t('model_custom_value', { value: resolveModelId(q, models.map((m) => m.id)) })
        : undefined,
    });
    if (action === 'escape') return 'back';
    if (value === SHOW_ALL) {
      showAll = !showAll;
      last = SHOW_ALL;
      continue;
    }
    if (value === SKIP) return 'back';
    if (value === FOLLOW) return { follow: true };
    const model = action === 'custom' ? resolveModelId(query ?? '', models.map((m) => m.id)) : value;
    if (!model) continue;

    return { model };
  }
}


function mainLabel(tool: ITool): string {
  return tool.name === 'claude-code' ? t('plan_claude_main') : t('plan_model');
}

// 工具当前的主模型（未接入时为空）
export function currentMainModel(tool: ITool, models: ModelConfig = configManager.getModels()): string | undefined {
  return tool.isConfigured?.() ? savedModelFor(tool, models) ?? tool.defaultModel : undefined;
}

// Claude Code 使用内置模型：不写自定义模型映射，清空各槽位（与原「不自定义模型」流程写入的内容一致）
export function builtinPlanForClaude(tool: ITool): PlanItem {
  const saved = configManager.getModels();
  const builtinValue = t('slots_builtin_value');
  const before = saved.claudeCode?.useDefaultModels ? builtinValue : currentMainModel(tool, saved);
  const previous = slotOverrides(tool.name, saved);
  const changes: PlanChange[] = [
    { label: mainLabel(tool), before, after: builtinValue },
    ...toolSlots(tool.name).map((slot) => ({ label: t(slot.labelKey), before: before === builtinValue ? builtinValue : before ? previous[slot.id] ?? before : undefined, after: builtinValue })),
  ];
  return {
    tool,
    models: {
      claudeCode: { haikuModel: undefined, sonnetModel: undefined, opusModel: undefined, subagentModel: undefined, useDefaultModels: true },
      slotModels: { [tool.name]: {} },
    },
    changes,
    overrides: {},
    builtin: true,
  };
}

// 一个工具的写入计划：主模型 + 各槽位（单独设置过的保持不变，其余跟随主模型）
export function planForTool(tool: ITool, main: string, overrides: Record<string, string> = slotOverrides(tool.name), note = ''): PlanItem {
  const saved = configManager.getModels();
  const before = currentMainModel(tool, saved);
  const previous = slotOverrides(tool.name, saved);
  const changes: PlanChange[] = [{ label: mainLabel(tool), before, after: main, note }];
  for (const slot of toolSlots(tool.name)) {
    const own = overrides[slot.id];
    const was = before ? previous[slot.id] ?? before : undefined;
    changes.push(own
      ? { label: t(slot.labelKey), before: was, after: own, note: own === previous[slot.id] ? t('slot_kept') : t('slot_custom') }
      : { label: t(slot.labelKey), before: was, after: main, note: t('slot_following') });
  }
  const withSlots: ModelConfig = { slotModels: { [tool.name]: overrides } };
  return {
    tool,
    models: { ...modelConfigFor(tool, main, withSlots), slotModels: { [tool.name]: overrides } },
    changes,
    main,
    overrides,
  };
}
