import { executeToolUpdate } from '../../../utils/update-command.js';
import spawn from 'cross-spawn';
import { findCommand } from '../../../utils/find-command.js';
import { runCommand } from '../../../commands/run.js';
import { LauncherShutdown } from '../../../utils/launcher-shutdown.js';
import chalk from 'chalk';
import select from '@inquirer/select';
import { t } from '../../i18n.js';
import { configManager } from '../../config.js';
import { promptHelper } from '../ui/prompt-helper.js';
import { uiRenderer } from '../ui/ui-renderer.js';
import { theme } from '../ui/theme.js';
import type { ITool } from '../../tools/base-tool.js';
import { logger } from '../../../utils/logger.js';
import { fetchLatestVersion, isNewerVersion } from '../../version-service.js';
import { applyTool, removeTool, hasSavedToolModelConfig } from '../../core/tool-service.js';
export { hasSavedToolModelConfig } from '../../core/tool-service.js';

// 工具菜单操作
type ToolMenuAction =
  | 'models'
  | 'load'
  | 'unload'
  | 'launch'
  | 'update'
  | 'view'
  | 'back';

// 工具配置菜单
export async function showToolMenu(tool: ITool): Promise<void> {
  if (!hasSavedToolModelConfig(tool, configManager.getModels())) {
    await runInitialToolSetup(tool);
  }

  // 异步获取最新版本（不阻塞菜单渲染）
  let latestVersion: string | null = null;
  let fetchCompleted = false;
  let fetchPromise: Promise<string | null> | null = null;

  if (tool.npmPackageName) {
    fetchPromise = fetchLatestVersion(tool.npmPackageName, tool.npmVersionMajor);
    fetchPromise
      .then(v => {
        latestVersion = v;
      })
      .catch(() => {})
      .finally(() => {
        fetchCompleted = true;
      });
  }

  while (true) {
    uiRenderer.renderHeader();
    uiRenderer.renderTitle(t('tool_menu_title', { tool: tool.displayName }));

    // 显示版本信息
    const installedVersion = tool.getVersion();
    renderVersionInfo(
      installedVersion,
      latestVersion,
      fetchCompleted,
      tool.npmPackageName,
      tool.isInstalled() === null,
    );

    // 如果最新版本还未获取到，设置 AbortController 以便版本到达后自动刷新
    const controller = new AbortController();
    if (fetchPromise && isLatestVersionFetchPending({ fetchPromise, fetchCompleted })) {
      fetchPromise.then(() => {
        if (!controller.signal.aborted) {
          controller.abort();
        }
      });
    }

    let action: ToolMenuAction;
    try {
      action = await select<ToolMenuAction>({
        message: t('menu_select_action'),
        choices: [
          { name: `${theme.icon('◆')} ${t('tool_configure_models')}`, value: 'models' as const },
          ...(tool.launchOnly ? [] : [
            { name: t('tool_load_config'), value: 'load' as const },
            { name: t('tool_unload_config'), value: 'unload' as const },
          ]),
          { name: `${theme.icon('▸')} ${t('tool_launch')}`, value: 'launch' as const },
          { name: `${theme.dimIcon('△')} ${t('tool_update')}`, value: 'update' as const },
          { name: `${theme.dimIcon('▪')} ${t('tool_view_config')}`, value: 'view' as const },
          { name: `${theme.dimIcon('◁')} ${t('tool_back')}`, value: 'back' as const },
        ],
      }, { signal: controller.signal });
    } catch (e: unknown) {
      // 版本查询完成触发的 abort，重新渲染菜单
      if (e instanceof Error && e.name === 'AbortPromptError') {
        continue;
      }
      throw e;
    }

    switch (action) {
      case 'models':
        await tool.runModelConfigFlow();
        break;

      case 'load':
        await loadConfig(tool);
        break;

      case 'unload':
        await unloadToolConfig(tool);
        break;

      case 'launch':
        await launchTool(tool);
        break;

      case 'update':
        await updateTool(tool);
        // 更新后重新获取最新版本信息
        if (tool.npmPackageName) {
          fetchPromise = fetchLatestVersion(tool.npmPackageName, tool.npmVersionMajor);
          fetchCompleted = false;
          latestVersion = await fetchPromise;
          fetchCompleted = true;
        }
        break;

      case 'view':
        await viewConfig(tool);
        break;

      case 'back':
        return;
    }
  }
}

