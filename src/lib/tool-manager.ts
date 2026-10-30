import type { ITool } from './tools/base-tool.js';
import { ClaudeCodeTool } from './tools/claude-code-tool.js';
import { QwenCodeTool } from './tools/qwen-code-tool.js';
import { CodexTool } from './tools/codex-tool.js';
import { KimiCodeTool } from './tools/kimi-code-tool.js';
import { CodeBuddyTool } from './tools/codebuddy-tool.js';
import { GrokTool } from './tools/grok-tool.js';
import { WorkBuddyTool } from './tools/workbuddy-tool.js';
import { OpenClawTool } from './tools/openclaw-tool.js';
import { HermesTool } from './tools/hermes-tool.js';
import { DroidTool } from './tools/droid-tool.js';

import { MinimaxCodeTool } from './tools/minimax-code-tool.js';

import { CopilotTool } from './tools/copilot-tool.js';

// 工具注册中心
class ToolManager {
  private tools: Map<string, ITool> = new Map();

  constructor() {
    this.register(new MinimaxCodeTool());
    this.register(new CopilotTool());
    // 注册默认工具
    this.register(new ClaudeCodeTool());
    this.register(new QwenCodeTool());
    this.register(new CodexTool());
    this.register(new KimiCodeTool());
    this.register(new CodeBuddyTool());
    this.register(new GrokTool());
    this.register(new WorkBuddyTool());
    this.register(new OpenClawTool());
    this.register(new HermesTool());
    this.register(new DroidTool());
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
