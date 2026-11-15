import os from 'node:os';
import path from 'node:path';

// 登录后自动启动本地网关，避免重启电脑后 Desktop 指向失效端口。
// 三个平台都只写当前用户目录下的一个文件，不需要管理员权限，也不调用 launchctl / 注册表；
// 当前会话由 CLI 直接启动后台进程，自启动项从下次登录起生效。
export const AUTOSTART_LABEL = 'com.qiniu.coding-helper.claude-desktop-gateway';
const FILE_BASE = 'coding-helper-claude-desktop-gateway';

export function autostartPath(platform: NodeJS.Platform = process.platform, home = os.homedir(), env: NodeJS.ProcessEnv = process.env): string {
  if (platform === 'darwin') return path.join(home, 'Library', 'LaunchAgents', `${AUTOSTART_LABEL}.plist`);
  if (platform === 'win32') {
    const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', `${FILE_BASE}.vbs`);
  }
  if (platform === 'linux') {
    const config = env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.join(home, '.config');
    return path.join(config, 'autostart', `${FILE_BASE}.desktop`);
  }
  throw new Error('Claude Desktop is not supported on this platform.');
}

function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Desktop Entry 的 Exec 引号规则较复杂；含特殊字符的路径直接拒绝，避免生成可被解释的命令行。
function desktopExecArg(value: string): string {
  if (/["`$\\%\n\r]/.test(value)) throw new Error('Gateway path contains characters unsupported by autostart entries.');
  return `"${value}"`;
}

function vbsArg(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error('Gateway path contains unsupported characters.');
  // VBScript 字符串中 "" 表示一个引号；外层引号用于 Windows 命令行参数。
  return `""${value.replace(/"/g, '')}""`;
}

export function autostartContent(platform: NodeJS.Platform, node: string, script: string, config: string): string {
  if (platform === 'darwin') {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${AUTOSTART_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(node)}</string>
    <string>${xml(script)}</string>
    <string>${xml(config)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`;
  }
  if (platform === 'win32') {
    if ([node, script, config].some(value => value.includes('"'))) throw new Error('Gateway path contains unsupported characters.');
    return `' Coding Helper: Claude Desktop local gateway\r\nCreateObject("WScript.Shell").Run "${vbsArg(node)} ${vbsArg(script)} ${vbsArg(config)}", 0, False\r\n`;
  }
  if (platform === 'linux') {
    return `[Desktop Entry]
Type=Application
Name=Coding Helper Claude Desktop Gateway
Comment=Local model-mapping gateway for Claude Desktop
Exec=${[node, script, config].map(desktopExecArg).join(' ')}
Terminal=false
NoDisplay=true
X-GNOME-Autostart-enabled=true
`;
  }
  throw new Error('Claude Desktop is not supported on this platform.');
}
