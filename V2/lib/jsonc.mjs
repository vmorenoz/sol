function syntax(message, offset) {
  throw new SyntaxError(`${message} at offset ${offset}`);
}

function parser(text) {
  let i = 0;
  const ws = () => {
    while (i < text.length) {
      if (/\s/.test(text[i])) { i++; continue; }
      if (text[i] === '/' && text[i + 1] === '/') {
        i += 2;
        while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
        continue;
      }
      if (text[i] === '/' && text[i + 1] === '*') {
        const start = i;
        i += 2;
        while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
        if (i >= text.length) syntax('Unterminated block comment', start);
        i += 2;
        continue;
      }
      break;
    }
  };
  const string = () => {
    const start = i++;
    while (i < text.length) {
      const c = text[i++];
      if (c === '"') {
        let value;
        try { value = JSON.parse(text.slice(start, i)); }
        catch { syntax('Invalid string', start); }
        return { value, start, end: i };
      }
      if (c === '\\') {
        if (i >= text.length) syntax('Unterminated escape', start);
        i++;
      } else if (c < ' ') syntax('Control character in string', i - 1);
    }
    syntax('Unterminated string', start);
  };
  const value = () => {
    ws();
    const start = i, c = text[i];
    if (c === '{') {
      i++;
      const node = { type: 'object', start, properties: [], end: 0 };
      const names = new Set();
      ws();
      if (text[i] === '}') { node.end = ++i; return node; }
      while (true) {
        ws();
        if (text[i] !== '"') syntax('Expected object key', i);
        const key = string();
        if (names.has(key.value)) syntax(`Duplicate key ${JSON.stringify(key.value)}`, key.start);
        names.add(key.value);
        ws();
        if (text[i++] !== ':') syntax('Expected colon', i - 1);
        const child = value();
        const prop = { key: key.value, keyStart: key.start, value: child, start: key.start, end: child.end, comma: null };
        node.properties.push(prop);
        ws();
        if (text[i] === ',') { prop.comma = { start: i, end: i + 1 }; i++; ws(); if (text[i] === '}') { node.end = ++i; return node; } continue; }
        if (text[i] === '}') { node.end = ++i; return node; }
        syntax('Expected comma or closing brace', i);
      }
    }
    if (c === '[') {
      i++;
      const node = { type: 'array', start, items: [], end: 0 };
      ws();
      if (text[i] === ']') { node.end = ++i; return node; }
      while (true) {
        const item = value();
        node.items.push({ value: item, start: item.start, end: item.end, comma: null });
        const entry = node.items.at(-1);
        ws();
        if (text[i] === ',') { entry.comma = { start: i, end: i + 1 }; i++; ws(); if (text[i] === ']') { node.end = ++i; return node; } continue; }
        if (text[i] === ']') { node.end = ++i; return node; }
        syntax('Expected comma or closing bracket', i);
      }
    }
    if (c === '"') { const s = string(); return { type: 'scalar', value: s.value, start, end: s.end }; }
    const rest = text.slice(i);
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(rest);
    if (match) {
      i += match[0].length;
      let v;
      try { v = JSON.parse(match[0]); } catch { syntax('Invalid number', start); }
      return { type: 'scalar', value: v, start, end: i };
    }
    syntax('Expected JSON value', i);
  };
  ws();
  const root = value();
  ws();
  if (i !== text.length) syntax('Unexpected trailing token', i);
  return root;
}

function materialize(node) {
  if (node.type === 'scalar') return node.value;
  if (node.type === 'array') return node.items.map(({ value }) => materialize(value));
  const out = {};
  for (const prop of node.properties) Object.defineProperty(out, prop.key, {
    value: materialize(prop.value), enumerable: true, writable: true, configurable: true,
  });
  return out;
}

export function parseJSONC(text) {
  if (typeof text !== 'string') throw new TypeError('JSONC input must be a string');
  return materialize(parser(text));
}

