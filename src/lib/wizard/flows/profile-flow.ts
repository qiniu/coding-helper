import ora from 'ora';
import { pickEndpoint } from './endpoint-selection-flow.js';
import { syncAfterChange } from './sync-tools-flow.js';
import { configManager, type Profile } from '../../config.js';
import { toolManager } from '../../tool-manager.js';
import { validateApiKey } from '../../api-validator.js';
import { isValidProfileName } from '../../core/quick-args.js';
import { getBaseUrl } from '../../endpoints.js';
import { getSyncTargets } from '../../core/tool-service.js';
import { modelService } from '../../model-service.js';
import { marketModelService } from '../../market-model-service.js';
import { menuPrompt, secretPrompt, textPrompt, type MenuEntry } from '../ui/prompts.js';
import { promptHelper } from '../ui/prompt-helper.js';
import { uiRenderer, connectedToolNames } from '../ui/ui-renderer.js';
import { theme } from '../ui/theme.js';
import { logger } from '../../../utils/logger.js';
import { padVisible, visibleWidth } from '../../../utils/string-width.js';
import { t } from '../../i18n.js';

// 使用该配置档的工具：只算已接入七牛的工具（未接入的工具不受配置档影响）
export function toolsUsingProfile(name: string): string[] {
  const connected = connectedToolNames();
  return toolManager.getAll().filter(tool => connected.includes(tool.name) && configManager.getConnection(tool.name).profile === name).map(tool => tool.name);
}

function displayNames(names: string[]): string {
  return names.map(name => toolManager.get(name)?.displayName ?? name).join('、');
}

function clearCaches(): void {
  modelService.clearCache();
  marketModelService.clearCache();
}

// 列表一行：● 名称（当前）  线路 · Key · N 个工具
function profileEntry(profile: Profile, active: string | undefined, nameWidth: number): MenuEntry<string> {
  const isActive = profile.name === active;
  const tools = toolsUsingProfile(profile.name);
  return {
    value: 'profile:' + profile.name,
    icon: isActive ? theme.success('●') : theme.border('○'),
    label: `${padVisible(profile.name, nameWidth)}  ${isActive ? theme.success(t('profile_action_use_current')) : ''}`,
    hint: `${uiRenderer.endpointLabel(profile.endpoint, profile.baseUrl)}  ·  ${uiRenderer.maskApiKey(profile.apiKey)}`,
    description: tools.length ? theme.subtle(t('profile_used_by', { tools: displayNames(tools) })) : theme.subtle(t('profile_unused')),
  };
}

// 配置档：列表 + 新建；选中一个进入操作页。Esc 返回
export async function runProfileFlow(): Promise<void> {
  let last: string | undefined;
  while (true) {
    const profiles = configManager.listProfiles();
    const active = configManager.getActiveProfile();
    uiRenderer.renderPage(t('profile_title'), undefined, t('profile_subtitle'));
    if (!profiles.length) {
      uiRenderer.renderHint(t('profile_empty_hint'));
      logger.newLine();
    }
    const nameWidth = Math.max(4, ...profiles.map(profile => visibleWidth(profile.name)));
    const { value, action } = await menuPrompt<string>({
      message: t('menu_select_action'),
      default: last,
      escape: true,
      items: [
        ...profiles.map(profile => profileEntry(profile, active, nameWidth)),
        ...(profiles.length ? [{ separator: '' }] : []),
        { value: '__add__', label: theme.brand(`+ ${t('profile_new')}`) },
        { value: '__back__', label: t('tool_back') },
      ],
    });
    if (action === 'escape' || value === '__back__') return;
    last = value;
    if (value === '__add__') { await guarded(createProfile); continue; }
    const profile = configManager.getProfile(value.slice('profile:'.length));
    if (profile) await profileActions(profile);
  }
}

