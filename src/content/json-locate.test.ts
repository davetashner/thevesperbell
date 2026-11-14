import { describe, expect, it } from 'vitest';
import { lineOf, locateJson } from './json-locate.ts';

const text = `{
  "id": "a\\"b",
  "list": [
    1,
    { "k": true, "s": "x,]}" },
    -2.5e3
  ],
  "empty": {},
  "none": [],
  "a/b~c": null
}`;

describe('locateJson', () => {
  const lines = locateJson(text);

  it('maps every pointer to the line its value starts on', () => {
    expect(lines.get('')).toBe(1);
    expect(lines.get('/id')).toBe(2);
    expect(lines.get('/list')).toBe(3);
    expect(lines.get('/list/0')).toBe(4);
    expect(lines.get('/list/1')).toBe(5);
    expect(lines.get('/list/1/k')).toBe(5);
    expect(lines.get('/list/1/s')).toBe(5);
    expect(lines.get('/list/2')).toBe(6);
    expect(lines.get('/empty')).toBe(8);
    expect(lines.get('/none')).toBe(9);
    expect(lines.get('/a~1b~0c')).toBe(10);
  });

  it('handles a bare scalar document and CRLF line ends', () => {
    expect(locateJson('5').get('')).toBe(1);
    expect(locateJson('{\r\n"a":\r\n  1}').get('/a')).toBe(3);
  });

  it('lineOf falls back to the nearest ancestor', () => {
    expect(lineOf(lines, '/list/1/k')).toBe(5);
    expect(lineOf(lines, '/list/1/missing')).toBe(5);
    expect(lineOf(lines, '/missing')).toBe(1);
    expect(lineOf(lines, '')).toBe(1);
  });
});
