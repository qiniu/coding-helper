import ora from 'ora';
import { modelService } from '../../model-service.js';
import { t } from '../../i18n.js';
import { configManager, type ModelConfig, type Connection } from '../../config.js';
import { marketModelService, getModelCapabilities, type MarketModelInfo } from '../../market-model-service.js';
import { RECOMMENDED_MODELS } from '../../core/quick-args.js';
import { formatContextSize } from '../../core/context.js';
import { closestModels, parseModelQuery, resolveModelId, scoreModel, vendorOf, VENDORS } from '../../core/model-search.js';
import type { ITool } from '../../tools/base-tool.js';
import { uiRenderer, type StepInfo } from '../ui/ui-renderer.js';
import { menuPrompt, type MenuEntry, type MenuItem } from '../ui/prompts.js';
import { theme } from '../ui/theme.js';
import { logger } from '../../../utils/logger.js';

type PickerModel = MarketModelInfo | { id: string; name: string; capabilitiesUnknown: true };
function capabilities(model: PickerModel) {
  return 'capabilitiesUnknown' in model ? { toolCall: true, maxInputTokens: 0, maxOutputTokens: 0, images: false, reasoning: false } : getModelCapabilities(model);
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
      return (await modelService.fetchModels(connection.baseUrl, apiKey)).map(model => ({ id: model.id, name: model.id, capabilitiesUnknown: true as const }));
    } catch { return []; }
  } finally { spinner.stop(); }
}

// 某个工具能否用这个模型：工具自己的预判优先，其次看是否支持工具调用
function supports(tool: ITool, m: PickerModel): boolean | undefined {
  if ('capabilitiesUnknown' in m) return undefined;
  if (!capabilities(m).toolCall) return false;
  return tool.checkModel ? undefined : true;
}

// 选中行下方：厂商 · 上下文 · 能力，以及每个工具能否使用
function describe(m: PickerModel, tools: ITool[]): string {
  const caps = capabilities(m);
  const vendor = VENDORS.find((v) => v.id === vendorOf(m.id))?.label ?? m.id.split('/')[0];
  const info = [
    vendor,
    t('model_context', { size: caps.maxInputTokens ? formatContextSize(caps.maxInputTokens) : '—' }),
    'capabilitiesUnknown' in m ? t('model_check_later') : caps.toolCall ? t('model_tool_call_yes') : t('model_tool_call_no'),
    ...(caps.images ? [t('model_vision')] : []),
  ].join(' · ');
  const compat = tools.map((tool) => {
    const ok = supports(tool, m);
    if (ok === true) return `${theme.success('✔')} ${theme.value(tool.displayName)}`;
    if (ok === false) return `${theme.danger('✖')} ${theme.subtle(tool.displayName)}`;
    return `${theme.warning('?')} ${theme.subtle(`${tool.displayName} ${t('model_check_later')}`)}`;
  }).join('  ');
  return [theme.subtle(info), compat].filter(Boolean).join('\n');
}

function modelRow(m: PickerModel, options: PickOptions, extra: Partial<MenuItem<string>> = {}): MenuItem<string> {
  const caps = capabilities(m);
  const blocked = options.tools.filter((tool) => supports(tool, m) === false);
  const tags = [
    RECOMMENDED_MODELS.includes(m.id) ? theme.success(t('model_tag_recommended')) : '',
    m.id === options.current ? theme.brand(t('model_tag_current')) : '',
    !caps.toolCall ? theme.warning(t('model_tag_no_tool_call')) : blocked.length ? theme.warning(`✖ ${blocked.map((tool) => tool.displayName).join(' ')}`) : '',
  ].filter(Boolean).join(' ');
  return {
    value: m.id,
    label: m.id,
    hint: `${theme.subtle((caps.maxInputTokens ? formatContextSize(caps.maxInputTokens) : '—').padStart(5))}  ${tags}`,
    description: describe(m, options.tools),
    search: m.name,
    ...extra,
  };
}

// 推荐模型在前，其余按名称
function sortModels(models: PickerModel[]): PickerModel[] {
  const rank = (id: string): number => {
    const i = RECOMMENDED_MODELS.indexOf(id);
    return i === -1 ? RECOMMENDED_MODELS.length : i;
  };
  return [...models].sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
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
      items,
      tabs: [
        { label: t('model_tab_all'), match: () => true },
        ...VENDORS.map((v) => ({ label: v.label, match: (item: MenuItem<string>) => item.value === SHOW_ALL || vendorOf(item.value) === v.id })),
      ],
      filter: (item, q) => {
        const m = byId.get(item.value);
        if (!m) return undefined;
        const caps = capabilities(m);
        if (parseModelQuery(q).toolCall && 'capabilitiesUnknown' in m) return undefined;
        return scoreModel({ id: m.id, name: m.name, reasoning: caps.reasoning, context: caps.maxInputTokens, toolCall: caps.toolCall, vision: caps.images }, q, {
          recommended: RECOMMENDED_MODELS.includes(m.id),
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
