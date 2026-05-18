import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, execSync } from 'node:child_process';
import type { ITool } from './base-tool.js';
import type { ModelConfig } from '../config.js';
import { promptHelper } from '../wizard/ui/prompt-helper.js';
import { t } from '../i18n.js';

const CODEX_DIR = path.join(os.homedir(), '.codex');
const CODEX_CONFIG_FILE = path.join(CODEX_DIR, 'config.toml');
const PROVIDER_NAME = 'qnaigc';
const PROFILE_NAME = 'qn-gpt';
const ENV_KEY = 'QINIU_API_KEY';
const ENV_BLOCK_START = '# >>> coding-helper QINIU_API_KEY >>>';
const ENV_BLOCK_END = '# <<< coding-helper QINIU_API_KEY <<<';

// Codex 工具实现
export class CodexTool implements ITool {
  name = 'codex';
  displayName = 'Codex';
  command = 'codex';
  installCommand = 'npm install -g @openai/codex';
  updateCommand = 'npm install -g @openai/codex@latest';
  npmPackageName = '@openai/codex';

  getVersion(): string | null {
    try {
      const output = execSync('codex --version', { stdio: 'pipe', encoding: 'utf-8' }).trim();
      const match = output.match(/(\d+\.\d+\.\d+)/);
      return match ? match[1] : output;
    } catch {
      return null;
    }
  }

