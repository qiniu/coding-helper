import type { ITool } from './tools/base-tool.js';
import { ClaudeCodeTool } from './tools/claude-code-tool.js';

// 工具注册中心
class ToolManager {
  private tools: Map<string, ITool> = new Map();

  constructor() {
    // 注册默认工具
    this.register(new ClaudeCodeTool());
  }

  // 注册工具
  register(tool: ITool): void {
    this.tools.set(tool.name, tool);
  }

  // 获取工具
  get(name: string): ITool | undefined {
    return this.tools.get(name);
  }

  // 获取所有已注册工具
  getAll(): ITool[] {
    return Array.from(this.tools.values());
  }

  // 获取工具名称列表
  getNames(): string[] {
    return Array.from(this.tools.keys());
  }
}

// 导出单例
export const toolManager = new ToolManager();
