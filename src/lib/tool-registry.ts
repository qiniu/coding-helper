import type { ITool } from './tools/base-tool.js';
// 延迟提供工具集合，避免渲染器与适配器之间的初始化循环。
let provider: () => ITool[] = () => [];
export function registerToolProvider(getTools: () => ITool[]): void { provider = getTools; }
export function registeredTools(): ITool[] { return provider(); }