  isInstalled(): boolean {
    try {
      const command = process.platform === 'win32' ? 'where codex' : 'which codex';
      execSync(command, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  getConfig(): Record<string, unknown> {
    const content = readCodexConfig();
    return {
      configPath: CODEX_CONFIG_FILE,
      configured: hasManagedCodexConfig(content),
      modelConfig: this.getModelConfig(),
    };
  }

  async saveModelConfig(config: ModelConfig): Promise<void> {
    const content = readCodexConfig();
    writeCodexConfig(buildCodexConfig(content, undefined, getCodexModel(config)));
  }

  getModelConfig(): ModelConfig | null {
    const content = readCodexConfig();
    const match = content.match(/\[profiles\.qn-gpt\][\s\S]*?\nmodel\s*=\s*"([^"]+)"/);
    if (!match) return null;
    return { sonnetModel: match[1] };
  }

  clearModelConfig(): void {
    const content = readCodexConfig();
    writeCodexConfig(removeTomlTable(content, 'profiles.qn-gpt'));
  }

  async loadConfig(apiKey: string, baseUrl: string, models: ModelConfig): Promise<void> {
    await persistQiniuApiKey(apiKey);
    const content = readCodexConfig();
    writeCodexConfig(buildCodexConfig(content, baseUrl, getCodexModel(models)));
  }

  async unloadConfig(): Promise<void> {
    const content = readCodexConfig();
    writeCodexConfig(removeManagedCodexConfig(content));

    if (hasManagedEnvironmentVariable()) {
      const confirmed = await promptHelper.confirm(t('codex_env_unload_confirm'), false);
      if (confirmed) {
        removeManagedEnvironmentVariable();
      }
    }
  }
}

export function buildCodexConfig(existing: string, baseUrl?: string, model?: string): string {
  let content = removeManagedCodexConfig(existing);
  content = upsertTopLevelModelProvider(content);

  const providerBaseUrl = `${(baseUrl || 'https://api.qnaigc.com').replace(/\/+$/, '')}/bypass/openai/v1`;
  const sections = [
    `[model_providers.${PROVIDER_NAME}]`,
    'name = "Qiniu"',
    `base_url = "${escapeTomlString(providerBaseUrl)}"`,
    `env_key = "${ENV_KEY}"`,
    'wire_api = "responses"',
    'requires_openai_auth = false',
    '',
  ];

  if (model) {
    sections.push(
      `[profiles.${PROFILE_NAME}]`,
      `model_provider = "${PROVIDER_NAME}"`,
      `model = "${escapeTomlString(model)}"`,
      '',
    );
  }

  return normalizeToml(`${content.trimEnd()}\n\n${sections.join('\n')}`);
}

export function removeManagedCodexConfig(existing: string): string {
  let content = existing;
  content = removeTopLevelQnaigcModelProvider(content);
  content = removeTomlTable(content, `model_providers.${PROVIDER_NAME}`);
  content = removeTomlTable(content, `profiles.${PROFILE_NAME}`);
  return normalizeToml(content);
}

export function buildPosixEnvBlock(apiKey: string): string {
  return [
    ENV_BLOCK_START,
    `export ${ENV_KEY}='${escapePosixSingleQuoted(apiKey)}'`,
    ENV_BLOCK_END,
    '',
  ].join('\n');
}

export function buildFishEnvBlock(apiKey: string): string {
  return [
    ENV_BLOCK_START,
    `set -gx ${ENV_KEY} '${escapeFishSingleQuoted(apiKey)}'`,
    ENV_BLOCK_END,
    '',
  ].join('\n');
}

function readCodexConfig(): string {
  try {
    if (fs.existsSync(CODEX_CONFIG_FILE)) {
      return fs.readFileSync(CODEX_CONFIG_FILE, 'utf-8');
    }
  } catch {
    // 文件不存在或读取失败时按空配置处理
  }
  return '';
}

function writeCodexConfig(content: string): void {
  if (!fs.existsSync(CODEX_DIR)) {
    fs.mkdirSync(CODEX_DIR, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(CODEX_CONFIG_FILE, content, { encoding: 'utf-8', mode: 0o600 });
}

function getCodexModel(models: ModelConfig): string | undefined {
  return models.sonnetModel || models.opusModel || models.haikuModel || models.subagentModel;
}

async function persistQiniuApiKey(apiKey: string): Promise<void> {
  const existing = detectExistingApiKey();
  let overwriteConfirmed: boolean | undefined;

  if (existing && existing !== apiKey && process.stdin.isTTY) {
    overwriteConfirmed = await promptHelper.confirm(t('codex_env_overwrite_confirm'), false);
  }

  shouldPersistApiKey(apiKey, existing, {
    interactive: process.stdin.isTTY,
    overwriteConfirmed,
  });

  process.env[ENV_KEY] = apiKey;

  if (process.platform === 'win32') {
    setWindowsUserEnvironment(apiKey);
    return;
  }

  const shellInfo = getShellConfigTarget();
  const block = shellInfo.shell === 'fish' ? buildFishEnvBlock(apiKey) : buildPosixEnvBlock(apiKey);
  writeOwnedEnvBlock(shellInfo.file, block);
}

function detectExistingApiKey(): string | undefined {
  if (process.env[ENV_KEY]) return process.env[ENV_KEY];
  if (process.platform === 'win32') return undefined;

  const target = getShellConfigTarget();
  try {
    if (!fs.existsSync(target.file)) return undefined;
    const content = fs.readFileSync(target.file, 'utf-8');
    return extractManagedEnvValue(content, target.shell);
  } catch {
    return undefined;
  }
}

function hasManagedEnvironmentVariable(): boolean {
  if (process.platform === 'win32') {
    return !!process.env[ENV_KEY];
  }

  const target = getShellConfigTarget();
  try {
    return fs.existsSync(target.file) && fs.readFileSync(target.file, 'utf-8').includes(ENV_BLOCK_START);
  } catch {
    return false;
  }
}

function removeManagedEnvironmentVariable(): void {
  delete process.env[ENV_KEY];

  if (process.platform === 'win32') {
    setWindowsUserEnvironment('');
    return;
  }

  const target = getShellConfigTarget();
  try {
    if (!fs.existsSync(target.file)) return;
    const content = fs.readFileSync(target.file, 'utf-8');
    fs.writeFileSync(target.file, removeOwnedEnvBlock(content), 'utf-8');
  } catch {
    // 环境变量卸载失败不影响 Codex 配置卸载
  }
}

function getShellConfigTarget(): { shell: string; file: string } {
  const shell = path.basename(process.env.SHELL || '');
  const home = os.homedir();

  if (shell === 'fish') {
    return { shell, file: path.join(home, '.config', 'fish', 'config.fish') };
  }
  if (shell === 'bash') {
    return { shell, file: path.join(home, '.bashrc') };
  }
  if (shell === 'zsh') {
    return { shell, file: path.join(home, '.zshrc') };
  }
  return { shell: 'sh', file: path.join(home, '.profile') };
}

function writeOwnedEnvBlock(file: string, block: string): void {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
  const next = `${removeOwnedEnvBlock(current).trimEnd()}\n\n${block}`;
  fs.writeFileSync(file, next.replace(/^\n+/, ''), { encoding: 'utf-8', mode: 0o600 });
  fs.chmodSync(file, secureEnvFileMode(fs.statSync(file).mode));
}

function removeOwnedEnvBlock(content: string): string {
  const pattern = new RegExp(`${escapeRegExp(ENV_BLOCK_START)}[\\s\\S]*?${escapeRegExp(ENV_BLOCK_END)}\\n?`, 'g');
  return content.replace(pattern, '').replace(/\n{3,}/g, '\n\n');
}

function extractManagedEnvValue(content: string, shell: string): string | undefined {
  const block = content.match(new RegExp(`${escapeRegExp(ENV_BLOCK_START)}([\\s\\S]*?)${escapeRegExp(ENV_BLOCK_END)}`));
  if (!block) return undefined;

  const pattern = shell === 'fish'
    ? /set\s+-gx\s+QINIU_API_KEY\s+'((?:\\'|[^'])*)'/
    : /export\s+QINIU_API_KEY='((?:'\\''|[^'])*)'/;
  const match = block[1].match(pattern);
  if (!match) return undefined;
  return shell === 'fish'
    ? match[1].replace(/\\'/g, "'")
    : match[1].replace(/'\\''/g, "'");
}

function setWindowsUserEnvironment(apiKey: string): void {
  const value = apiKey ? powerShellString(apiKey) : '$null';
  execFileSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    `[Environment]::SetEnvironmentVariable("${ENV_KEY}", ${value}, "User")`,
  ], { stdio: 'pipe' });
}

function upsertTopLevelModelProvider(content: string): string {
  const lines = content.split('\n');
  const firstTableIndex = lines.findIndex((line) => /^\[[^\]]+\]\s*$/.test(line.trim()));
  const searchEnd = firstTableIndex >= 0 ? firstTableIndex : lines.length;
  const index = lines.findIndex((line, lineIndex) => lineIndex < searchEnd && /^model_provider\s*=/.test(line.trim()));
  if (index >= 0) {
    lines[index] = `model_provider = "${PROVIDER_NAME}"`;
    return lines.join('\n');
  }
  return `model_provider = "${PROVIDER_NAME}"\n${content}`;
}

function removeTopLevelQnaigcModelProvider(content: string): string {
  const lines = content.split('\n');
  const firstTableIndex = lines.findIndex((line) => /^\[[^\]]+\]\s*$/.test(line.trim()));
  const searchEnd = firstTableIndex >= 0 ? firstTableIndex : lines.length;
  return lines
    .filter((line, lineIndex) => (
      lineIndex >= searchEnd ||
      !/^model_provider\s*=\s*"qnaigc"\s*$/.test(line.trim())
    ))
    .join('\n');
}

function removeTomlTable(content: string, tableName: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let skipping = false;
  const header = `[${tableName}]`;
  const dottedHeaderPrefix = `[${tableName}.`;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === header || trimmed.startsWith(dottedHeaderPrefix)) {
      skipping = true;
      continue;
    }
    if (skipping && /^\[[^\]]+\]\s*$/.test(trimmed)) {
      skipping = false;
    }
    if (!skipping) {
      result.push(line);
    }
  }

  return result.join('\n');
}

function hasManagedCodexConfig(content: string): boolean {
  return content.includes(`[model_providers.${PROVIDER_NAME}]`);
}

function normalizeToml(content: string): string {
  const trimmed = content.trim();
  return trimmed ? `${trimmed}\n` : '';
}

function escapeTomlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapePosixSingleQuoted(value: string): string {
  return value.replace(/'/g, `'\\''`);
}

function escapeFishSingleQuoted(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function powerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function shouldPersistApiKey(
  apiKey: string,
  existing: string | undefined,
  options: { interactive: boolean; overwriteConfirmed?: boolean },
): true {
  if (existing && existing !== apiKey) {
    if (!options.interactive) {
      throw new Error(t('codex_env_conflict_non_interactive'));
    }
    if (!options.overwriteConfirmed) {
      throw new Error(t('codex_env_overwrite_rejected'));
    }
  }
  return true;
}

export function secureEnvFileMode(_currentMode: number): number {
  return 0o600;
}
