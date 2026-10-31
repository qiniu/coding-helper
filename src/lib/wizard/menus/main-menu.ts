import { t, i18n } from '../../i18n.js';
import { promptHelper } from '../ui/prompt-helper.js';
import { uiRenderer, connectedToolNames } from '../ui/ui-renderer.js';
import { menuPrompt } from '../ui/prompts.js';
import { runLanguageFlow } from '../flows/language-flow.js';
import { runEndpointSelectionFlow } from '../flows/endpoint-selection-flow.js';
import { runApiKeyFlow } from '../flows/api-key-flow.js';
import { runContextFlow, contextMenuHint } from '../flows/context-flow.js';
import { runProfileFlow } from '../flows/profile-flow.js';
import { showToolMenu } from './tool-menu.js';
import { toolManager } from '../../tool-manager.js';
import { configManager, type ModelConfig } from '../../config.js';
import { getRestoreTargets } from '../../core/tool-service.js';
import { savedModelFor } from '../../core/model-mapping.js';
import { logger } from '../../../utils/logger.js';
import { runToolSetupFlow } from '../flows/tool-setup-flow.js';
import { theme } from '../ui/theme.js';
import { selectTargets } from '../ui/write-plan.js';
import { doctorCommand } from '../../../commands/doctor.js';
import { restoreCommand } from '../../../commands/restore.js';

// 主菜单操作
type MainMenuAction = 'setup' | 'model' | 'tools' | 'account' | 'doctor' | 'more';
type MoreAction = 'context' | 'restore' | 'language' | 'update' | 'clear_config';

// 主菜单：6 项，右侧显示当前值；Esc 退出
export async function showMainMenu(): Promise<void> {
  let last: MainMenuAction | undefined;
  while (true) {
    uiRenderer.renderHeader({ full: true });

    const connected = connectedToolNames();
    // 只检测是否安装，不查版本（查版本要逐个启动工具，太慢）
    const installed = toolManager.getAll().filter(tool => { try { return !tool.launchOnly && tool.isInstalled() !== false; } catch { return false; } });
    const pending = installed.filter((tool) => !connected.includes(tool.name)).length;
    const total = toolManager.getAll().filter((tool) => !tool.launchOnly).length;
    const models = configManager.getModels();
    const apiKey = configManager.getApiKey();

    const { value: action, action: key } = await menuPrompt<MainMenuAction>({
      message: t('menu_select_action'),
      default: last,
      escape: true,
      items: [
        { value: 'setup', label: t('menu_setup_tools'), hint: pending > 0 ? t('menu_hint_pending', { count: String(pending) }) : t('menu_hint_all_connected') },
        { value: 'model', label: t('menu_switch_model'), hint: currentModelHint(connected, models) },
        { value: 'tools', label: t('menu_my_tools'), hint: t('menu_hint_connected', { count: String(connected.length), total: String(total) }) },
        { value: 'account', label: t('menu_account'), hint: apiKey ? `${uiRenderer.maskApiKey(apiKey)} · ${uiRenderer.endpointLabel()}` : t('config_view_not_set') },
        { value: 'doctor', label: t('menu_doctor') },
        { value: 'more', label: t('menu_more'), hint: t('menu_more_hint') },
      ],
      footer: [['↑↓', t('ui_key_move')], [t('ui_key_enter'), t('ui_key_confirm')], ['Esc', t('menu_exit')]],
    });
    if (key === 'escape') return;
    last = action;

    switch (action) {
      case 'setup':
        await runToolSetupFlow();
        break;
      case 'model':
        await runSwitchModelFlow();
        break;
      case 'tools':
        await showToolSelector();
        break;
      case 'account':
        await showAccountMenu();
        break;
      case 'doctor':
        uiRenderer.renderPage(t('menu_doctor'));
        await doctorCommand();
        await promptHelper.pressEnter(t('result_back_to_menu'));
        break;
      case 'more':
        if (await showMoreMenu()) return;
        break;
    }
  }
}

// 账号与线路：API Key、线路、配置档
async function showAccountMenu(): Promise<void> {
  let last: string | undefined;
  while (true) {
    uiRenderer.renderPage(t('menu_account'));
    const apiKey = configManager.getApiKey();
    const profiles = configManager.listProfiles();
    const active = configManager.getActiveProfile();
    const { value, action } = await menuPrompt<'apikey' | 'endpoint' | 'profile'>({
      message: t('menu_select_action'),
      default: last as 'apikey' | undefined,
      escape: true,
      items: [
        { value: 'apikey', label: t('menu_configure_apikey'), hint: apiKey ? uiRenderer.maskApiKey(apiKey) : t('config_view_not_set') },
        { value: 'endpoint', label: t('menu_configure_endpoint'), hint: uiRenderer.endpointLabel() },
        {
          value: 'profile',
          label: t('menu_profiles'),
          hint: profiles.length ? t('account_profile_hint', { name: active ?? '—', count: String(profiles.length) }) : t('menu_hint_profile_none'),
          description: theme.subtle(t('account_profile_desc')),
        },
      ],
    });
    if (action === 'escape') return;
    last = value;
    if (value === 'apikey') await runApiKeyFlow();
    else if (value === 'endpoint') await runEndpointSelectionFlow();
    else await runProfileFlow();
  }
}

