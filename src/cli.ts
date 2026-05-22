#!/usr/bin/env node

// 必须放最前：Node 版本守卫，先于任何会用到全局 fetch 的模块求值
import './lib/preflight.js';
import { createProgram } from './lib/command.js';
import { logger } from './utils/logger.js';

// CLI 入口
const program = createProgram();
program.parseAsync(process.argv).catch((error) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
