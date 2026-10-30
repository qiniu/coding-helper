import { configManager } from '../../dist/lib/config.js';
import { toolManager } from '../../dist/lib/tool-manager.js';
import { runCommand } from '../../dist/commands/run.js';
import { launchTool } from '../../dist/lib/wizard/menus/tool-menu.js';
import { LauncherShutdown } from '../../dist/utils/launcher-shutdown.js';
import { promptHelper } from '../../dist/lib/wizard/ui/prompt-helper.js';
import { fileURLToPath } from 'node:url';
configManager.setApiKey('public-signal-test-key');
const tool = {
  name: 'signal-probe', command: process.env.SIGNAL_EXECUTABLE || process.execPath,
  displayName: 'Signal probe', installCommand: 'unused', launchOnly: true,
  isInstalled: () => true, getLaunchEnv: () => ({}),
};
toolManager.register(tool);
promptHelper.pressEnter = () => { throw Error('Shutdown must not prompt'); };
try {
  if (process.env.SIGNAL_MENU) await launchTool(tool);
  else await runCommand(tool.name, [fileURLToPath(new URL('./launcher-signal-child.cjs', import.meta.url))]);
} catch (error) {
  if (error instanceof LauncherShutdown) process.exitCode = error.exitCode;
  else throw error;
}