// 单个配置档：信息面板 + 设为当前 / 测试连通 / 删除
async function profileActions(initial: Profile): Promise<void> {
  let last: string | undefined;
  while (true) {
    const profile = configManager.getProfile(initial.name);
    if (!profile) return;
    const active = configManager.getActiveProfile() === profile.name;
    const tools = toolsUsingProfile(profile.name);
    uiRenderer.renderPage(t('profile_actions_title', { name: profile.name }));
    uiRenderer.renderConfigPanel([
      { label: t('step_endpoint'), value: uiRenderer.endpointLabel(profile.endpoint, profile.baseUrl), configured: true },
      { label: 'API Key', value: uiRenderer.maskApiKey(profile.apiKey), configured: !!profile.apiKey },
      { label: t('profile_col_tools'), value: tools.length ? displayNames(tools) : t('profile_unused'), configured: tools.length > 0 },
    ]);
    const { value, action } = await menuPrompt<string>({
      message: t('menu_select_action'),
      default: last,
      escape: true,
      items: [
        { value: 'use', label: t('profile_action_use'), hint: active ? theme.success(t('profile_action_use_current')) : '', disabled: active },
        { value: 'test', label: t('profile_action_test') },
        { value: 'delete', label: theme.danger(t('profile_action_delete')) },
        { separator: '' },
        { value: 'back', label: t('tool_back') },
      ],
    });
    if (action === 'escape' || value === 'back') return;
    last = value;
    if (value === 'use') await guarded(() => useProfile(profile));
    else if (value === 'test') await testProfile(profile);
    else if (value === 'delete' && await guarded(() => deleteProfile(profile))) return;
  }
}

// 配置档操作失败时提示并等待确认，不把异常原文（可能含配置内容）带到终端；菜单会话的退出码保持不变
async function guarded<T>(operation: () => Promise<T>): Promise<T | undefined> {
  const previous = process.exitCode;
  try {
    return await operation();
  } catch {
    uiRenderer.renderError(t('profile_operation_failed'));
    await promptHelper.pressEnter();
    return undefined;
  } finally { process.exitCode = previous; }
}

// 设为当前：先记下仍指向七牛的工具，切换后由用户勾选要同步哪些
async function useProfile(profile: Profile): Promise<void> {
  const targets = getSyncTargets(toolManager.getAll());
  configManager.useProfile(profile.name);
  clearCaches();
  uiRenderer.renderPage(t('profile_actions_title', { name: profile.name }));
  uiRenderer.renderSuccess(t('profile_switched', { name: profile.name }));
  await syncAfterChange(false, targets);
  await promptHelper.pressEnter();
}

async function testProfile(profile: Profile): Promise<void> {
  const spinner = ora({ text: t('apikey_validating'), indent: 2 }).start();
  const result = await validateApiKey(profile.apiKey, profile.baseUrl);
  const endpoint = uiRenderer.endpointLabel(profile.endpoint, profile.baseUrl);
  if (result.valid) spinner.succeed(t('profile_test_ok', { name: profile.name, endpoint }));
  else spinner.fail(t('profile_test_failed', { name: profile.name, error: result.error ?? '' }));
  await promptHelper.pressEnter();
}

async function deleteProfile(profile: Profile): Promise<boolean> {
  const tools = toolsUsingProfile(profile.name);
  if (tools.length) uiRenderer.renderWarning(t('profile_delete_in_use', { tools: displayNames(tools) }));
  if (!await promptHelper.confirm(t('profile_delete_confirm', { name: profile.name }), false)) return false;
  configManager.removeProfile(profile.name);
  clearCaches();
  uiRenderer.renderSuccess(t('profile_deleted', { name: profile.name }));
  await promptHelper.pressEnter();
  return true;
}

// 新建：名称 → 线路 → Key → 校验后保存；任一步 Esc 放弃
async function createProfile(): Promise<void> {
  uiRenderer.renderPage(t('profile_new'), undefined, t('profile_subtitle'));
  let name: string | undefined;
  while (true) {
    name = (await textPrompt({ message: t('profile_name_prompt') }))?.trim();
    if (!name) return;
    if (!isValidProfileName(name)) uiRenderer.renderError(t('profile_name_invalid'));
    else if (configManager.getProfile(name)) uiRenderer.renderError(t('profile_name_exists', { name }));
    else break;
  }
  const endpoint = await pickEndpoint();
  if (!endpoint) return;
  const apiKey = (await secretPrompt({ message: t('apikey_prompt'), escape: true }))?.trim();
  if (!apiKey) return;
  const baseUrl = endpoint[1] ?? getBaseUrl(endpoint[0]);
  const spinner = ora({ text: t('apikey_validating'), indent: 2 }).start();
  const result = await validateApiKey(apiKey, baseUrl);
  if (!result.valid) {
    spinner.fail(t('apikey_invalid', { error: result.error ?? '' }));
    await promptHelper.pressEnter();
    return;
  }
  configManager.saveProfile(name, apiKey, endpoint[0], endpoint[1]);
  clearCaches();
  spinner.succeed(t('profile_saved', { name }));
  if (!configManager.getActiveProfile() && await promptHelper.confirm(t('profile_use_now', { name }), true)) await useProfile(configManager.getProfile(name)!);
  else await promptHelper.pressEnter();
}
