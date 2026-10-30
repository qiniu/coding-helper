import os from 'node:os';

// 父进程收到退出信号时向入口传播，菜单不能当普通客户端退出继续等待输入。
export class LauncherShutdown extends Error {
  readonly exitCode: number;
  constructor(readonly signal: NodeJS.Signals) {
    super('Launcher shutdown requested by ' + signal);
    this.exitCode = 128 + (os.constants.signals[signal] ?? 1);
  }
}
