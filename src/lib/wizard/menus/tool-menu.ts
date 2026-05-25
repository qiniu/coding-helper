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
  // 异步获取最新版本（不阻塞菜单渲染）
  let latestVersion: string | null = null;
  let fetchPromise: Promise<string | null> | null = null;
  // 标识版本查询是否已结束（成功或失败）。必须独立于 latestVersion：
  // 网络失败时 latestVersion 仍为 null，若以 null 判断会每轮循环重挂 abort 钩子，
  // 已 resolved 的 promise 立刻触发 abort，造成 select 死循环（issue #17）。
  let versionFetched = false;

  if (tool.npmPackageName) {
    fetchPromise = fetchLatestVersion(tool.npmPackageName);
    // 必须在同一回调里同时更新两个变量，保证下面的 abort 钩子触发时
    // versionFetched 已是 true（promise 链上同一 promise 的回调按挂载顺序执行）。
    fetchPromise.then(
      v => {
        latestVersion = v;
        versionFetched = true;
      },
      () => {
        versionFetched = true;
      },
    );
  }

  while (true) {
    uiRenderer.renderHeader();
    uiRenderer.renderTitle(t('tool_menu_title', { tool: tool.displayName }));

    // 显示版本信息
    const installedVersion = tool.getVersion();
    renderVersionInfo(installedVersion, latestVersion, versionFetched, tool.npmPackageName, tool.isInstalled() === null);

    // 仅当版本查询仍在进行中时，挂 AbortController 以便完成后自动刷新
    const controller = new AbortController();
    if (!versionFetched && fetchPromise) {
      fetchPromise.finally(() => {
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
          { name: `${theme.icon('◇')} ${t('tool_load_config')}`, value: 'load' as const },
          { name: `${theme.icon('◈')} ${t('tool_unload_config')}`, value: 'unload' as const },
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

      case 'unload': {
        // 清屏后二次确认
        uiRenderer.renderHeader();
        const confirmed = await promptHelper.confirm(
          t('tool_config_unload_confirm', { tool: tool.displayName }),
        );
        if (confirmed) {
          try {
            await tool.unloadConfig();
            uiRenderer.renderHeader();
            uiRenderer.renderSuccess(t('tool_config_unloaded', { tool: tool.displayName }));
          } catch {
            uiRenderer.renderHeader();
            uiRenderer.renderError(t('tool_config_unload_failed', { tool: tool.displayName }));
          }
          await promptHelper.pressEnter();
        }
        break;
      }

      case 'launch':
        await launchTool(tool);
        break;

      case 'update':
        await updateTool(tool);
        // 更新后重新获取最新版本信息
        if (tool.npmPackageName) {
          versionFetched = false;
          fetchPromise = fetchLatestVersion(tool.npmPackageName);
          try {
            latestVersion = await fetchPromise;
          } finally {
            versionFetched = true;
          }
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

// 渲染版本信息区域
function renderVersionInfo(
  installed: string | null,
  latest: string | null,
  fetched: boolean,
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
  } else if (fetched) {
    // 查询已结束但未拿到版本（如 npm registry 不可达）
    uiRenderer.renderConfigItem(t('tool_version_latest'), chalk.dim(t('tool_version_unavailable')));
  } else {
    uiRenderer.renderConfigItem(t('tool_version_latest'), chalk.dim(t('tool_version_checking')));
  }

  logger.newLine();
}

// 装载配置到工具
async function loadConfig(tool: ITool): Promise<void> {
  const apiKey = configManager.getApiKey();
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

  const models = configManager.getModels();
  try {
    await tool.loadConfig(apiKey, configManager.baseUrl, models);
    uiRenderer.renderHeader();
    uiRenderer.renderSuccess(t('tool_config_loaded', { tool: tool.displayName }));
  } catch (err: unknown) {
    uiRenderer.renderHeader();
    uiRenderer.renderError(
      err instanceof Error ? err.message : t('tool_config_load_failed', { tool: tool.displayName }),
    );
  }
  await promptHelper.pressEnter();
}

// 启动工具
async function launchTool(tool: ITool): Promise<void> {
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
  const { execSync } = await import('node:child_process');
  try {
    execSync(tool.command, { stdio: 'inherit' });
  } catch {
    // 用户退出工具时正常
  }
}

// 更新工具
async function updateTool(tool: ITool): Promise<void> {
  // 桌面应用特殊处理：提示手动更新
  if (tool.isInstalled() === null) {
    uiRenderer.renderHint(t('tool_desktop_update_hint', {
      tool: tool.displayName,
    }));
    await promptHelper.pressEnter();
    return;
  }

  const currentVersion = tool.getVersion();

  // 获取最新版本（仅 npm 包支持）
  let latest: string | null = null;
  if (tool.npmPackageName) {
    logger.info(t('update_checking'));
    latest = await fetchLatestVersion(tool.npmPackageName);
  }

  // 已是最新版本，跳过更新
  if (currentVersion && latest && !isNewerVersion(currentVersion, latest)) {
    uiRenderer.renderSuccess(t('tool_update_skipped'));
    return;
  }

  // 有版本信息时，提示确认
  if (currentVersion && latest) {
    const confirmed = await promptHelper.confirm(
      t('tool_update_confirm', { tool: tool.displayName, current: currentVersion, latest }),
    );
    if (!confirmed) return;
  }

  logger.info(t('tool_updating', { tool: tool.displayName }));
  const { execSync } = await import('node:child_process');
  try {
    execSync(tool.updateCommand ?? tool.installCommand, { stdio: 'inherit' });

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
async function viewConfig(tool: ITool): Promise<void> {
  uiRenderer.renderHeader();
  uiRenderer.renderTitle(t('config_view_title'));

  const apiKey = configManager.getApiKey();
  const notSet = t('config_view_not_set');
  uiRenderer.renderConfigItem(t('config_view_endpoint'), configManager.baseUrl);
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
