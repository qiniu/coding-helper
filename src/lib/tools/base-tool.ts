import { type ModelConfig } from '../config.js';

// 工具接口定义
export interface ITool {
  name: string;
  displayName: string;
  command: string;
  installCommand: string;

  // 只通过启动器使用的工具，不写客户端配置文件
  launchOnly?: boolean;
  // 启动器私有临时设置文件。
  getLaunchSettings?(apiKey: string, baseUrl: string, models: ModelConfig): Record<string, unknown>;
  getLaunchEnv?(apiKey: string, baseUrl: string, models: ModelConfig): Record<string, string | undefined>;

  // 命令行别名（如 codebuddy 工具支持 'workbuddy' 别名）
  aliases?: string[];
  searchPaths?: string[];

  // 更新命令（可选，默认使用 installCommand）
  updateCommand?: string;
  // 更新前校验客户端版本，避免跨大版本覆盖安装。
  validateUpdate?(): void;

  // npm 包名（用于查询最新版本）
  npmPackageName?: string;
  // 只显示适配器支持的大版本；不支持的 registry latest 按未知处理。
  npmVersionMajor?: number;

  // 检查工具是否已安装
  // 返回 null 表示无法检测（如桌面应用）
  isInstalled(): boolean | null;

  // 获取当前安装的工具版本，未安装返回 null
  getVersion(): string | null;

  // 获取当前工具配置
  getConfig(): Record<string, unknown>;

  // 只检查持久配置是否接入七牛，不探测网络或泄露 Key。
  isConfigured?(): boolean;

  // 清除模型配置
  clearModelConfig(): void | Promise<void>;

  // 将完整配置写入工具
  loadConfig(apiKey: string, baseUrl: string, models: ModelConfig): Promise<void>;

  // 配置装载完成后需要在成功页展示的补充信息
  getLoadConfigNotes?(): string[];

  // 从工具移除配置
  unloadConfig(): void | Promise<void>;

  // 运行该工具特定的模型配置流程（角色选择、多选模型等由各工具自定义）
  // 返回 true 表示用户完成并保存了配置；false 表示用户取消、未选或前置条件不满足
  runModelConfigFlow(): Promise<boolean>;

  // 渲染该工具的模型配置摘要（用于"查看当前配置"菜单）
  renderModelConfigSummary(): void;
}
