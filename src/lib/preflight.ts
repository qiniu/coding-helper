// 启动期前置检查：Node 版本守卫
// 必须在任何会用到全局 fetch 的模块求值之前执行
// 因为还在 i18n 初始化前，文案直接硬编码中英双语，避免循环依赖
import { writeSync } from 'fs';

const major = Number.parseInt(process.versions.node.split('.')[0] || '0', 10);
const MIN_MAJOR = 18;

if (Number.isFinite(major) && major < MIN_MAJOR) {
  const current = process.versions.node;
  const msg =
    `\n[coding-helper] 需要 Node.js >= ${MIN_MAJOR}，当前为 v${current}\n` +
    `[coding-helper] requires Node.js >= ${MIN_MAJOR}, current is v${current}\n\n` +
    `升级 / Upgrade: https://nodejs.org/en/download\n`;
  // 使用同步写，避免 stderr 为 pipe 时 process.exit 提前终止导致消息丢失
  writeSync(2, msg);
  process.exit(1);
}
