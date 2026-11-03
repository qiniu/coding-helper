import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { isAlias, isMap, isNode, isScalar, isSeq, parseDocument, visit, type Document, type YAMLMap } from 'yaml';
import { type ModelConfig } from '../config.js';
import { applyConfigEdits, canonicalConfigPath, parseConfigObject, restoreConfigEdits } from '../core/config-transaction.js';
import { stateStore } from '../core/state-store.js';
import { readDotenvValue, setDotenvValue } from '../core/dotenv-edit.js';
import { readTextFile } from '../core/safe-write.js';
import { isQiniuBaseUrl } from '../endpoints.js';
import { t } from '../i18n.js';
import { OpenAICompatTool, fetchModelLimits, effectiveContextLimit, effectiveOutputLimit, openAIBaseUrl, type ModelLimits } from './openai-compat-tool.js';

export const DSH_PROVIDER = 'coding-helper-qiniu';
const ROW = 'llm-pi-ai';
const PROFILES = ['web', 'headless'] as const;
const PLUGIN = '@deepseek-ai/dsh-llm-pi-ai';
const KEY_ENV = 'CODING_HELPER_DSH_API_KEY';
const DESKTOP_PROFILE = 'desktop';
export function getDshHome(): string {
  const override = process.env.DSH_HOME;
  const value = override !== undefined && override.trim() ? override : path.join(os.homedir(), '.dsh');
  // 与官方 resolveDshHome 一致：仅空值忽略空白，非空路径保留原文并展开支持的 ~ 前缀。
  return path.resolve(value === '~' ? os.homedir() : value.startsWith('~/') || value.startsWith('~\\') ? path.join(os.homedir(), value.slice(2)) : value);
}
function profileFile(profile: string, file: string): string { return path.join(getDshHome(), 'profiles', profile, file); }
function patchFile(profile = 'web'): string { return profileFile(profile, 'cordis.patch.yml'); }
function envFile(): string { return path.join(getDshHome(), '.env'); }
function desktopManifest(): string | undefined { return readTextFile(profileFile(DESKTOP_PROFILE, 'package.json')); }
function hasDesktopProfile(): boolean { return desktopManifest() !== undefined; }
function baseTargets(): string[] { return [...PROFILES.flatMap(profile => [profileFile(profile, 'package.json'), patchFile(profile)]), envFile()]; }
function allowedTargets(): string[] { return [...baseTargets(), patchFile(DESKTOP_PROFILE)]; }
function recordedTargets(): string[] | undefined {
  const records = stateStore.getFileStates('dsh');
  const files = records[0]?.state.priors?.files;
  return Array.isArray(files) ? files.map(entry => (entry as { file: string }).file) : undefined;
}
function targets(): string[] {
  // Desktop 可在旧五文件记录之后初始化；还原只处理记录里真正托管的目标。
  return recordedTargets() ?? [...baseTargets(), ...(hasDesktopProfile() ? [patchFile(DESKTOP_PROFILE)] : [])];
}
function checkTargets(): void {
  const expected = allowedTargets().map(canonicalConfigPath);
  const required = baseTargets().map(canonicalConfigPath);
  for (const entry of stateStore.getFileStates('dsh')) {
    const files = entry.state.priors?.files;
    if (!Array.isArray(files) || ![required.length, expected.length].includes(files.length) || files.some(value => !value || typeof value !== 'object' || !('file' in value) || typeof value.file !== 'string' || !expected.includes(value.file)) ||
        new Set(files.map(value => (value as { file: string }).file)).size !== files.length || required.some(file => !files.some(value => (value as { file: string }).file === file))) {
      throw new Error('Configuration directory changed or restoration state is invalid. Restore the recorded DSH files first.');
    }
  }
}
// Desktop 拥有自己的依赖和插件清单；只校验标准基础组件，不改写 manifest。
function validateDesktopManifest(content: string): void {
  const data = parseConfigObject(content);
  const dsh = data.dsh;
  const profile = dsh && typeof dsh === 'object' && 'profile' in dsh ? dsh.profile : undefined;
  const bundles = profile && typeof profile === 'object' && 'bundles' in profile ? profile.bundles : undefined;
  if (!Array.isArray(bundles) || bundles.some(bundle => typeof bundle !== 'string') ||
      bundles.indexOf('@deepseek-ai/dsh-base') < 0 ||
      bundles.indexOf('@deepseek-ai/dsh-web-app') <= bundles.indexOf('@deepseek-ai/dsh-base')) {
    throw new Error('dsh_desktop_profile_unsupported');
  }
}
function profileManifest(content: string | undefined, profile: typeof PROFILES[number]): string {
  const bundles = ['@deepseek-ai/dsh-base', profile === 'web' ? '@deepseek-ai/dsh-web-app' : '@deepseek-ai/dsh-headless'];
  if (content !== undefined) {
    const data = parseConfigObject(content);
    const dsh = data.dsh, settings = dsh && typeof dsh === 'object' && 'profile' in dsh ? dsh.profile : undefined;
    if (!settings || typeof settings !== 'object' || !('bundles' in settings) || JSON.stringify(settings.bundles) !== JSON.stringify(bundles)) throw new Error('DSH custom profile bundles require manual configuration. Existing profile is unchanged.');
    return content;
  }
  return JSON.stringify({ name: 'dsh-profile-' + profile, private: true, dependencies: {}, dsh: { profile: { bundles } } }, null, 2) + '\n';
}

