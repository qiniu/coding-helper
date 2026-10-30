import { parse, stringify } from 'smol-toml';

// 按行编辑 TOML：只改动指定的键和表，保留注释、顺序和其他内容

export function isTomlTableHeader(line: string): boolean {
  return /^(?:\[(?!\[)[^\]]+\]|\[\[[^\]]+\]\])\s*(#.*)?$/.test(line.trim());
}

// 将多行值作为完整语句保留，避免把字符串或数组内部的行误认成表头。
function statementLines(content: string, newline = '\n'): string[] {
  if (content.includes('\r\n') && /(?<!\r)\n/.test(content)) throw new Error('Mixed TOML line endings are not supported for safe editing.');
  const physical = content.split(newline);
  const result: string[] = [];
  for (let i = 0; i < physical.length; i++) {
    let statement = physical[i];
    const text = statement.trim();
    if (!text || text.startsWith('#') || text.startsWith('[')) {
      result.push(statement); continue;
    }
    for (;;) {
      try { parse(statement); break; }
      catch (error) {
        if (++i >= physical.length) throw error;
        statement += newline + physical[i];
      }
    }
    result.push(statement);
  }
  return result;
}

// Parse equivalent quoted/dotted spellings into one canonical table path.
function canonicalTableName(name: string): string {
  let value: unknown = parse('[' + name + ']');
  const keys: string[] = [];
  while (value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (!entries.length) break;
    if (entries.length !== 1) throw new Error('Invalid TOML table path.');
    const [key, child] = entries[0];
    keys.push(/^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key));
    value = child;
  }
  return keys.join('.');
}

// 表头中的表名，如 [models."qiniu/x"] → models."qiniu/x"
export function tomlTableName(line: string): string | undefined {
  const match = line.trim().match(/^\[\[?\s*(.+?)\s*\]\]?\s*(#.*)?$/);
  return match ? canonicalTableName(match[1]) : undefined;
}

// 顶层区域：第一个表头之前的行
export function topLevelEnd(lines: string[]): number {
  const index = lines.findIndex((line) => isTomlTableHeader(line));
  return index >= 0 ? index : lines.length;
}

function assignmentEquals(line: string): number {
  let quote = ''; let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote === '"' && !escaped && ch === '\\') { escaped = true; continue; }
    if (!escaped && (ch === '"' || ch === "'")) {
      if (!quote) quote = ch; else if (quote === ch) quote = '';
    }
    if (!quote && ch === '=') return i;
    escaped = false;
  }
  return -1;
}
function matchesKey(line: string, key: string): boolean {
  const text = line.trim();
  if (!text || text.startsWith('#') || text.startsWith('[')) return false;
  const equals = assignmentEquals(text);
  return equals > 0 && canonicalTableName(text.slice(0, equals).trim()) === canonicalTableName(key);
}

// 读取顶层键的原始值文本（如 '"gpt-5"'），不存在时返回 undefined
export function getTopLevelTomlValue(content: string, key: string): string | undefined {
  validateToml(content);
  const lines = statementLines(content);
  const end = topLevelEnd(lines);
  for (let i = 0; i < end; i++) {
    const trimmed = lines[i].trim();
    if (matchesKey(trimmed, key)) return trimmed.slice(assignmentEquals(trimmed) + 1).trim();
  }
  return undefined;
}

// 更新或插入顶层键；已存在时原地替换，新键插在顶层区域末尾（第一个表头之前）
function rawupsertTopLevelTomlKey(content: string, key: string, rawValue: string): string {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = statementLines(content, newline);
  const end = topLevelEnd(lines);
  const line = `${key} = ${rawValue}`;
  const index = lines.findIndex((l, i) => i < end && matchesKey(l, key));
  if (index >= 0) {
    lines[index] = replaceValue(lines[index], rawValue);
    return lines.join(newline);
  }
  let insertAt = end;
  while (insertAt > 0 && lines[insertAt - 1].trim() === '') insertAt--;
  lines.splice(insertAt, 0, line);
  // 紧挨着表头时补一个空行，保持可读
  if (insertAt + 1 < lines.length && isTomlTableHeader(lines[insertAt + 1])) {
    lines.splice(insertAt + 1, 0, '');
  }
  return lines.join(newline);
}

// 删除顶层键
function rawremoveTopLevelTomlKey(content: string, key: string): string {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = statementLines(content, newline);
  const end = topLevelEnd(lines);
  return lines.filter((line, i) => i >= end || !matchesKey(line, key)).join(newline);
}

