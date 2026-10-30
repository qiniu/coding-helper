import path from 'node:path';

// 在导入工具单例之前隔离目录变量；CI 和用户 shell 可能预先设置 XDG 或客户端目录。
export function isolateHome(home) {
  process.env.HOME = process.env.USERPROFILE = home;
  process.env.XDG_CONFIG_HOME = path.join(home, '.config');
  process.env.XDG_CACHE_HOME = path.join(home, '.cache');
  process.env.XDG_DATA_HOME = path.join(home, '.local/share');
  process.env.XDG_STATE_HOME = path.join(home, '.local/state');
  process.env.APPDATA = path.join(home, 'AppData/Roaming');
  process.env.LOCALAPPDATA = path.join(home, 'AppData/Local');
  for (const key of ['QWEN_HOME','KIMI_CODE_HOME','GROK_HOME','MINIMAX_DATA_DIR','MAVIS_DATA_DIR',
    'OPENCLAW_HOME','OPENCLAW_STATE_DIR','OPENCLAW_CONFIG_PATH','OPENCLAW_PROFILE','OPENCLAW_CONFIG_READONLY','OPENCLAW_NIX_MODE',
    'COPILOT_HOME','COPILOT_PROVIDERS_CONFIG','CODEX_HOME','CLAUDE_CONFIG_DIR',
    'CODING_HELPER_BASE_URL_CHINA','CODING_HELPER_BASE_URL_INTERNATIONAL']) delete process.env[key];
}
