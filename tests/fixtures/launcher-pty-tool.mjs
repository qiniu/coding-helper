import { toolManager } from '../../dist/lib/tool-manager.js';

// 用真实子进程验证公共启动层，不依赖某个工具的后续适配提交。
export const tool = {
  name: 'pty-regression',
  displayName: 'PTY regression client',
  command: process.env.PTY_TEST_CLIENT,
  installCommand: 'unused',
  launchOnly: true,
  isInstalled: () => true,
  getVersion: () => '1.0.0',
  getLaunchEnv: () => ({
    COPILOT_PROVIDER_API_KEY_COMMAND: undefined,
    COPILOT_PROVIDER_BEARER_TOKEN: undefined,
    COPILOT_PROVIDER_WIRE_MODEL: undefined,
    COPILOT_PROVIDER_WIRE_API: undefined,
    PTY_TEST_UNSET: undefined,
    PTY_TEST_EMPTY: '',
    PTY_TEST_ZERO: '0',
  }),
};

toolManager.register(tool);
