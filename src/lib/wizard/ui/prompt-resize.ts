import { screen } from '../../../utils/logger.js';
import { AbortPromptError } from '@inquirer/core';

// 窗口重排后旧 prompt 的行数与光标锚点失效。先关闭旧绘制器，再重画静态页头并恢复交互状态。
// 不修改依赖内部实现，npm/npx 与 pnpm 安装均生效。
export async function resumeOnResize<T>(start: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const frame = screen.capture();
  while (true) {
    const controller = new AbortController();
    const resizeReason = Symbol('prompt-resize');
    const columns = process.stdout.columns;
    const rows = process.stdout.rows;
    const resized = (): void => {
      if (process.stdout.columns !== columns || process.stdout.rows !== rows) controller.abort(resizeReason);
    };
    const aborted = (): void => controller.abort(signal?.reason);
    process.stdout.on('resize', resized);
    signal?.addEventListener('abort', aborted, { once: true });
    try {
      // 已取消时不创建 readline，避免依赖在初始 aborted 分支留下输入监听器。
      if (signal?.aborted) throw new AbortPromptError({ cause: signal.reason });
      return await start(controller.signal);
    } catch (error) {
      if (!(error instanceof AbortPromptError) || error.cause !== resizeReason || signal?.aborted) throw error;
    } finally {
      process.stdout.off('resize', resized);
      signal?.removeEventListener('abort', aborted);
    }
    screen.repaint(frame);
  }
}
