#!/usr/bin/env node

import { createProgram } from './lib/command.js';
import { logger } from './utils/logger.js';

// CLI 入口
const program = createProgram();
program.parseAsync(process.argv).catch((error) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
