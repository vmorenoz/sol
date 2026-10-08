import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJSONC, editJSONC, upsertJSONC } from '../lib/jsonc.mjs';

test('parses JSONC strings, comments, escapes, trailing commas, and CRLF', () => {
  const text = '{\r\n // keep this\r\n "url":"https://example.test/a//b", /* block */ "quote":"a\\\"b",\r\n "items":[1,2,],\r\n}';
  assert.deepEqual(parseJSONC(text), { url: 'https://example.test/a//b', quote: 'a"b', items: [1, 2] });
});

test('preserves unrelated comment bytes while editing and replaces existing values', () => {
  const source = '{\n  // unrelated exact comment\n  "default_agent": "old",\n  "other": "https://x/y" // trailing\n}\n';
  const result = editJSONC(source, [{ path: ['default_agent'], value: 'build' }]);
  assert.equal(result, source.replace('"old"', '"build"'));
  assert.match(result, /\/\/ unrelated exact comment/);
  assert.deepEqual(parseJSONC(result).default_agent, 'build');
});

test('removes first, middle, last, and only object properties', () => {
  assert.deepEqual(parseJSONC(editJSONC('{"a":1,"b":2,"c":3}', [{ path: ['a'], value: undefined }])), { b: 2, c: 3 });
  assert.deepEqual(parseJSONC(editJSONC('{"a":1,"b":2,"c":3}', [{ path: ['b'], value: undefined }])), { a: 1, c: 3 });
  assert.deepEqual(parseJSONC(editJSONC('{"a":1,"b":2,"c":3}', [{ path: ['c'], value: undefined }])), { a: 1, b: 2 });
  assert.deepEqual(parseJSONC(editJSONC('{"a":1,}', [{ path: ['a'], value: undefined }])), {});
});

test('supports nested paths and sequential descending array removals', () => {
  let text = '{"mcp":{"servers":{"sol":{"command":"one"}},"sol":{"x":1}},"plugin":["a","b","c"]}';
  text = editJSONC(text, [
    { path: ['mcp', 'servers', 'sol'], value: undefined },
    { path: ['mcp', 'sol'], value: undefined },
    { path: ['plugin', 2], value: undefined },
    { path: ['plugin', 1], value: undefined },
  ]);
  assert.deepEqual(parseJSONC(text), { mcp: { servers: {} }, plugin: ['a'] });
});

test('preserves comments outside deleted field spans', () => {
  const source = '{\n // before\n "a": 1,\n // survives after deleted first field\n "b": 2\n}';
  const result = editJSONC(source, [{ path: ['a'], value: undefined }]);
  assert.match(result, /\/\/ before/);
  assert.match(result, /\/\/ survives after deleted first field/);
  assert.deepEqual(parseJSONC(result), { b: 2 });
});

test('deletes object and array members using disjoint spans, preserving comments around commas', () => {
  const cases = [
    ['object first', '{"a":1 /* before comma */, // after comma\n"b":2}', ['a'], { b: 2 }],
    ['object middle', '{"a":1, // before member\n"b":2 /* before comma */, // after comma\n"c":3}', ['b'], { a: 1, c: 3 }],
    ['object last', '{"a":1, // before member\n"b":2 /* before comma */, // after comma\n"c":3}', ['c'], { a: 1, b: 2 }],
    ['object only', '{"a":1 /* after value */}', ['a'], {}],
    ['array first', '[1 /* before comma */, // after comma\n2]', [0], [2]],
    ['array middle', '[1, // before member\n2 /* before comma */, // after comma\n3]', [1], [1, 3]],
    ['array last', '[1, // before member\n2 /* before comma */, // after comma\n3]', [2], [1, 2]],
    ['array only', '[1 /* after value */]', [0], []],
  ];
  for (const [label, source, path, expected] of cases) {
    const result = editJSONC(source, [{ path, value: undefined }]);
    assert.deepEqual(parseJSONC(result), expected, label);
    for (const comment of ['before comma', 'after comma', 'before member', 'after value']) {
      if (source.includes(comment)) assert.ok(result.includes(comment), `${label} lost ${comment}`);
    }
  }
});

test('absent deletion is a no-op; absent replacement and malformed input fail', () => {
  assert.equal(editJSONC('{"a":1}', [{ path: ['missing'], value: undefined }]), '{"a":1}');
  assert.throws(() => editJSONC('{"a":1}', [{ path: ['missing'], value: 2 }]), /missing/);
  for (const bad of ['{"a":}', '{"a":1,,}', '[1 2]', 'true false', '/* nope', '{"x":1,"x":2}'])
    assert.throws(() => parseJSONC(bad));
});

test('handles prototype-sensitive keys without pollution or lost own properties', () => {
  const value = parseJSONC('{"__proto__":{"polluted":true},"constructor":1}');
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.equal(Object.hasOwn(value, '__proto__'), true);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(value.__proto__, { polluted: true });
});

test('upserts nested agent configuration while preserving existing bytes and comments', () => {
  const source = '{\n  // agents comment\n  "agents": {\n    "default": {"permissions": {"read": true}},\n  },\n  "other": 1\n}\n';
  const result = upsertJSONC(source, [{ path: ['agents', 'sol', 'model'], value: 'openai/gpt-6.1-sol#medium' }]);
  assert.deepEqual(parseJSONC(result).agents.sol.model, 'openai/gpt-6.1-sol#medium');
  assert.deepEqual(parseJSONC(result).agents.default.permissions, { read: true });
  assert.ok(result.includes('    "default": {"permissions": {"read": true}},\n'));
  assert.ok(result.includes('  "other": 1\n'));
});

test('upsert inserts across comma comments and supports trailing commas and comment-only objects', () => {
  for (const source of ['{"a":1 /* before comma */, // after comma\n}', '{"a":1 // after value\n}', '{"a":1, /* trailing */}']) {
    const result = upsertJSONC(source, [{ path: ['b'], value: 2 }]);
    assert.deepEqual(parseJSONC(result), { a: 1, b: 2 });
    assert.ok(result.includes('/* before comma */') || result.includes('// after value') || result.includes('/* trailing */'));
  }
  assert.deepEqual(parseJSONC(upsertJSONC('{ /* keep */ }', [{ path: ['x'], value: 1 }])), { x: 1 });
  assert.deepEqual(parseJSONC(upsertJSONC('{\r\n  }', [{ path: ['x'], value: 1 }])), { x: 1 });
});

test('upsert rejects scalar parents and invalid paths; existing update/delete retain edit semantics', () => {
  assert.throws(() => upsertJSONC('{"agents":null}', [{ path: ['agents', 'sol'], value: {} }]), /not an object/);
  assert.throws(() => upsertJSONC('[]', [{ path: ['x'], value: 1 }]), /root must be an object/);
  assert.throws(() => upsertJSONC('{}', [{ path: ['x', 0], value: 1 }]), /string keys/);
  assert.equal(parseJSONC(upsertJSONC('{"x":1}', [{ path: ['x'], value: 2 }])).x, 2);
  assert.equal(upsertJSONC('{"x":1}', [{ path: ['missing'], value: undefined }]), '{"x":1}');
  assert.equal(parseJSONC(upsertJSONC('{"x":1}', [{ path: ['missing'], value: 2 }])).missing, 2);
  assert.throws(() => editJSONC('{"x":1}', [{ path: ['missing'], value: 2 }]), /missing/);
});
