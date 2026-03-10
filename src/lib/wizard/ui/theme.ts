import chalk from 'chalk';

// 品牌渐变色（Logo 逐行使用，从亮到暗）
export const GRADIENT = [
  '#00D4FF', '#00B4E6', '#0094CC',
  '#0078B3', '#005C99', '#004080',
];

// 统一色板，供所有 UI 文件引用
export const theme = {
  brand:     chalk.hex('#00B4E6'),
  brandBold: chalk.bold.hex('#00B4E6'),
  accent:    chalk.hex('#00E5A0'),   // 绿色 — 已配置状态
  subtle:    chalk.hex('#6B7280'),   // 中灰
  heading:   chalk.bold.hex('#E0F0FF'),
  label:     chalk.bold.hex('#9CA3AF'),
  value:     chalk.hex('#F3F4F6'),
  border:    chalk.hex('#4B5563'),
  icon:      chalk.hex('#60A5FA'),
  dimIcon:   chalk.hex('#6B7280'),
  muted:     chalk.dim,
} as const;