// 卸载错误包含恢复操作指引，必须展示，不能只显示通用失败。
export async function unloadToolConfig(tool: ITool): Promise<void> {
  uiRenderer.renderHeader();
  if (!await promptHelper.confirm(t('tool_config_unload_confirm', { tool: tool.displayName }))) return;
  try {
    const result = await removeTool(tool);
    if (result.status !== 'success') throw new Error(t(result.reason ?? 'tool_config_unload_failed', { tool: tool.displayName }));
    uiRenderer.renderHeader();
    uiRenderer.renderSuccess(t('tool_config_unloaded', { tool: tool.displayName }));
  } catch (error: unknown) {
    uiRenderer.renderHeader();
    uiRenderer.renderError(t('tool_config_unload_failed', { tool: tool.displayName }));
    if (error instanceof Error && error.message) uiRenderer.renderError(error.message);
  }
  await promptHelper.pressEnter();
}

export function isLatestVersionFetchPending(state: {
  fetchPromise: Promise<string | null> | null;
  fetchCompleted: boolean;
}): state is { fetchPromise: Promise<string | null>; fetchCompleted: false } {
  return Boolean(state.fetchPromise && !state.fetchCompleted);
}

async function runInitialToolSetup(tool: ITool): Promise<void> {
  const completed = await tool.runModelConfigFlow();
  if (!completed || tool.launchOnly) return;

  if (tool.name === 'codex') {
    uiRenderer.renderHeader();
    const confirmed = await promptHelper.confirm(t('tool_config_load_confirm', { tool: tool.displayName }));
    if (!confirmed) return;
  }

  await applyConfig(tool);
}

// 渲染版本信息区域
function renderVersionInfo(
  installed: string | null,
  latest: string | null,
  fetchCompleted: boolean,
  npmPackageName?: string,
  isDesktop = false,
): void {
  // 桌面应用不显示版本信息
  if (isDesktop) {
    return;
  }

  // 当前版本
  const installedDisplay = installed
    ? chalk.white(installed)
    : chalk.yellow(t('tool_version_not_installed'));
  uiRenderer.renderConfigItem(t('tool_version_installed'), installedDisplay);

  if (!npmPackageName) {
    logger.newLine();
    return;
  }

  // 最新版本
  if (latest) {
    const hasUpdate = installed ? isNewerVersion(installed, latest) : false;
    if (hasUpdate) {
      uiRenderer.renderConfigItem(
        t('tool_version_latest'),
        `${chalk.green(latest)}  ${chalk.yellow(t('tool_version_update_hint'))}`,
      );
    } else {
      uiRenderer.renderConfigItem(
        t('tool_version_latest'),
        `${chalk.white(latest)}  ${chalk.green(t('tool_version_up_to_date'))}`,
      );
    }
  } else {
    uiRenderer.renderConfigItem(
      t('tool_version_latest'),
      chalk.dim(t(getMissingLatestVersionDisplayKey(fetchCompleted))),
    );
  }

  logger.newLine();
}

export function getMissingLatestVersionDisplayKey(fetchCompleted: boolean): string {
  return fetchCompleted ? 'tool_version_unknown' : 'tool_version_checking';
}

// 装载配置到工具
async function loadConfig(tool: ITool): Promise<void> {
  const apiKey = configManager.getConnection(tool.name).apiKey;
  if (!apiKey) {
    uiRenderer.renderError(t('apikey_not_set'));
    await promptHelper.pressEnter();
    return;
  }

  // 清屏后二次确认
  uiRenderer.renderHeader();
  const confirmed = await promptHelper.confirm(
    t('tool_config_load_confirm', { tool: tool.displayName }),
  );
  if (!confirmed) return;

  await applyConfig(tool);
}

async function applyConfig(tool: ITool): Promise<void> {
  const apiKey = configManager.getConnection(tool.name).apiKey;
  if (!apiKey) {
    uiRenderer.renderError(t('apikey_not_set'));
    await promptHelper.pressEnter();
    return;
  }

  try {
    const result = await applyTool(tool);
    if (result.status !== 'success') throw new Error(t(result.reason ?? 'tool_config_load_failed', { tool: tool.displayName }));
    uiRenderer.renderHeader();
    uiRenderer.renderSuccess(t('tool_config_loaded', { tool: tool.displayName }));
    for (const note of tool.getLoadConfigNotes?.() ?? []) uiRenderer.renderHint(note);
  } catch (err: unknown) {
    uiRenderer.renderHeader();
    uiRenderer.renderError(
      err instanceof Error ? err.message : t('tool_config_load_failed', { tool: tool.displayName }),
    );
    for (const note of tool.getLoadConfigNotes?.() ?? []) uiRenderer.renderHint(note);
  }
  await promptHelper.pressEnter();
}

