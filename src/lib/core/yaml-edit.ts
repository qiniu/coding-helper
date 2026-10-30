import { isAlias, isCollection, isMap, isNode, isScalar, parseDocument, visit, type Document } from 'yaml';

// 保留文档节点上的注释和引号；损坏或非映射配置不能当作空对象覆盖
export function parseYamlDocument(content: string): Document {
  const doc: Document = parseDocument(content, { intAsBigInt: true, customTags: ['binary', 'timestamp'] });
  if (doc.errors.length) throw doc.errors[0];
  if (doc.warnings.some(warning => warning.code === 'TAG_RESOLVE_FAILED')) throw new Error('Unresolved YAML tags cannot be safely restored.');
  // Editing an anchor also changes its aliases, including unrelated fields.
  visit(doc, { Node(_key, node) {
    if (node.tag === 'tag:yaml.org,2002:set' || node.tag === 'tag:yaml.org,2002:omap') throw new Error('Tagged YAML collections cannot be safely restored.');
    if (isScalar(node) && node.value instanceof Date && /^00\d\d-/.test(node.source ?? '')) throw new Error('YAML timestamp calendar year cannot be safely preserved.');
    if (isScalar(node) && node.tag === 'tag:yaml.org,2002:binary') {
      const text = (node.source ?? '').replace(/\s/g, '');
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text) || Buffer.from(text,'base64').toString('base64') !== text) throw new Error('Invalid YAML binary payload.');
    }
    // JS Date 只能表示毫秒；拒绝会丢失精度的时间戳，不改动原文件。
    if (isScalar(node) && node.value instanceof Date && /\.\d{3}\d*[1-9]\d*(?:Z|[+\-]|\s|$)/.test(node.source ?? '')) {
      throw new Error('YAML timestamp precision exceeds safe millisecond storage.');
    }
    if (isMap(node) && node.items.some(pair => !isScalar(pair.key) || typeof pair.key.value !== 'string')) {
      throw new Error('YAML mapping keys must be strings for lossless configuration snapshots.');
    }
    if (isScalar(node) && typeof node.value === 'bigint' && node.value <= BigInt(Number.MAX_SAFE_INTEGER) && node.value >= BigInt(Number.MIN_SAFE_INTEGER)) node.value = Number(node.value);
    if (isAlias(node) || ('anchor' in node && node.anchor)) throw new Error('YAML anchors and aliases are not supported for safe editing.');
  } });
  if (!doc.contents) doc.contents = doc.createNode({});
  if (!isMap(doc.contents)) throw new Error('YAML configuration must be a mapping.');
  return doc;
}

export function setYamlValue(doc: Document, keys: string[], value: unknown): void {
  if (!keys.length) throw new Error('YAML path must not be empty.');
  for (let depth = 1; depth < keys.length; depth++) {
    const parent = keys.slice(0, depth);
    if (!doc.hasIn(parent)) doc.setIn(parent, doc.createNode({}));
    else if (!isMap(doc.getIn(parent, true))) throw new Error('YAML parent must be a mapping: ' + parent.join('.'));
  }
  const node = doc.getIn(keys, true);
  const next = doc.createNode(value, { aliasDuplicateObjects: false });
  if (isNode(node)) {
    next.comment = node.comment;
    next.commentBefore = node.commentBefore;
    next.spaceBefore = node.spaceBefore;
    if (isScalar(node) && isScalar(next) && typeof node.value === 'string' && typeof value === 'string') next.type = node.type;
  }
  doc.setIn(keys, next);
}

export function getYamlValue(doc: Document, keys: string[]): unknown {
  const node = doc.getIn(keys, true);
  if (node === undefined && doc.hasIn(keys)) return null;
  return isScalar(node) ? node.value : isCollection(node) ? node.toJS(doc) : node;
}

export function deleteYamlValue(doc: Document, keys: string[]): void {
  if (!keys.length) throw new Error('YAML path must not be empty.');
  const parent = keys.length > 1 ? doc.getIn(keys.slice(0, -1), true) : doc.contents;
  if (!isMap(parent)) return;
  doc.deleteIn(keys);
}

// undefined 表示缺失，null 是合法 YAML 值
export function restoreYamlValue(doc: Document, keys: string[], value: unknown): void {
  if (value === undefined) deleteYamlValue(doc, keys);
  else setYamlValue(doc, keys, value);
}

export function stringifyYamlDocument(doc: Document): string {
  return String(doc);
}

export function setYamlLine(content: string, parent: string, key: string, value: string): string {
  const doc = parseYamlDocument(content);
  setYamlValue(doc, [parent, key], value);
  return stringifyYamlDocument(doc);
}