// 删除表名满足条件的所有表（含其下的键）
function rawremoveTomlTablesWhere(content: string, match: (name: string) => boolean): string {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const result: string[] = [];
  let skipping = false;
  let scope = '';
  let arrayScope = false;
  for (const line of statementLines(content, newline)) {
    if (isTomlTableHeader(line)) {
      const name = tomlTableName(line);
      scope = name ?? '';
      arrayScope = line.trim().startsWith('[[');
      skipping = !!name && match(name);
      if (arrayScope && skipping) throw new Error('Array table editing requires an explicit element selection.');
      if (skipping) continue;
    }
    if (!skipping) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[') || arrayScope) { result.push(line); continue; }
      const equals = assignmentEquals(line);
      const name = canonicalTableName(line.slice(0, equals).trim());
      const full = scope ? `${scope}.${name}` : name;
      if (match(full)) continue;
      const value = parse('value = ' + line.slice(equals + 1)).value;
      let changed = false;
      const prune = (current: unknown, prefix: string): void => {
        if (!current || typeof current !== 'object' || Array.isArray(current) || current instanceof Date) return;
        for (const key of Object.keys(current)) {
          const component = /^[A-Za-z0-9_-]+$/.test(key) ? key : '"' + escapeTomlString(key) + '"';
          const childPath = `${prefix}.${component}`;
          if (match(childPath)) { delete (current as Record<string, unknown>)[key]; changed = true; }
          else prune((current as Record<string, unknown>)[key], childPath);
        }
      };
      prune(value, full);
      if (changed && value && typeof value === 'object') {
        // 内联父表是封闭的；改为点号子键，允许后续追加被替换的子表。
        for (const [key, child] of Object.entries(value)) {
          result.push(`${line.slice(0, equals).trim()}."${escapeTomlString(key)}" = ${inlineToml(child)}`);
        }
      } else result.push(line);
    }
  }
  // 删除文件尾部的表时，保留前一条语句原有的换行分隔符。
  if (skipping && result.length) result.push('');
  return result.join(newline);
}

// 删除指定表及其子表（[name] 与 [name.xxx]）
export function removeTomlTable(content: string, tableName: string): string {
  tableName = canonicalTableName(tableName);
  return removeTomlTablesWhere(content, (name) => name === tableName || name.startsWith(`${tableName}.`));
}

export function escapeTomlString(value: string): string {
  return JSON.stringify(value).slice(1, -1).replace(/\u007f/g, '\\u007f');
}

export function normalizeToml(content: string): string {
  const trimmed = content.trim();
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  return trimmed ? `${trimmed}${newline}` : '';
}

// 表的行范围 [表头行, 下一个表头行)；不存在时返回 undefined
function tableRange(lines: string[], tableName: string): [number, number] | undefined {
  tableName = canonicalTableName(tableName);
  if (lines.some(line => line.trim().startsWith('[[') && isTomlTableHeader(line) &&
    (tomlTableName(line) === tableName || tableName.startsWith(tomlTableName(line) + '.')))) {
    throw new Error('Array table editing requires an explicit element selection.');
  }
  const start = lines.findIndex((line) => isTomlTableHeader(line) && tomlTableName(line) === tableName);
  if (start < 0) return undefined;
  let end = start + 1;
  while (end < lines.length && !isTomlTableHeader(lines[end])) end++;
  return [start, end];
}

// 读取 [table] 下某个键的原始值文本
export function getTomlTableValue(content: string, tableName: string, key: string): string | undefined {
  validateToml(content);
  const lines = statementLines(content);
  const range = tableRange(lines, tableName);
  if (!range) return undefined;
  for (let i = range[0] + 1; i < range[1]; i++) {
    const trimmed = lines[i].trim();
    if (matchesKey(trimmed, key)) return trimmed.slice(assignmentEquals(trimmed) + 1).trim();
  }
  return undefined;
}

// 设置 [table] 下的键；表不存在时追加到文件末尾
function rawupsertTomlTableKey(content: string, tableName: string, key: string, rawValue: string): string {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = statementLines(content, newline);
  const line = `${key} = ${rawValue}`;
  const range = tableRange(lines, tableName);
  if (!range) {
    // 先更新等价的顶层点号路径或内联表，避免生成重复定义。
    const dotted = `${tableName}.${key}`;
    const rootEnd = topLevelEnd(lines);
    if (lines.some((line, i) => i < rootEnd && matchesKey(line, dotted))) {
      return rawupsertTopLevelTomlKey(content, dotted, rawValue);
    }
    const inlineIndex = lines.findIndex((line, i) => i < rootEnd && matchesKey(line, tableName));
    if (inlineIndex >= 0) {
      const raw = lines[inlineIndex].slice(assignmentEquals(lines[inlineIndex]) + 1);
      const value = parse('value = ' + raw).value;
      if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Date) throw new Error('TOML parent must be a table.');
      const keyParts = Object.keys(parse(key + ' = 0'));
      if (keyParts.length !== 1 || typeof parse(key + ' = 0')[keyParts[0]] === 'object') throw new Error('Nested inline key editing is not supported.');
      Object.defineProperty(value, keyParts[0], { value: parse('value = ' + rawValue).value, enumerable: true, writable: true, configurable: true });
      lines[inlineIndex] = replaceValue(lines[inlineIndex], inlineToml(value));
      return lines.join(newline);
    }
    const body = content.trim();
    return `${body ? `${body}${newline}${newline}` : ''}[${tableName}]${newline}${line}${newline}`;
  }
  for (let i = range[0] + 1; i < range[1]; i++) {
    if (matchesKey(lines[i], key)) {
      lines[i] = replaceValue(lines[i], rawValue);
      return lines.join(newline);
    }
  }
  let insertAt = range[1];
  while (insertAt > range[0] + 1 && lines[insertAt - 1].trim() === '') insertAt--;
  lines.splice(insertAt, 0, line);
  return lines.join(newline);
}

