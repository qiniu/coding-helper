import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { applyConfigEdits, canonicalConfigPath, parseConfigObject, restoreConfigEdits, type ConfigReconciler } from '../core/config-transaction.js';
import { stateStore } from '../core/state-store.js';
import { formatJsonLike, isPreview, readTextFile } from '../core/safe-write.js';
import { isQiniuBaseUrl } from '../endpoints.js';
import { t } from '../i18n.js';
import { configManager, type ModelConfig } from '../config.js';
import { OpenAICompatTool } from './openai-compat-tool.js';
import { uiRenderer } from '../wizard/ui/ui-renderer.js';
import { DESKTOP_PROFILE_OWNED, DESKTOP_TOOL, desktopGatewayProfile, desktopModelRoutes, gatewayOrigin } from '../desktop-gateway/mapping.js';
import { DESKTOP_ROUTES, GATEWAY_RUNTIME_VERSION, parseRuntimeConfig, type DesktopGatewayRuntimeConfig } from '../desktop-gateway/server.js';
import { bundledGatewayScript, choosePort, gatewayConfigPath, gatewayScriptPath, readGatewayConfig, startDesktopGateway, stopDesktopGateway } from '../desktop-gateway/background.js';
import { autostartContent, autostartPath } from '../desktop-gateway/autostart.js';

// 独立标识避免覆盖其他工具（如 CC Switch）或用户创建的 profile。
export const PROFILE_ID = 'e8cd7c67-52b5-4d78-810b-c0d1fef098ab';
const PROFILE_NAME = 'Qiniu Coding Helper';
const MODE_KEYS = ['deploymentMode'] as const;

// 返回 [普通模式配置, 3p 模式配置, 本工具 profile, profile 列表]。
export function desktopPaths(platform: NodeJS.Platform = process.platform, home = os.homedir(), env: NodeJS.ProcessEnv = process.env): string[] {
  let root: string;
  if (platform === 'darwin') root = path.join(home, 'Library', 'Application Support');
  else if (platform === 'win32') root = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  else if (platform === 'linux') root = env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.join(home, '.config');
  else throw new Error('Claude Desktop is not supported on this platform.');
  const normal = path.join(root, 'Claude', 'claude_desktop_config.json');
  const dir = path.join(root, 'Claude-3p');
  return [normal, path.join(dir, 'claude_desktop_config.json'), path.join(dir, 'configLibrary', `${PROFILE_ID}.json`), path.join(dir, 'configLibrary', '_meta.json')];
}

// 一次事务管理的全部文件：Desktop 四个配置 + 网关入口、网关配置、登录自启动项。
export function desktopManagedFiles(): string[] {
  return [...desktopPaths(), gatewayScriptPath(), gatewayConfigPath(), autostartPath()];
}

function isSupportedPlatform(): boolean { return ['darwin', 'win32', 'linux'].includes(process.platform); }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function setMode(content: string | undefined): string {
  const value = parseConfigObject(content);
  value.deploymentMode = '3p';
  return formatJsonLike(content, value);
}

function metaEntries(value: Record<string, unknown>): Record<string, unknown>[] {
  if (value.entries === undefined) return [];
  if (!Array.isArray(value.entries) || value.entries.some(entry => !record(entry))) throw new Error('Invalid Claude Desktop profile list.');
  return value.entries as Record<string, unknown>[];
}
function setMeta(content: string | undefined): string {
  const value = parseConfigObject(content);
  const entries = metaEntries(value);
  const ours = entries.filter(entry => entry.id === PROFILE_ID);
  if (ours.length > 1) throw new Error('Duplicate Claude Desktop profile.');
  if (!ours.length) entries.push({ id: PROFILE_ID, name: PROFILE_NAME });
  else ours[0].name = PROFILE_NAME;
  value.entries = entries;
  value.appliedId = PROFILE_ID;
  return formatJsonLike(content, value);
}

// 把 owned 字段从 source 拷到 target：source 没有的键在 target 中删除。
function copyOwned(target: Record<string, unknown>, source: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of keys) {
    if (Object.hasOwn(source, key)) target[key] = source[key];
    else delete target[key];
  }
}

