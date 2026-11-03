import { slotModel } from './model-slots.js';
import type { ModelConfig } from '../config.js';
import type { ITool } from '../tools/base-tool.js';

// 把一个模型 ID 写到各工具当前支持的配置项。
export function modelConfigFor(tool: Pick<ITool, 'name'>, model: string, models: ModelConfig = {}): ModelConfig {
  switch (tool.name) {
    case 'claude-code':
      // 主模型 = Sonnet · Opus（Fable 同 Opus）；兜底（Haiku）与子代理默认跟随主模型
      return {
        claudeCode: {
          haikuModel: slotModel('claude-code', 'fallback', model, models),
          sonnetModel: model,
          opusModel: model,
          subagentModel: slotModel('claude-code', 'subagent', model, models),
          useDefaultModels: false,
        },
      };
    case 'codex':
      return { codexModel: model };
    case 'codebuddy':
      return { codeBuddyModels: [model] };
    case 'workbuddy':
      return { workbuddyModels: [model] };
    case 'hermes':
      return { hermesModel: model };
    default:
      return { toolModels: { [tool.name]: model } };
  }
}

// 工具已保存的模型（用于未指定模型时优先沿用）
export function savedModelFor(tool: Pick<ITool, 'name'>, models: ModelConfig): string | undefined {
  switch (tool.name) {
    case 'claude-code':
      return models.claudeCode?.sonnetModel;
    case 'codex':
      return models.codexModel;
    case 'codebuddy':
      return models.codeBuddyModels?.[0];
    case 'workbuddy':
      return models.workbuddyModels?.[0];
    case 'hermes':
      return models.hermesModel;
    default:
      return models.toolModels?.[tool.name] ?? models.defaultModel;
  }
}

// 合并各工具成功应用的模型，保留多个通用工具各自的映射。
export function mergeModelConfigs(...patches: ModelConfig[]): ModelConfig {
  let models: ModelConfig = {};
  for (const patch of patches) {
    const previous = models;
    models = { ...models, ...patch };
    if (patch.toolModels) models.toolModels = { ...previous.toolModels, ...patch.toolModels };
    if (patch.claudeCode) models.claudeCode = { ...previous.claudeCode, ...patch.claudeCode };
  }
  return models;
}
