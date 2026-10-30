#!/usr/bin/env node

// 必须放最前：Node 版本守卫，先于任何会用到全局 fetch 的模块求值
import './lib/preflight.js';

// CLI 入口依赖动态加载，确保低版本 Node 先执行 preflight 并给出可读提示
Promise.all([import('./lib/command.js'), import('./utils/logger.js'), import('./utils/launcher-shutdown.js')])
  .then(async ([{ createProgram }, { logger }, { LauncherShutdown }]) => {
    const program = createProgram();
    try {
      await program.parseAsync(process.argv);
    } catch (error) {
      if (error instanceof LauncherShutdown) { process.exitCode = error.exitCode; return; }
      logger.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
