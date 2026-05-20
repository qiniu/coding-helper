import { type ModelConfig } from '../config.js';

// 工具接口定义
export interface ITool {
  name: string;
  displayName: string;
  command: string;
  installCommand: string;

  // 命令行别名（如 codebuddy 工具支持 'workbuddy' 别名）
  aliases?: string[];

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

  // 清除模型配置
  clearModelConfig(): void;

  // 将完整配置写入工具
  loadConfig(apiKey: string, baseUrl: string, models: ModelConfig): Promise<void>;

  // 从工具移除配置
  unloadConfig(): void | Promise<void>;

  // 运行该工具特定的模型配置流程（角色选择、多选模型等由各工具自定义）
  runModelConfigFlow(): Promise<void>;

  // 渲染该工具的模型配置摘要（用于"查看当前配置"菜单）
  renderModelConfigSummary(): void;
}
