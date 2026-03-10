import chalk from 'chalk';
import ora from 'ora';
import { t, i18n } from '../lib/i18n.js';
import { configManager } from '../lib/config.js';
import { validateApiKey } from '../lib/api-validator.js';
import { toolManager } from '../lib/tool-manager.js';
import { uiRenderer } from '../lib/wizard/ui/ui-renderer.js';
import { logger } from '../utils/logger.js';
import { execSync } from 'node:child_process';

// 健康检查项
interface CheckItem {
  label: string;
  status: 'pass' | 'fail' | 'warn';
  detail: string;
}

// doctor 命令 - 健康检查
export async function doctorCommand(): Promise<void> {
  i18n.init();

  uiRenderer.renderTitle(t('doctor_title'));

  const checks: CheckItem[] = [];

  // 1. 配置文件检查
  checks.push({
    label: t('doctor_config_file'),
    status: configManager.isFirstRun() ? 'warn' : 'pass',
    detail: configManager.isFirstRun() ? t('doctor_not_found') : configManager.configFile,
  });

  // 2. API Key 检查
  const apiKey = configManager.getApiKey();
  if (apiKey) {
    const spinner = ora(t('apikey_validating')).start();
    const result = await validateApiKey(apiKey, configManager.baseUrl);
    spinner.stop();

    checks.push({
      label: t('doctor_api_key'),
      status: result.valid ? 'pass' : 'fail',
      detail: result.valid ? uiRenderer.maskApiKey(apiKey) : (result.error || t('doctor_fail')),
    });

    // 3. 网络连接检查
    checks.push({
      label: t('doctor_network'),
      status: result.valid ? 'pass' : 'fail',
      detail: result.valid ? `${t('doctor_connected')} (${configManager.baseUrl})` : t('doctor_connect_failed'),
    });
  } else {
    checks.push({
      label: t('doctor_api_key'),
      status: 'warn',
      detail: t('apikey_not_set'),
    });

    // 网络检查（不带 API Key 直接发请求）
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      await fetch(`${configManager.baseUrl}/v1/models`, { signal: controller.signal });
      clearTimeout(timeout);
      checks.push({
        label: t('doctor_network'),
        status: 'pass',
        detail: `${t('doctor_connected')} (${configManager.baseUrl})`,
      });
    } catch {
      checks.push({
        label: t('doctor_network'),
        status: 'fail',
        detail: t('doctor_connect_failed'),
      });
    }
  }

  // 4. 工具安装检查
  for (const tool of toolManager.getAll()) {
    const installed = tool.isInstalled();
    checks.push({
      label: t('doctor_tool_installed', { tool: tool.displayName }),
      status: installed ? 'pass' : 'warn',
      detail: installed ? t('doctor_found') : t('doctor_not_found'),
    });
  }

  // 5. Node.js 检查
  checks.push({
    label: t('doctor_node'),
    status: 'pass',
    detail: process.version,
  });

  // 6. Git 检查
  try {
    const gitVersion = execSync('git --version', { encoding: 'utf-8' }).trim();
    checks.push({
      label: t('doctor_git'),
      status: 'pass',
      detail: gitVersion,
    });
  } catch {
    checks.push({
      label: t('doctor_git'),
      status: 'warn',
      detail: t('doctor_not_found'),
    });
  }

  // 渲染结果
  logger.newLine();
  for (const check of checks) {
    const icon =
      check.status === 'pass' ? chalk.green('✔') :
      check.status === 'fail' ? chalk.red('✖') :
      chalk.yellow('⚠');
    logger.log(`  ${icon}  ${chalk.bold(check.label)}: ${check.detail}`);
  }
  logger.newLine();
}
