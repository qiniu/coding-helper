import { configManager, type ModelConfig } from '../config.js';

// 模型槽位：主模型之外，工具在特定场景使用的模型（兜底、子代理、代码审查等）。
// 默认跟随主模型；用户单独设置过的槽位记在 slotModels 里，切换主模型时保持不变

export interface ModelSlot {
  id: string;
  // 显示名与说明的翻译键
  labelKey: string;
  hintKey: string;
}

const slot = (tool: string, id: string): ModelSlot => ({ id, labelKey: `slot_${tool}_${id}`, hintKey: `slot_${tool}_${id}_hint` });

export const TOOL_SLOTS: Record<string, ModelSlot[]> = {
  'claude-code': [slot('claude', 'fallback'), slot('claude', 'subagent')],
  codex: [slot('codex', 'review'), slot('codex', 'subagent'), slot('codex', 'memory')],
  droid: [slot('droid', 'spec')],
  grok: [slot('grok', 'summary')],
  hermes: [slot('hermes', 'vision')],
};

export function toolSlots(toolName: string): ModelSlot[] {
  return TOOL_SLOTS[toolName] ?? [];
}

// 单独设置过的槽位：槽位 id → 模型
export function slotOverrides(toolName: string, models: ModelConfig = configManager.getModels()): Record<string, string> {
  return { ...models.slotModels?.[toolName] };
}

// 槽位实际使用的模型：单独设置过的用它，否则跟随主模型
export function slotModel(toolName: string, slotId: string, main: string, models?: ModelConfig): string {
  return slotOverrides(toolName, models)[slotId] || main;
}