// !!js 在 DSH 中是配置表达式；这里只保留标签及文本，绝不求值。
export function parseDshPatch(content: string): Document {
  const doc: Document = parseDocument(content, { intAsBigInt: true, customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }] });
  if (doc.errors.length || doc.warnings.some(w => w.code === 'TAG_RESOLVE_FAILED')) throw new Error('Cannot parse DSH patch safely. Repair cordis.patch.yml before retrying.');
  if (!doc.contents) doc.contents = doc.createNode([]);
  if (!isSeq(doc.contents)) throw new Error('DSH cordis.patch.yml must contain a patch list.');
  visit(doc, { Node(_key, node) {
    if (isAlias(node) || ('anchor' in node && node.anchor)) throw new Error('DSH YAML anchors require manual normalization before configuration.');
    if (isMap(node) && node.items.some(pair => !isScalar(pair.key) || typeof pair.key.value !== 'string')) throw new Error('DSH patch mapping keys must be strings.');
    if (isScalar(node) && typeof node.value === 'bigint' && node.value <= BigInt(Number.MAX_SAFE_INTEGER) && node.value >= BigInt(Number.MIN_SAFE_INTEGER)) node.value = Number(node.value);
  } });
  return doc;
}
function rows(doc: Document, id: string): YAMLMap[] {
  const found: YAMLMap[] = [];
  if (!isSeq(doc.contents)) throw new Error('Invalid DSH patch list.');
  for (const operation of doc.contents.items) {
    if (!isMap(operation)) throw new Error('Invalid DSH patch operation.');
    if (operation.get('id') === id) found.push(operation);
    const inserted = operation.get('insert', true);
    if (inserted !== undefined && !isSeq(inserted)) throw new Error('DSH insert must be a list.');
    if (isSeq(inserted)) for (const row of inserted.items) if (isMap(row) && row.get('id') === id) found.push(row);
    if (operation.get('remove') === id) throw new Error('DSH managed row was removed by another patch. Restore it before loading.');
  }
  if (found.length > 1) throw new Error('Duplicate DSH managed patch targets.');
  return found;
}
function mapAt(row: YAMLMap, keys: string[], doc: Document): void {
  for (let i = 1; i <= keys.length; i++) {
    const part = keys.slice(0, i), value = row.getIn(part, true);
    if (value === undefined) row.setIn(part, doc.createNode({}));
    else if (!isMap(value)) throw new Error('Invalid DSH provider configuration.');
  }
}