export function editJSONC(text, edits) {
  if (typeof text !== 'string') throw new TypeError('JSONC input must be a string');
  if (!Array.isArray(edits)) throw new TypeError('edits must be an array');
  let output = text;
  parser(output);
  for (const edit of edits) {
    if (!edit || !Array.isArray(edit.path) || edit.path.length === 0) throw new TypeError('Each edit requires a non-empty path array');
    const root = parser(output);
    let node = root, parent = null, entry = null;
    for (let n = 0; n < edit.path.length; n++) {
      const key = edit.path[n];
      parent = node;
      if (node.type === 'object' && typeof key === 'string') {
        entry = node.properties.find(p => p.key === key);
        if (!entry) { entry = null; break; }
        node = entry.value;
      } else if (node.type === 'array' && Number.isInteger(key) && key >= 0) {
        entry = node.items[key];
        if (!entry) { entry = null; break; }
        node = entry.value;
      } else { entry = null; break; }
    }
    if (!entry) {
      if (edit.value === undefined) continue;
      throw new Error(`Cannot replace missing JSONC path: ${edit.path.join('.')}`);
    }
    let ranges;
    if (edit.value === undefined) {
      const entries = parent.type === 'object' ? parent.properties : parent.items;
      const index = entries.indexOf(entry);
      ranges = [{ start: entry.start, end: entry.end, replacement: '' }];
      const comma = entry.comma ?? (index > 0 ? entries[index - 1].comma : null);
      if (comma) ranges.push({ start: comma.start, end: comma.end, replacement: '' });
    } else {
      const replacement = JSON.stringify(edit.value);
      if (replacement === undefined) throw new TypeError('Replacement value is not JSON serializable');
      ranges = [{ start: node.start, end: node.end, replacement }];
    }
    ranges.sort((a, b) => b.start - a.start);
    for (const range of ranges)
      output = output.slice(0, range.start) + range.replacement + output.slice(range.end);
    parser(output);
  }
  return output;
}

export function upsertJSONC(text, edits) {
  if (typeof text !== 'string') throw new TypeError('JSONC input must be a string');
  if (!Array.isArray(edits)) throw new TypeError('edits must be an array');
  parser(text);
  let output = text;
  for (const edit of edits) {
    if (!edit || !Array.isArray(edit.path) || edit.path.length === 0 || edit.path.some(key => typeof key !== 'string'))
      throw new TypeError('Each upsert requires a non-empty path of string keys');
    if (edit.value === undefined) {
      output = editJSONC(output, [edit]);
      continue;
    }
    const encoded = JSON.stringify(edit.value);
    if (encoded === undefined) throw new TypeError('Replacement value is not JSON serializable');

    let root = parser(output);
    if (root.type !== 'object') throw new Error('Cannot upsert JSONC path: root must be an object');
    let node = root;
    let missingAt = -1;
    for (let n = 0; n < edit.path.length; n++) {
      if (node.type !== 'object')
        throw new Error(`Cannot create JSONC path ${edit.path.join('.')}: ${edit.path.slice(0, n).join('.') || 'root'} is not an object`);
      const prop = node.properties.find(item => item.key === edit.path[n]);
      if (!prop) { missingAt = n; break; }
      node = prop.value;
    }
    if (missingAt < 0) {
      output = editJSONC(output, [edit]);
      continue;
    }

    // Create absent object parents from the leaf upwards, then insert the first
    // missing member into its existing parent without rewriting surrounding text.
    let valueText = encoded;
    for (let n = edit.path.length - 1; n > missingAt; n--)
      valueText = `{${JSON.stringify(edit.path[n])}:${valueText}}`;
    const parent = node;
    const close = parent.end - 1;
    const last = parent.properties.at(-1);
    const newline = output.includes('\r\n') ? '\r\n' : '\n';
    const lineStart = output.lastIndexOf('\n', parent.start) + 1;
    const parentIndent = /^[\t ]*/.exec(output.slice(lineStart, parent.start))[0];
    const childIndent = last
      ? (/^[\t ]*/.exec(output.slice(output.lastIndexOf('\n', last.keyStart) + 1, last.keyStart))[0] || `${parentIndent}  `)
      : `${parentIndent}  `;
    const beforeClose = output.slice(last ? last.end : parent.start + 1, close);
    const trailing = /^[\s]*(?:(?:\/\/[^\r\n]*|\/\*[\s\S]*?\*\/)[\s]*)*$/.test(beforeClose) ? beforeClose : '';
    const member = `${JSON.stringify(edit.path[missingAt])}: ${valueText}`;
    const insertion = last
      ? `${member}${newline}${parentIndent}`
      : (trailing ? `${member}${newline}${parentIndent}` : member);
    let ranges = [{ start: close, end: close, replacement: insertion }];
    if (last && !last.comma) ranges.push({ start: last.value.end, end: last.value.end, replacement: ',' });
    ranges.sort((a, b) => b.start - a.start);
    for (const range of ranges)
      output = output.slice(0, range.start) + range.replacement + output.slice(range.end);
    parser(output);
  }
  return output;
}