// 启动工具
export async function launchTool(tool: ITool): Promise<void> {
  if (tool.launchOnly) {
    const previousExitCode = process.exitCode;
    let shuttingDown = false;
    try {
      process.exitCode = undefined;
      await runCommand(tool.name, []);
      if (process.exitCode) uiRenderer.renderError(t('tool_launch_exit', { tool: tool.displayName, code: String(process.exitCode) }));
    } catch (error) { shuttingDown = error instanceof LauncherShutdown; throw error; }
    finally { if (!shuttingDown) process.exitCode = previousExitCode; }
    await promptHelper.pressEnter();
    return;
  }
  const installed = tool.isInstalled();
  // null 表示无法检测（桌面应用），视为已安装
  if (installed === false) {
    uiRenderer.renderError(t('tool_not_installed', {
      tool: tool.displayName,
      command: tool.installCommand,
    }));
    return;
  }

  // 桌面应用特殊处理：提示手动启动
  if (tool.isInstalled() === null) {
    uiRenderer.renderHint(t('tool_desktop_launch_hint', {
      tool: tool.displayName,
    }));
    await promptHelper.pressEnter();
    return;
  }

  logger.info(t('tool_launching', { tool: tool.displayName }));
  try {
    const result = spawn.sync(findCommand(tool.command, tool.searchPaths) ?? tool.command, [], { stdio: 'inherit' });
    if (result.error) throw result.error;
  } catch (error) {
    uiRenderer.renderError(error instanceof Error ? error.message : String(error));
    await promptHelper.pressEnter();
  }
}

// 更新工具
export async function updateTool(tool: ITool): Promise<void> {
  // 桌面应用特殊处理：提示手动更新
  if (tool.isInstalled() === null) {
    uiRenderer.renderHint(t('tool_desktop_update_hint', {
      tool: tool.displayName,
    }));
    await promptHelper.pressEnter();
    return;
  }

  const currentVersion = tool.getVersion();
  try { tool.validateUpdate?.(); }
  catch (error) {
    uiRenderer.renderError(error instanceof Error ? error.message : t('error_unknown'));
    await promptHelper.pressEnter();
    return;
  }

  // 获取最新版本（仅 npm 包支持）
  let latest: string | null = null;
  if (tool.npmPackageName) {
    logger.info(t('update_checking'));
    latest = await fetchLatestVersion(tool.npmPackageName, tool.npmVersionMajor);
  }

  // 已是最新版本，跳过更新
  if (currentVersion && latest && !isNewerVersion(currentVersion, latest)) {
    uiRenderer.renderSuccess(t('tool_update_skipped'));
    return;
  }

  // 无版本信息或安装脚本也须展示命令并确认，默认不执行。
  const command = tool.updateCommand ?? tool.installCommand;
  uiRenderer.renderHint(command);
  const confirmed = await promptHelper.confirm(
    currentVersion && latest
      ? t('tool_update_confirm', { tool: tool.displayName, current: currentVersion, latest })
      : t('tool_update_command_confirm', { tool: tool.displayName, command }),
    false,
  );
  if (!confirmed) return;

  logger.info(t('tool_updating', { tool: tool.displayName }));
  try {
    executeToolUpdate(tool);

    // 更新后重新获取版本
    const newVersion = tool.getVersion();
    if (newVersion) {
      uiRenderer.renderSuccess(t('tool_update_success', { tool: tool.displayName, version: newVersion }));
    } else {
      uiRenderer.renderSuccess(t('update_latest'));
    }
  } catch {
    uiRenderer.renderError(t('error_unknown'));
  }
}

// 查看当前配置
export async function viewConfig(tool: ITool): Promise<void> {
  uiRenderer.renderHeader();
  uiRenderer.renderTitle(t('config_view_title'));

  const { apiKey, baseUrl } = configManager.getConnection(tool.name);
  const notSet = t('config_view_not_set');
  uiRenderer.renderConfigItem(t('config_view_endpoint'), baseUrl);
  uiRenderer.renderConfigItem(
    t('config_view_apikey'),
    apiKey ? uiRenderer.maskApiKey(apiKey) : chalk.dim(notSet),
  );

  tool.renderModelConfigSummary();

  logger.newLine();

  // 显示工具安装状态和版本
  const installed = tool.isInstalled();
  const version = tool.getVersion();

  let statusDisplay: string;
  if (installed === null) {
    // 无法检测（桌面应用），不显示安装状态
    statusDisplay = chalk.dim(t('tool_status_unknown'));
  } else if (installed === false) {
    statusDisplay = chalk.red(t('doctor_not_found'));
  } else if (!version || !tool.npmPackageName) {
    // 桌面应用（无 npmPackageName）只显示"已找到"，不显示版本
    statusDisplay = chalk.green(t('doctor_found'));
  } else {
    // CLI 工具显示版本号
    statusDisplay = `${chalk.green(t('doctor_found'))} (v${version})`;
  }

  uiRenderer.renderConfigItem(tool.displayName, statusDisplay);

  logger.newLine();

  // 等待用户按回车后再返回菜单
  await promptHelper.pressEnter();
}