export function buildDshPatch(content: string, baseUrl: string, model: string, limits: ModelLimits): string {
  const doc = parseDshPatch(content);
  let provider = rows(doc, ROW)[0];
  if (provider && provider.has('name') && provider.get('name') !== PLUGIN) throw new Error('DSH managed plugin name conflicts with an existing row.');
  if (!provider) {
    if (!isSeq(doc.contents)) throw new Error('Invalid DSH patch list.');
    doc.contents.add(doc.createNode({ id: ROW, config: {} }));
    provider = rows(doc, ROW)[0];
  }
  provider.set('disabled', false);
  // 官方插件只允许一份注册；在对应 profile 中增量合并 provider，保留其他服务商。
  mapAt(provider, ['config', 'providers', DSH_PROVIDER], doc);
  const prefix = ['config', 'providers', DSH_PROVIDER];
  const sameRoute = provider.getIn([...prefix, 'baseURL']) === openAIBaseUrl(baseUrl);
  for (const [key, value] of Object.entries({ displayName: 'Qiniu', apiKeyEnv: KEY_ENV, api: 'openai-completions', baseURL: openAIBaseUrl(baseUrl) })) provider.setIn([...prefix, key], value);
  const modelsPath = [...prefix, 'models'];
  let models = provider.getIn(modelsPath, true);
  if (models === undefined) { provider.setIn(modelsPath, doc.createNode([])); models = provider.getIn(modelsPath, true); }
  if (!isSeq(models) || models.items.some(item => !isMap(item) || typeof item.get('id') !== 'string')) throw new Error('Invalid DSH model list.');
  const ids = models.items.map(item => (item as YAMLMap).get('id'));
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate DSH model identifiers.');
  let selected = models.items.find(item => (item as YAMLMap).get('id') === model) as YAMLMap | undefined;
  const preserve = limits.verified === false && sameRoute && selected !== undefined;
  const context = effectiveContextLimit(limits, preserve ? selected!.get('contextWindow') : undefined);
  const output = effectiveOutputLimit(limits, preserve ? selected!.get('maxTokens') : undefined, context);
  const existingInput = preserve ? selected!.get('input', true) : undefined;
  const input = isSeq(existingInput) && existingInput.items.length && existingInput.items.every(item => isScalar(item) && ['text', 'image'].includes(String(item.value)))
    ? existingInput.items.map(item => (item as { value: string }).value)
    : limits.modalities?.input.includes('image') ? ['text', 'image'] : ['text'];
  if (!selected) { selected = doc.createNode({ id: model }) as YAMLMap; models.add(selected); }
  for (const [key, value] of Object.entries({ name: model, contextWindow: context, maxTokens: output, input })) selected.set(key, value);
  let defaults = rows(doc, 'agent-default-model')[0];
  if (!defaults) { (doc.contents as { add(item: unknown): void }).add(doc.createNode({ id: 'agent-default-model', config: {} })); defaults = rows(doc, 'agent-default-model')[0]; }
  mapAt(defaults, ['config'], doc);
  defaults.set('disabled', false);
  defaults.setIn(['config', 'provider'], DSH_PROVIDER); defaults.setIn(['config', 'model'], model);
  defaults.deleteIn(['config', 'reasoningEffort']);
  return String(doc);
}

