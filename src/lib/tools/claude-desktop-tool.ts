import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyConfigEdits, canonicalConfigPath, parseConfigObject, restoreConfigEdits } from '../core/config-transaction.js';
import { stateStore } from '../core/state-store.js';
import { readTextFile } from '../core/safe-write.js';
import { isQiniuBaseUrl } from '../endpoints.js';
import { t } from '../i18n.js';
import type { ModelConfig } from '../config.js';
import { OpenAICompatTool } from './openai-compat-tool.js';
import { desktopGatewayProfile, desktopModelRoutes } from '../desktop-gateway/mapping.js';

// 独立标识避免覆盖其他工具或用户创建的 profile。
const PROFILE_ID = 'e8cd7c67-52b5-4d78-810b-c0d1fef098ab';
const PROFILE_NAME = 'Qiniu Coding Helper';

export function desktopPaths(platform = process.platform, home = os.homedir(), env = process.env): string[] {
  let root: string;
  if (platform === 'darwin') root = path.join(home, 'Library', 'Application Support');
  else if (platform === 'win32') root = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  else if (platform === 'linux') root = env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.join(home, '.config');
  else throw new Error('Claude Desktop is not supported on this platform.');
  const normal = path.join(root, 'Claude', 'claude_desktop_config.json');
  const dir = path.join(root, 'Claude-3p');
  return [normal, path.join(dir, 'claude_desktop_config.json'), path.join(dir, 'configLibrary', `${PROFILE_ID}.json`), path.join(dir, 'configLibrary', '_meta.json')];
}

function serialize(value: Record<string, unknown>): string { return JSON.stringify(value, null, 2) + '\n'; }
function mode(content: string | undefined): string { const value = parseConfigObject(content); value.deploymentMode = '3p'; return serialize(value); }
function profile(content: string | undefined, apiKey: string, baseUrl: string, model: string): string {
  const value = parseConfigObject(content);
  Object.assign(value, { inferenceProvider: 'gateway', inferenceGatewayBaseUrl: baseUrl.replace(/\/+$/, ''), inferenceGatewayApiKey: apiKey, inferenceGatewayAuthScheme: 'bearer', inferenceModels: [model] });
  return serialize(value);
}
function meta(content: string | undefined): string {
  const value = parseConfigObject(content);
  if (value.entries !== undefined && !Array.isArray(value.entries)) throw new Error('Invalid Claude Desktop profile list.');
  const entries = (value.entries ?? []) as unknown[];
  if (entries.some(entry => !entry || typeof entry !== 'object' || Array.isArray(entry))) throw new Error('Invalid Claude Desktop profile entry.');
  const ours = entries.filter(entry => (entry as Record<string, unknown>).id === PROFILE_ID);
  if (ours.length > 1) throw new Error('Duplicate Claude Desktop profile.');
  if (!ours.length) entries.push({ id: PROFILE_ID, name: PROFILE_NAME });
  else (ours[0] as Record<string, unknown>).name = PROFILE_NAME;
  value.entries = entries;
  value.appliedId = PROFILE_ID;
  return serialize(value);
}

export class ClaudeDesktopTool extends OpenAICompatTool {
  name = 'claude-desktop';
  displayName = 'Claude Desktop';
  command = 'claude-desktop';
  installCommand = '';
  supportsPreview = true;
  isInstalled(): boolean | null {
    if (process.platform === 'darwin') return ['/Applications/Claude.app', path.join(os.homedir(), 'Applications', 'Claude.app')].some(file => fs.existsSync(file)) ? null : false;
    if (process.platform === 'win32' || process.platform === 'linux') return fs.existsSync(path.dirname(desktopPaths()[0])) ? null : false;
    return false;
  }
  getVersion(): string | null { return null; }
  getLoadConfigNotes(): string[] { return [t('claude_desktop_note')]; }
  getConfig(): Record<string, unknown> {
    const files = desktopPaths();
    const settings = parseConfigObject(readTextFile(files[2]));
    // 不返回凭据，避免被状态或配置界面展示。
    return { configPath: files[2], model: Array.isArray(settings.inferenceModels) ? settings.inferenceModels[0] : undefined, baseUrl: settings.inferenceGatewayBaseUrl };
  }
  isConfigured(): boolean {
    const files = desktopPaths();
    const normal = parseConfigObject(readTextFile(files[0]));
    const threep = parseConfigObject(readTextFile(files[1]));
    const value = parseConfigObject(readTextFile(files[2]));
    const library = parseConfigObject(readTextFile(files[3]));
    return normal.deploymentMode === '3p' && threep.deploymentMode === '3p' && library.appliedId === PROFILE_ID && Array.isArray(library.entries) && library.entries.some(entry => entry && typeof entry === 'object' && entry.id === PROFILE_ID) && value.inferenceProvider === 'gateway' && isQiniuBaseUrl(value.inferenceGatewayBaseUrl) && typeof value.inferenceGatewayApiKey === 'string' && !!value.inferenceGatewayApiKey;
  }
  private checkTargets(files: string[]): void {
    const expected = files.map(canonicalConfigPath);
    for (const entry of stateStore.getFileStates(this.name)) {
      const saved = entry.state.priors?.files;
      if (!Array.isArray(saved) || saved.length !== expected.length || saved.some(item => !item || typeof item !== 'object' || !('file' in item) || typeof item.file !== 'string' || !expected.includes(item.file)) || new Set(saved.map(item => (item as { file: string }).file)).size !== expected.length) throw new Error('Claude Desktop configuration directory changed or restoration record is invalid.');
    }
  }
  // 网关及 Desktop profile 的联合启停仍由上层服务协调，尚未接入普通 CLI。
  loadGatewayConfig(gatewayUrl: string, localToken: string, models: ModelConfig): void {
    const routes = desktopModelRoutes(models);
    const files = desktopPaths();
    this.checkTargets(files);
    if (!stateStore.getFileStates(this.name).length && readTextFile(files[2]) !== undefined) throw new Error('Claude Desktop managed profile already exists without a restoration record.');
    applyConfigEdits(this.name, [
      { file: files[0], build: mode }, { file: files[1], build: mode },
      { file: files[2], build: content => serialize(desktopGatewayProfile(parseConfigObject(content), gatewayUrl, localToken, routes)) },
      { file: files[3], build: meta },
    ]);
  }
  async loadConfig(apiKey: string, baseUrl: string, models: ModelConfig): Promise<void> {
    const model = this.resolveModel(models);
    if (!/^(?:anthropic\/)?claude-(?:sonnet|opus|haiku)-[a-z0-9][a-z0-9.-]*$/i.test(model)) throw new Error('Claude Desktop direct mode requires a Claude Sonnet, Opus, or Haiku role model; other models require a model-mapping proxy.');
    if (!apiKey.trim()) throw new Error('Claude Desktop gateway API key is required.');
    const files = desktopPaths();
    this.checkTargets(files);
    if (!stateStore.getFileStates(this.name).length && readTextFile(files[2]) !== undefined) throw new Error('Claude Desktop managed profile already exists without a restoration record.');
    applyConfigEdits(this.name, [
      { file: files[0], build: mode }, { file: files[1], build: mode },
      { file: files[2], build: content => profile(content, apiKey, baseUrl, model) },
      { file: files[3], build: meta },
    ]);
  }
  unloadConfig(): void {
    const files = desktopPaths();
    this.checkTargets(files);
    if (!restoreConfigEdits(this.name, files)) this.restoreManagedConfig(files);
  }
}