// Desktop 会自行改写这些文件（偏好、MCP、profile 设置）。只要助手负责的字段仍是写入值，
// 就在当前内容上撤销这些字段，保留 Desktop 与用户的其他修改；否则拒绝，避免覆盖外部切换。
function reconcileDesktopFile(index: number, current: string, original: string | null, applied: string): string | null | undefined {
  const now = parseConfigObject(current), written = parseConfigObject(applied), before = parseConfigObject(original ?? undefined);
  if (index === 3) {
    const mine = (value: Record<string, unknown>) => metaEntries(value).filter(entry => entry.id === PROFILE_ID);
    if (now.appliedId !== written.appliedId || !isDeepStrictEqual(mine(now), mine(written))) return undefined;
    const prior = mine(before)[0];
    const entries = metaEntries(now).flatMap(entry => entry.id !== PROFILE_ID ? [entry] : prior ? [prior] : []);
    const result: Record<string, unknown> = { ...now, entries };
    // 恢复写入前选中的 profile；它已被删除时退回第一个剩余条目（与 CC Switch 的切回官方行为一致）。
    const priorApplied = before.appliedId;
    const exists = (id: unknown) => entries.some(entry => entry.id === id);
    if (!Object.hasOwn(before, 'appliedId')) delete result.appliedId;
    else if (typeof priorApplied !== 'string' || exists(priorApplied)) result.appliedId = priorApplied;
    else if (typeof entries[0]?.id === 'string') result.appliedId = entries[0].id;
    else delete result.appliedId;
    if (original === null && !entries.length && Object.keys(result).every(key => key === 'entries')) return null;
    if (original !== null && !Object.hasOwn(before, 'entries') && !entries.length) delete result.entries;
    return formatJsonLike(current, result);
  }
  const keys: readonly string[] = index === 2 ? DESKTOP_PROFILE_OWNED : MODE_KEYS;
  if (keys.some(key => !isDeepStrictEqual(now[key], written[key]))) return undefined;
  // 本工具创建的 profile 在还原时整体删除：Desktop 只按 _meta.json 条目列出 profile，残留文件只会留下凭据。
  if (index === 2 && original === null) return null;
  const result = { ...now };
  copyOwned(result, before, keys);
  if (original === null && !Object.keys(result).length) return null;
  return formatJsonLike(current, result);
}

function gatewayFrom(content: string | undefined): DesktopGatewayRuntimeConfig | undefined {
  try { return content === undefined ? undefined : parseRuntimeConfig(content); } catch { return undefined; }
}

export class ClaudeDesktopTool extends OpenAICompatTool {
  name = DESKTOP_TOOL;
  displayName = 'Claude Desktop';
  command = 'claude-desktop';
  aliases = ['claude-app'];
  installCommand = 'https://claude.ai/download';
  supportsPreview = true;

  // 桌面应用没有可调用的命令：找到应用或数据目录时按「无法检测版本的桌面应用」展示。
  isInstalled(): boolean | null {
    if (process.platform === 'darwin') return ['/Applications/Claude.app', path.join(os.homedir(), 'Applications', 'Claude.app')].some(file => fs.existsSync(file)) ? null : false;
    if (process.platform === 'win32' || process.platform === 'linux') return fs.existsSync(path.dirname(desktopPaths()[0])) ? null : false;
    return false;
  }
  getVersion(): string | null { return null; }
  getLoadConfigNotes(): string[] { return [t('claude_desktop_note')]; }

  private reconcile: ConfigReconciler = (file, current, original, applied) => {
    const index = desktopPaths().map(canonicalConfigPath).indexOf(file);
    return index < 0 ? undefined : reconcileDesktopFile(index, current, original, applied);
  };

  getConfig(): Record<string, unknown> {
    if (!isSupportedPlatform()) return {};
    const [, , profileFile] = desktopPaths();
    const gateway = readGatewayConfig();
    // 不返回凭据或本地令牌，避免被状态或配置界面展示。
    return {
      configPath: profileFile,
      gatewayConfigPath: gatewayConfigPath(),
      autostartPath: autostartPath(),
      gatewayUrl: gateway ? gatewayOrigin(gateway.port) : undefined,
      model: gateway?.routes[DESKTOP_ROUTES.sonnet],
      opusModel: gateway?.routes[DESKTOP_ROUTES.opus],
      haikuModel: gateway?.routes[DESKTOP_ROUTES.haiku],
    };
  }

  isConfigured(): boolean {
    if (!isSupportedPlatform()) return false;
    const [normalFile, threepFile, profileFile, metaFile] = desktopPaths();
    const gateway = readGatewayConfig();
    if (!gateway || !isQiniuBaseUrl(gateway.upstream) || !gateway.apiKey.trim() || readTextFile(gatewayScriptPath()) === undefined) return false;
    const normal = parseConfigObject(readTextFile(normalFile));
    const threep = parseConfigObject(readTextFile(threepFile));
    const profile = parseConfigObject(readTextFile(profileFile));
    const meta = parseConfigObject(readTextFile(metaFile));
    return normal.deploymentMode === '3p' && threep.deploymentMode === '3p' && meta.appliedId === PROFILE_ID &&
      metaEntries(meta).some(entry => entry.id === PROFILE_ID) && profile.inferenceProvider === 'gateway' &&
      profile.inferenceGatewayBaseUrl === gatewayOrigin(gateway.port) && profile.inferenceGatewayApiKey === gateway.localToken;
  }

