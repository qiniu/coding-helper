import { logger } from '../../utils/logger.js';
import spawn from 'cross-spawn';
import { findCommand } from '../../utils/find-command.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ModelConfig } from '../config.js';
import { t } from '../i18n.js';
import { isQiniuBaseUrl } from '../endpoints.js';
import { readTextFile, assertNotSymlink } from '../core/safe-write.js';
import { applyConfigEdits } from '../core/config-transaction.js';
import { parseYamlDocument } from '../core/yaml-edit.js';
import { OpenAICompatTool, fetchModelLimits, isRecord, openAIBaseUrl } from './openai-compat-tool.js';

export function getMinimaxConfigFile(): string {
  return path.join(process.env.MINIMAX_DATA_DIR?.trim() || process.env.MAVIS_DATA_DIR?.trim() || path.join(os.homedir(), '.minimax'), 'config.yaml');
}

function parseMinimaxConfig(content: string): ReturnType<typeof parseYamlDocument> {
  try { return parseYamlDocument(content); }
  catch { throw new Error('Cannot parse MiniMax configuration safely. Configuration is unchanged; repair the YAML before retrying.'); }
}

export class MinimaxCodeTool extends OpenAICompatTool {
  // 官方 provider 命令会执行外部写入，不能将空预演误报为成功。
  supportsPreview = false;
  name = 'minimax-code';
  displayName = 'MiniMax Code';
  command = 'mcode';
  installCommand = 'npm install -g @minimax-ai/code@latest';
  updateCommand = 'npm install -g @minimax-ai/code@latest';
  npmPackageName = '@minimax-ai/code';
  aliases = ['mcode', 'minimax'];
  getConfig(): Record<string, unknown> {
    try { return parseYamlDocument(readTextFile(getMinimaxConfigFile()) ?? '').toJS() as Record<string, unknown>; }
    catch { return {}; }
  }
  isConfigured(): boolean {
    const config: unknown = parseMinimaxConfig(readTextFile(getMinimaxConfigFile()) ?? '').toJS();
    return isRecord(config) && isRecord(config.custom_provider) && isRecord(config.custom_provider.qiniu) &&
      isRecord(config.custom_provider.qiniu.options) && isQiniuBaseUrl(config.custom_provider.qiniu.options.baseURL);
  }
  async loadConfig(apiKey: string, baseUrl: string, models: ModelConfig): Promise<void> {
    const model = this.resolveModel(models);
    const file = getMinimaxConfigFile();
    assertNotSymlink(file);
    const before = readTextFile(file);
    const staged = parseMinimaxConfig(before ?? '');
    // provider add generates qiniu-2 when qiniu already exists. Replace only in staging.
    if (staged.hasIn(['custom_provider', 'qiniu'])) staged.deleteIn(['custom_provider', 'qiniu']);
    if (/^(?:custom_provider:)?qiniu\//.test(String(staged.get('defaultModel') ?? ''))) staged.delete('defaultModel');
    logger.info(t('minimax_fetching_limits'));
    const limits = await fetchModelLimits(baseUrl, apiKey, model, this.name);
    // 官方命令只写临时数据目录，成功并校验后才替换用户文件
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-helper-mcode-'));
    try {
      // 旧客户端可能忽略专用数据目录，隔离所有常用用户目录及工作目录。
      const childHome = path.join(stage, 'home');
      fs.mkdirSync(childHome, { mode: 0o700 });
      fs.writeFileSync(path.join(stage, 'config.yaml'), String(staged), { mode: 0o600 });
      try {
        logger.info(t('minimax_provider_start'));
        const result = spawn.sync(findCommand(this.command, this.searchPaths) ?? this.command, ['provider', 'add', '--name', 'qiniu', '--base-url', openAIBaseUrl(baseUrl),
          '--api-format', 'openai-completions', '--model', model, '--api-key-env', 'QINIU_API_KEY',
          '--context-limit', String(limits.contextWindow), '--output-limit', String(limits.maxOutputTokens),
          ...(limits.modalities?.input.includes('image') ? ['--support-image'] : []), '--use'], {
          env: { ...process.env, MINIMAX_DATA_DIR: stage, MAVIS_DATA_DIR: stage, QINIU_API_KEY: apiKey,
            HOME: childHome, USERPROFILE: childHome,
            HOMEDRIVE: path.parse(childHome).root.replace(/[\\/]$/, ''),
            HOMEPATH: childHome.slice(path.parse(childHome).root.replace(/[\\/]$/, '').length),
            XDG_CONFIG_HOME: path.join(childHome, '.config'), XDG_DATA_HOME: path.join(childHome, '.local', 'share'),
            XDG_CACHE_HOME: path.join(childHome, '.cache'), XDG_STATE_HOME: path.join(childHome, '.local', 'state'),
            APPDATA: path.join(childHome, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(childHome, 'AppData', 'Local') },
          cwd: stage, stdio: 'pipe', encoding: 'utf8', timeout: 90000,
        });
        if (result.error || result.status !== 0) throw new Error('Provider command failed.');
        logger.info(t('minimax_provider_complete'));
      } catch {
        // 不转发子进程原始输出，避免命令错误信息泄露 Key
        throw new Error(t('minimax_provider_add_failed', { error: 'provider command failed; original configuration was not changed' }));
      }
      assertNotSymlink(path.join(stage, 'config.yaml'));
      const after = readTextFile(path.join(stage, 'config.yaml'));
      if (after === undefined) throw new Error('MiniMax did not create its staged configuration.');
      const config = parseMinimaxConfig(after).toJS() as Record<string, unknown>;
      const provider = isRecord(config.custom_provider) ? config.custom_provider.qiniu : undefined;
      if (!isRecord(provider) || !isRecord(provider.options) || provider.options.baseURL !== openAIBaseUrl(baseUrl) ||
          provider.options.apiKey !== apiKey.trim() || provider.api !== 'openai-completions' ||
          !isRecord(provider.models) || !Object.hasOwn(provider.models, model)) throw new Error('MiniMax staged provider does not match the requested configuration.');
      if (limits.modalities?.input.includes('image')) {
        const entry = (provider.models as Record<string, unknown>)[model];
        if (!isRecord(entry) || !isRecord(entry.capabilities) || entry.capabilities.support_image !== true) {
          throw new Error('MiniMax did not persist the requested image capability. Original configuration was not changed.');
        }
      }
      if (!isRecord(config.custom_provider) || !Object.hasOwn(config.custom_provider, 'qiniu') ||
          !['qiniu/' + model, 'custom_provider:qiniu/' + model].includes(String(config.defaultModel))) {
        throw new Error('MiniMax staged provider or default model is missing.');
      }
      applyConfigEdits(this.name, [{ file, build: current => {
        if (current !== before) throw new Error('MiniMax configuration changed during provider setup. Retry.');
        return after;
      } }]);
      logger.info(t('minimax_config_applied'));
    } finally { fs.rmSync(stage, { recursive: true, force: true }); }
  }
  unloadConfig(): void { this.restoreManagedConfig([getMinimaxConfigFile()]); }
}