// 比较配置值和表达式标签，忽略缩进、注释和对象键顺序，不执行 !!js。
function nodeSnapshot(node: unknown): unknown {
  if (isMap(node)) return { tag: node.tag, value: Object.fromEntries(node.items.map(pair => [(pair.key as { value: string }).value, nodeSnapshot(pair.value)])) };
  if (isSeq(node)) return { tag: node.tag, value: node.items.map(nodeSnapshot) };
  if (isScalar(node)) return { tag: node.tag, value: node.value };
  return node;
}
// 只协调 profile patch；凭据、manifest、未知目录及中断日志仍使用严格事务校验。
function reconcileDshPatch(file: string, current: string, original: string | null, applied: string): string | undefined {
  if (![...PROFILES, DESKTOP_PROFILE].some(profile => canonicalConfigPath(patchFile(profile)) === file)) return undefined;
  const before = parseDshPatch(original ?? ''), written = parseDshPatch(applied), now = parseDshPatch(current);
  for (const id of [ROW, 'agent-default-model']) {
    const prior = rows(before, id)[0], expected = rows(written, id)[0], actual = rows(now, id)[0];
    if (!expected || !actual || expected.tag !== actual.tag) return undefined;
    const owned = id === ROW ? [['disabled'], ['config', 'providers', DSH_PROVIDER]]
      : [['disabled'], ['config', 'provider'], ['config', 'model'], ['config', 'reasoningEffort']];
    // 行名称与容器标签也会影响插件含义，不能仅凭叶子值相同接管。
    for (const keys of [['name'], ...owned]) {
      if (!isDeepStrictEqual(nodeSnapshot(expected.getIn(keys, true)), nodeSnapshot(actual.getIn(keys, true)))) return undefined;
    }
    for (const keys of id === ROW ? [['config'], ['config', 'providers']] : [['config']]) {
      const a = expected.getIn(keys, true), b = actual.getIn(keys, true);
      if (!isMap(a) || !isMap(b) || a.tag !== b.tag) return undefined;
    }
    // 在当前文档上撤销助手拥有的字段，外部新增服务商、UI、权限和注释留在原处。
    for (const keys of owned) {
      const value = prior?.getIn(keys, true);
      if (value === undefined) { if (actual.hasIn(keys)) actual.deleteIn(keys); }
      else actual.setIn(keys, isNode(value) ? value.clone() : value);
      for (let length = keys.length - 1; length > 0; length--) {
        const prefix = keys.slice(0, length), parent = actual.getIn(prefix, true);
        if (isMap(parent) && !parent.items.length && !prior?.hasIn(prefix)) actual.deleteIn(prefix);
      }
    }
    if (!prior && actual.items.length === 1 && actual.has('id') && isSeq(now.contents)) {
      const comments = [actual.commentBefore, actual.comment].filter(Boolean).join('\n');
      if (comments) now.comment = [now.comment, comments].filter(Boolean).join('\n');
      for (const operation of [...now.contents.items]) {
        if (operation === actual) now.contents.items.splice(now.contents.items.indexOf(actual), 1);
        else if (isMap(operation)) {
          const inserted = operation.get('insert', true);
          if (isSeq(inserted) && inserted.items.includes(actual)) inserted.items.splice(inserted.items.indexOf(actual), 1);
        }
      }
    }
  }
  return String(now);
}

function checkHomeOverrides(): string | undefined {
  const content = readTextFile(path.join(getDshHome(), 'cordis.patch.yml'));
  if (content !== undefined) {
    const doc = parseDshPatch(content);
    if (rows(doc, ROW).length || rows(doc, 'agent-default-model').length) throw new Error('DSH home patch overrides model configuration. Move those overrides to a profile or use a separate DSH_HOME before loading.');
  }
  return content;
}
function configured(): { model?: string; baseUrl?: string } {
  checkHomeOverrides();
  const values = [...PROFILES, ...(hasDesktopProfile() ? [DESKTOP_PROFILE] : [])].map(profile => {
    if (profile === DESKTOP_PROFILE) validateDesktopManifest(desktopManifest()!);
    const doc = parseDshPatch(readTextFile(patchFile(profile)) ?? '');
    const provider = rows(doc, ROW)[0], defaults = rows(doc, 'agent-default-model')[0];
    if (!provider || defaults?.getIn(['config', 'provider']) !== DSH_PROVIDER) return {};
    const route = ['config', 'providers', DSH_PROVIDER];
    if (provider.get('disabled') || defaults.get('disabled') || provider.getIn([...route, 'api']) !== 'openai-completions' || provider.getIn([...route, 'apiKeyEnv']) !== KEY_ENV) return {};
    const baseUrl = provider.getIn(['config', 'providers', DSH_PROVIDER, 'baseURL']);
    const model = defaults.getIn(['config', 'model']);
    const catalog = provider.getIn([...route, 'models'], true);
    if (!isSeq(catalog) || !catalog.items.some(item => isMap(item) && item.get('id') === model) || readTextFile(profileFile(profile, 'package.json')) === undefined) return {};
    return { model: typeof model === 'string' ? model : undefined, baseUrl: typeof baseUrl === 'string' ? baseUrl : undefined };
  });
  return values[0].model && values.every(value => value.model === values[0].model && value.baseUrl === values[0].baseUrl) ? values[0] : {};
}