function inlineToml(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(inlineToml).join(', ') + ']';
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return '{ ' + Object.entries(value).map(([key, child]) => '"' + escapeTomlString(key) + '" = ' + inlineToml(child)).join(', ') + ' }';
  }
  return stringify({ value } as Parameters<typeof stringify>[0]).replace(/^value\s*=\s*/, '').trim();
}

// 删除 [table] 下的键；表因此变空时连表头一起删除
function rawremoveTomlTableKey(content: string, tableName: string, key: string): string {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = statementLines(content, newline);
  const range = tableRange(lines, tableName);
  if (!range) return content;
  const kept = lines.filter((line, i) => i <= range[0] || i >= range[1] || !matchesKey(line, key));
  const after = tableRange(kept, tableName);
  if (after && kept.slice(after[0] + 1, after[1]).every((l) => !l.trim())) {
    kept.splice(after[0], after[1] - after[0]);
  }
  return kept.join(newline);
}

// 多行值整体处理；数组表没有唯一表目标，拒绝编辑而不是静默选择第一个元素。
export function validateToml(content: string): Record<string, unknown> {
  const parsed = parse(content) as Record<string, unknown>;
  for (const line of statementLines(content)) {
    const text = line.trim();
    if (!text || text.startsWith('#')) continue;
    if (text.startsWith('[')) {
      if (!isTomlTableHeader(text)) throw new Error('Unsupported TOML table header for safe editing.');
      continue;
    }
    const equals = assignmentEquals(text);
    if (equals < 1) throw new Error('Unsupported multiline TOML statement for safe editing.');
    const raw = text.slice(equals + 1);
    parse('value =' + raw);
  }
  return parsed;
}

// 保留等号前的缩进和行尾注释，字符串中的 # 不算注释
function replaceValue(line: string, rawValue: string): string {
  const equals = assignmentEquals(line);
  const after = line.slice(equals + 1);
  if (line.includes('\n')) {
    // 托管多行值替换为调用方的新值；其他完整语句保持原始字节。
    return line.slice(0, equals + 1) + (after.match(/^[ \t]*/)?.[0] ?? ' ') + rawValue + (line.endsWith('\r') ? '\r' : '');
  }
  let quote = ''; let escaped = false; let comment = after.length;
  for (let i = 0; i < after.length; i++) {
    const ch = after[i];
    if (quote === '"' && !escaped && ch === String.fromCharCode(92)) { escaped = true; continue; }
    if (!escaped && (ch === '"' || ch === String.fromCharCode(39))) {
      if (!quote) quote = ch;
      else if (quote === ch) quote = '';
    }
    if (!quote && ch === '#') { comment = i; break; }
    escaped = false;
  }
  const suffix = comment < after.length ? after.slice(0, comment).match(/\s*$/)![0] + after.slice(comment) : line.endsWith('\r') ? '\r' : '';
  const lead = after.match(/^[ \t]*/)?.[0] ?? ' ';
  return line.slice(0, equals + 1) + lead + rawValue + suffix;
}
function checked(content: string, edit: () => string): string {
  validateToml(content);
  const next = edit(); validateToml(next); return next;
}
export function upsertTopLevelTomlKey(content: string, key: string, rawValue: string): string {
  return checked(content, () => rawupsertTopLevelTomlKey(content, key, rawValue));
}
export function removeTopLevelTomlKey(content: string, key: string): string {
  return checked(content, () => rawremoveTopLevelTomlKey(content, key));
}
export function removeTomlTablesWhere(content: string, match: (name: string) => boolean): string {
  return checked(content, () => rawremoveTomlTablesWhere(content, match));
}
export function upsertTomlTableKey(content: string, tableName: string, key: string, rawValue: string): string {
  return checked(content, () => rawupsertTomlTableKey(content, tableName, key, rawValue));
}
export function removeTomlTableKey(content: string, tableName: string, key: string): string {
  return checked(content, () => rawremoveTomlTableKey(content, tableName, key));
}
