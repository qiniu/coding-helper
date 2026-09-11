#!/usr/bin/env node

// 必须放最前：Node 版本守卫，先于任何会用到全局 fetch 的模块求值
import './lib/preflight.js';

// CLI 入口依赖动态加载，确保低版本 Node 先执行 preflight 并给出可读提示
// @inquirer/* 在 Ctrl+C 时抛 ExitPromptError；当作用户主动取消，安静退出，不要打成失败
function isUserCancelledPrompt(error: unknown): boolean {
  return error instanceof Error && error.name === 'ExitPromptError';
}

Promise.all([import('./lib/command.js'), import('./utils/logger.js')])
  .then(async ([{ createProgram }, { logger }]) => {
    const program = createProgram();
    try {
      await program.parseAsync(process.argv);
    } catch (error) {
      if (isUserCancelledPrompt(error)) {
        process.exit(0);
      }
      logger.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  })
  .catch((error) => {
    if (isUserCancelledPrompt(error)) {
      process.exit(0);
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
