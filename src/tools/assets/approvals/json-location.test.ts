import { describe, expect, it } from 'vitest';
import { jsonErrorOffset, lineColumn } from './json-location.ts';

describe('JSON error location', () => {
  it('returns the length of valid JSON', () => {
    const text = ' {"a": [1, -2.5e3, true, null, "x\\u00e9\\n"], "b": {}, "c": []} ';
    expect(() => JSON.parse(text) as unknown).not.toThrow();
    expect(jsonErrorOffset(text)).toBe(text.length);
  });

  it.each([
    ['{"a" 1}', 5],
    ['{a: 1}', 1],
    ['{"a": 1 "b": 2}', 8],
    ['[1 2]', 3],
    ['[1,]', 3],
    ['[tru]', 1],
    ['"\\x"', 2],
    ['"a\nb"', 2],
    ['"abc', 4],
    ['{} x', 3],
    ['', 0],
  ])('finds the first error in %j at offset %i', (text, offset) => {
    expect(() => JSON.parse(text) as unknown).toThrow();
    expect(jsonErrorOffset(text)).toBe(offset);
  });

  it('reports 1-based line and column', () => {
    expect(lineColumn('abc', 1)).toBe('line 1 column 2');
    expect(lineColumn('{\n  ,', 4)).toBe('line 2 column 3');
  });
});