// 更多：上下文大小 · 还原 · 语言 · 更新 · 清除配置；清除后返回 true（退出主菜单）
async function showMoreMenu(): Promise<boolean> {
  let last: MoreAction | undefined;
  while (true) {
    uiRenderer.renderPage(t('menu_more'));
    const connected = connectedToolNames();
    const restorable = getRestoreTargets(toolManager.getAll());
    const { value, action } = await menuPrompt<MoreAction>({
      message: t('menu_select_action'),
      default: last,
      escape: true,
      items: [
        { value: 'context', label: t('menu_context'), hint: contextMenuHint(connected) },
        { value: 'restore', label: t('menu_restore'), hint: restorable.length ? t('menu_hint_restore', { count: String(restorable.length) }) : '' },
        { value: 'language', label: t('menu_configure_language'), hint: i18n.getLocale() === 'zh_CN' ? '简体中文' : 'English' },
        { value: 'update', label: t('menu_update_helper') },
        { value: 'clear_config', label: t('menu_clear_config') },
      ],
    });
    if (action === 'escape') return false;
    last = value;
    switch (value) {
      case 'context':
        await runContextFlow();
        break;
      case 'restore':
        await restoreSelected();
        break;
      case 'language':
        uiRenderer.renderPage(t('menu_configure_language'));
        await runLanguageFlow();
        break;
      case 'update':
        await updateHelper();
        break;
      case 'clear_config':
        if (await handleClearConfig()) return true;
        break;
    }
  }
}

// 已接入工具的模型：统一时显示模型名，不一致时显示「各不相同」
function currentModelHint(connected: string[], models: ModelConfig): string {
  const used = [...new Set(toolManager.getAll()
    .filter((tool) => connected.includes(tool.name))
    .map((tool) => savedModelFor(tool, models) ?? tool.defaultModel)
    .filter((m): m is string => !!m))];
  if (used.length === 1) return used[0];
  if (used.length > 1) return t('menu_hint_models_mixed', { count: String(used.length) });
  return models.defaultModel ?? t('config_view_not_set');
}

// 还原：勾选要还原的工具（默认不勾）后确认
async function restoreSelected(): Promise<void> {
  const tools = getRestoreTargets(toolManager.getAll());
  uiRenderer.renderPage(t('menu_restore'), undefined, t('restore_subtitle'));
  if (tools.length === 0) {
    uiRenderer.renderHint(t('restore_nothing'));
    await promptHelper.pressEnter();
    return;
  }
  const targets = await selectTargets(t('targets_prompt_restore'), tools);
  if (!targets || targets.length === 0) return;
  // 独立 restore 命令的失败码不应影响确认结果后继续使用的菜单会话。
  const previousExitCode = process.exitCode;
  try {
    await restoreCommand(targets.map((tool) => tool.name).join(','), { yes: false });
    await promptHelper.pressEnter();
  } finally { process.exitCode = previousExitCode; }
}

// 更新 Coding Helper
async function updateHelper(): Promise<void> {
  logger.info(t('update_running'));
  const { execSync } = await import('node:child_process');
  try {
    execSync('npm install -g qiniu-coding-helper@latest', { stdio: 'inherit' });
    uiRenderer.renderSuccess(t('update_latest'));
  } catch {
    uiRenderer.renderError(t('error_unknown'));
  }
  await promptHelper.pressEnter();
}

// 清除配置，成功返回 true
async function handleClearConfig(): Promise<boolean> {
  uiRenderer.renderHeader();
  const confirmed = await promptHelper.confirm(t('clear_config_confirm'), false);
  if (!confirmed) return false;

  configManager.clearConfig();
  uiRenderer.renderHeader();
  uiRenderer.renderSuccess(t('clear_config_success'));
  return true;
}

// 工具选择器（当有多个工具时选择）
async function showToolSelector(): Promise<void> {
  const tools = toolManager.getAll();

  uiRenderer.renderHeader();
  uiRenderer.renderTitle(t('menu_my_tools'));

  const choices = tools.map((tool) => ({
    name: tool.displayName,
    value: tool.name,
  }));

  choices.push({ name: t('tool_back'), value: '__back__' });
  const toolName = await promptHelper.select<string>(t('menu_select_action'), choices);
  const tool = toolManager.get(toolName);
  if (tool) {
    await showToolMenu(tool);
  }
}

async function runSwitchModelFlow(): Promise<void> {
  const connected = connectedToolNames();
  if (!connected.length) {
    uiRenderer.renderPage(t('menu_switch_model'));
    uiRenderer.renderHint(t('menu_switch_model_none'));
    await promptHelper.pressEnter();
    return;
  }
  await runToolSetupFlow(toolManager.getAll().filter(tool => connected.includes(tool.name)));
}
