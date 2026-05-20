import type { ITool } from './tools/base-tool.js';
import { ClaudeCodeTool } from './tools/claude-code-tool.js';
import { CodexTool } from './tools/codex-tool.js';
import { CodeBuddyWorkBuddyTool } from './tools/codebuddy-workbuddy-tool.js';

// 工具注册中心
class ToolManager {
  private tools: Map<string, ITool> = new Map();

  constructor() {
    // 注册默认工具
    this.register(new ClaudeCodeTool());
    this.register(new CodexTool());
    this.register(new CodeBuddyWorkBuddyTool());
  }

  // 注册工具
  register(tool: ITool): void {
    this.tools.set(tool.name, tool);
  }

  // 获取工具（支持名称和别名查找）
  get(name: string): ITool | undefined {
    const direct = this.tools.get(name);
    if (direct) return direct;
    for (const tool of this.tools.values()) {
      if (tool.aliases?.includes(name)) return tool;
    }
    return undefined;
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
