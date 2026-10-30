// 只编辑单行环境变量，其他行原样保留；危险控制字符拒绝写入
export function setDotenvValue(content: string, key: string, value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || /[\r\n\0]/.test(value)) throw new Error('Invalid environment variable.');
  if (/\r(?!\n)/.test(content)) throw new Error('Unsupported CR-only environment line separator. Convert to LF or CRLF before editing.');
  const pattern = new RegExp('^\\s*(?:export\\s+)?' + key + '(?:\\s*=|:\\s+)');
  const lines = content.split('\n');
  // Refuse multiline quoted assignments before matching a target on any line.
  // A target-looking line may be part of another variable's quoted value.
  for (const line of lines) {
    const assignment = line.match(/^\s*(?:export\s+)?[\w.-]+(?:\s*=\s*|:\s+)(.*)$/);
    if (!assignment) continue;
    const raw = assignment[1];
    if (!['"', "'", String.fromCharCode(96)].includes(raw[0])) continue;
    let closed = false;
    for (let i = 1; i < raw.length; i++) {
      // dotenv 的引号匹配不使用反斜杠奇偶性；保守拒绝无法在本行闭合的值。
      if (raw[i] === raw[0] && raw[i - 1] !== String.fromCharCode(92)) { closed = true; break; }
    }
    if (!closed) throw new Error('Unsupported multiline environment value.');
  }
  const matches = lines.map((line, i) => pattern.test(line) ? i : -1).filter(i => i >= 0);
  if (matches.length > 1) throw new Error('Duplicate environment variable: ' + key);
  if (!/^[A-Za-z0-9_./:+\-=]+$/.test(value)) throw new Error('API key contains unsupported .env characters.');
  const next = key + '=' + value;
  if (matches.length) {
    const i = matches[0];
    if (!/^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*(?:\s*=\s*|:\s+)(?:[^"'`]*|"[^"\r\n]*"|'[^'\r\n]*'|`[^`\r\n]*`)\s*(?:#.*)?\r?$/.test(lines[i])) throw new Error('Unsupported multiline environment value.');
    lines[i] = next + (lines[i].endsWith('\r') ? '\r' : '');
    return lines.join('\n');
  }
  return content + (content && !content.endsWith('\n') ? '\n' : '') + next + '\n';
}

// 目录引导只接受可明确解析的单行 dotenv；不执行变量展开或 shell 内容。
export function readDotenvValue(content: string, key: string): string | undefined {
  // 复用多行及重复键校验，但不改动原文。
  setDotenvValue(content, key, 'validation-only');
  const line = content.split('\n').find(line => new RegExp('^\\s*(?:export\\s+)?' + key + '(?:\\s*=|:\\s+)').test(line));
  if (line === undefined) return undefined;
  const raw = line.replace(new RegExp('^\\s*(?:export\\s+)?' + key + '(?:\\s*=\\s*|:\\s+)'), '').trim();
  if (['"', "'", '`'].includes(raw[0])) {
    const end = raw.indexOf(raw[0], 1);
    if (end < 0) throw new Error('Unsupported multiline environment value.');
    return raw.slice(1, end);
  }
  return raw.split('#')[0].trim();
}