export class DshTool extends OpenAICompatTool {
  supportsPreview = true;
  name = 'dsh';
  displayName = 'DeepSeek Harness';
  command = 'dsh';
  aliases = ['deepseek-harness'];
  launchArgs = ['web'];
  installCommand = 'npm install -g @deepseek-ai/dsh@0.2.1-rc.5';
  updateCommand = 'npm install -g @deepseek-ai/dsh@0.2.1-rc.5';
  // 有桌面 profile 而没有 CLI 时按桌面应用展示，不要求另外安装 npm CLI。
  isInstalled(): boolean | null { return super.isInstalled() || (hasDesktopProfile() ? null : false); }
  getLoadConfigNotes(): string[] { return [t(hasDesktopProfile() ? 'dsh_desktop_config_note' : 'dsh_config_note')]; }
  getConfig(): Record<string, unknown> { return { configPath: patchFile(), profiles: [...PROFILES, ...(hasDesktopProfile() ? [DESKTOP_PROFILE] : [])], ...configured() }; }
  isConfigured(): boolean { const value = configured(); return !!value.model && isQiniuBaseUrl(value.baseUrl) && !!readDotenvValue(readTextFile(envFile()) ?? '', KEY_ENV); }
  async loadConfig(apiKey: string, baseUrl: string, models: ModelConfig): Promise<void> {
    checkTargets();
    if (![...PROFILES, DESKTOP_PROFILE].some(profile => fs.existsSync(patchFile(profile))) && ['settings.yaml', 'settings.yml'].some(name => fs.existsSync(path.join(getDshHome(), name)))) throw new Error('Legacy DSH settings format detected. Upgrade DSH to the cordis.patch.yml format before loading.');
    const homePatch = checkHomeOverrides();
    const desktop = desktopManifest();
    const desktopTarget = canonicalConfigPath(patchFile(DESKTOP_PROFILE));
    if (desktop === undefined && recordedTargets()?.includes(desktopTarget)) {
      throw new Error('dsh_desktop_profile_missing');
    }
    if (desktop !== undefined) validateDesktopManifest(desktop);
    const model = this.resolveModel(models), limits = await fetchModelLimits(baseUrl, apiKey, model, this.name);
    applyConfigEdits(this.name, [
      ...PROFILES.flatMap(profile => [
        { file: profileFile(profile, 'package.json'), build: (content: string | undefined) => {
          if (readTextFile(path.join(getDshHome(), 'cordis.patch.yml')) !== homePatch) throw new Error('DSH home patch changed before writing. Retry.');
          return profileManifest(content, profile);
        } },
        { file: patchFile(profile), build: (content: string | undefined) => buildDshPatch(content ?? '', baseUrl, model, limits) },
      ]),
      ...(desktop === undefined ? [] : [{ file: patchFile(DESKTOP_PROFILE), build: (content: string | undefined) => {
        if (desktopManifest() !== desktop) throw new Error('DSH Desktop manifest changed before writing. Retry.');
        return buildDshPatch(content ?? '', baseUrl, model, limits);
      } }]),
      { file: envFile(), build: content => setDotenvValue(content ?? '', KEY_ENV, apiKey) },
    ], { extend: true, reconcile: reconcileDshPatch });
  }
  unloadConfig(): void {
    checkTargets(); const files = targets();
    if (!restoreConfigEdits(this.name, files, { reconcile: reconcileDshPatch })) this.restoreManagedConfig(files);
  }
  getLaunchEnv(apiKey: string, baseUrl: string, models: ModelConfig): Record<string, string> {
    if (this.isInstalled() === null) throw new Error(t('dsh_desktop_launch_note'));
    const value = configured();
    if (value.baseUrl !== openAIBaseUrl(baseUrl) || value.model !== this.resolveModel(models)) throw new Error('Load the selected DSH connection and model before launching.');
    return { DSH_HOME: getDshHome(), [KEY_ENV]: apiKey };
  }
}