  // 用户在 Desktop 中切回官方登录或选择了其他 profile（如 CC Switch）时视为已切换服务商。
  hasSwitchedProvider(files: readonly { file: string; applied: string }[]): boolean {
    try {
      const [normalFile, , profileFile, metaFile] = desktopPaths().map(canonicalConfigPath);
      const profileEntry = files.find(entry => entry.file === profileFile);
      if (!profileEntry) return false;
      const appliedUrl = parseConfigObject(profileEntry.applied).inferenceGatewayBaseUrl;
      const normal = parseConfigObject(readTextFile(normalFile));
      const meta = parseConfigObject(readTextFile(metaFile));
      const profile = parseConfigObject(readTextFile(profileFile));
      if (typeof normal.deploymentMode === 'string' && normal.deploymentMode !== '3p') return true;
      if (typeof meta.appliedId === 'string' && meta.appliedId !== PROFILE_ID) return true;
      return typeof profile.inferenceGatewayBaseUrl === 'string' && profile.inferenceGatewayBaseUrl !== appliedUrl;
    } catch { return false; }
  }

  private checkTargets(files: string[]): void {
    const expected = files.map(canonicalConfigPath);
    for (const entry of stateStore.getFileStates(this.name)) {
      const saved = entry.state.priors?.files;
      if (!Array.isArray(saved) || saved.length !== expected.length || saved.some(item => !record(item) || typeof item.file !== 'string' || !expected.includes(item.file)) ||
          new Set(saved.map(item => (item as { file: string }).file)).size !== expected.length) {
        throw new Error('Claude Desktop configuration directory changed or restoration record is invalid. Restore the recorded files first.');
      }
    }
  }

  async loadConfig(apiKey: string, baseUrl: string, models: ModelConfig): Promise<void> {
    if (!isSupportedPlatform()) throw new Error('Claude Desktop is not supported on this platform.');
    if (!apiKey.trim()) throw new Error('Claude Desktop gateway API key is required.');
    const routes = desktopModelRoutes(models);
    const files = desktopManagedFiles();
    this.checkTargets(files);
    const hadRecord = stateStore.getFileStates(this.name).length > 0;
    const previous = gatewayFrom(readTextFile(files[5]));
    const port = await choosePort(previous);
    // 沿用已有本地令牌，Desktop profile 与正在运行的网关可平滑替换。
    const localToken = previous?.localToken || randomBytes(32).toString('base64url');
    const runtime: DesktopGatewayRuntimeConfig = { version: GATEWAY_RUNTIME_VERSION, port, upstream: baseUrl.replace(/\/+$/, ''), apiKey, localToken, routes, provider: 'Qiniu' };
    const runtimeText = JSON.stringify(runtime, null, 2) + '\n';
    parseRuntimeConfig(runtimeText);
    const script = fs.readFileSync(bundledGatewayScript(), 'utf8');
    const startup = autostartContent(process.platform, process.execPath, files[4], files[5]);
    applyConfigEdits(this.name, [
      { file: files[0], build: setMode },
      { file: files[1], build: setMode },
      { file: files[2], build: content => formatJsonLike(content, desktopGatewayProfile(parseConfigObject(content), gatewayOrigin(port), localToken, routes)) },
      { file: files[3], build: setMeta },
      { file: files[4], build: () => script },
      { file: files[5], build: () => runtimeText },
      { file: files[6], build: () => startup },
    ], { reconcile: this.reconcile });
    if (isPreview()) return;
    try {
      if (previous && previous.port !== port) await stopDesktopGateway(previous);
      await startDesktopGateway(files[4], files[5]);
    } catch (error) {
      // 首次接入时网关起不来，撤销整组写入，避免 Desktop 指向不可用的端口。
      if (!hadRecord) restoreConfigEdits(this.name, files, { reconcile: this.reconcile });
      throw error;
    }
  }

  async unloadConfig(): Promise<void> {
    if (!isSupportedPlatform()) throw new Error('Claude Desktop is not supported on this platform.');
    const files = desktopManagedFiles();
    this.checkTargets(files);
    const running = gatewayFrom(readTextFile(files[5]));
    if (!restoreConfigEdits(this.name, files, { reconcile: this.reconcile })) this.restoreManagedConfig(files);
    if (isPreview() || !running) return;
    // 还原后若仍是同一网关配置（例如还原到另一份助手配置），保持运行。
    const restored = gatewayFrom(readTextFile(files[5]));
    if (restored && restored.port === running.port && restored.localToken === running.localToken) return;
    await stopDesktopGateway(running);
  }

  renderModelConfigSummary(): void {
    const models = configManager.getModels();
    const routes = (() => { try { return desktopModelRoutes(models); } catch { return undefined; } })();
    uiRenderer.renderModelConfigItem(t('config_view_model'), routes?.[DESKTOP_ROUTES.sonnet]);
    uiRenderer.renderModelConfigItem(t('slot_claude_desktop_opus'), routes?.[DESKTOP_ROUTES.opus]);
    uiRenderer.renderModelConfigItem(t('slot_claude_desktop_haiku'), routes?.[DESKTOP_ROUTES.haiku]);
  }
}
