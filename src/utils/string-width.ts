// 判断字符是否为宽字符（CJK、全角等，占两个终端列宽）
function isWideChar(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) || // 韩文 Jamo
    (code >= 0x2e80 && code <= 0x303e) || // CJK 部首
    (code >= 0x3040 && code <= 0x33bf) || // 日文假名、CJK 兼容
    (code >= 0xf900 && code <= 0xfaff) || // CJK 兼容象形文字
    (code >= 0xfe30 && code <= 0xfe6f) || // CJK 兼容形式
    (code >= 0xff01 && code <= 0xff60) || // 全角 ASCII
    (code >= 0xffe0 && code <= 0xffe6) || // 全角符号
    (code >= 0x4e00 && code <= 0x9fff) || // CJK 统一汉字
    (code >= 0x20000 && code <= 0x2ffff)  // CJK 扩展
  );
}

// 获取单个字符的终端显示宽度
function charWidth(code: number): number {
  // 控制字符和零宽字符
  if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return 0;
  return isWideChar(code) ? 2 : 1;
}

// 字符宽度计算 - 处理中文等全角字符的终端宽度
export function stringWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    const code = char.codePointAt(0);
    if (code === undefined) continue;
    width += charWidth(code);
  }
  return width;
}

// 去除 ANSI 转义码，返回纯文本
export function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*m/g, '');
}

// 截断字符串到指定可见宽度，超出部分用省略号替代
export function truncate(str: string, maxWidth: number): string {
  if (maxWidth < 1) return '';
  if (stringWidth(str) <= maxWidth) return str;
  const targetWidth = maxWidth - 1; // 留 1 位给省略号 '…'
  let width = 0;
  let result = '';
  for (const char of str) {
    const code = char.codePointAt(0);
    if (code === undefined) continue;
    const w = charWidth(code);
    if (width + w > targetWidth) break;
    width += w;
    result += char;
  }
  return result + '…';
}

// 填充字符串到指定宽度（支持全角字符）
export function padEnd(str: string, targetWidth: number): string {
  const currentWidth = stringWidth(str);
  if (currentWidth >= targetWidth) return str;
  return str + ' '.repeat(targetWidth - currentWidth);
}
