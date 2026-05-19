import { type ModelConfig } from '../config.js';

// 工具接口定义
export interface ITool {
  name: string;
  displayName: string;
  command: string;
  installCommand: string;

  // 更新命令（可选，默认使用 installCommand）
  updateCommand?: string;

  // npm 包名（用于查询最新版本）
  npmPackageName?: string;

  // 检查工具是否已安装
  isInstalled(): boolean;

  // 获取当前安装的工具版本，未安装返回 null
  getVersion(): string | null;

  // 获取当前工具配置
  getConfig(): Record<string, unknown>;

  // 保存模型配置到工具
  saveModelConfig(config: ModelConfig): Promise<void>;

  // 获取当前模型配置
  getModelConfig(): ModelConfig | null;

  // 清除模型配置
  clearModelConfig(): void;

  // 将完整配置写入工具
  loadConfig(apiKey: string, baseUrl: string, models: ModelConfig): Promise<void>;

  // 从工具移除配置
  unloadConfig(): void | Promise<void>;
}
