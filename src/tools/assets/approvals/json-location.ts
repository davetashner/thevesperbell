// Where a JSON text first goes wrong. V8's JSON.parse messages only sometimes carry a position
// ("Unexpected token ',', ..."rds": [ ,]"... is not valid JSON" does not), so after a failed parse this
// scanner walks the RFC 8259 grammar to find the offset, reported as line and column.

class SyntaxAt extends Error {
  constructor(readonly offset: number) {
    super(`JSON syntax error at ${String(offset)}`);
  }
}

const LITERAL = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/;
const ESCAPE = /^(?:["\\/bfnrt]|u[0-9a-fA-F]{4})/;

/** Offset of the first syntax error in `text`, or `text.length` when the text is valid JSON. */
export function jsonErrorOffset(text: string): number {
  let i = 0;
  const at = (): string => text.charAt(i);
  const fail = (): never => {
    throw new SyntaxAt(i);
  };
  const space = (): void => {
    while (i < text.length && ' \t\n\r'.includes(at())) i++;
  };
  const expect = (char: string): void => {
    space();
    if (at() !== char) fail();
    i++;
  };
  const string = (): void => {
    expect('"');
    for (;;) {
      const c = at();
      if (c === '"') break;
      if (c === '' || c < ' ') fail();
      i++;
      if (c === '\\') {
        if (!ESCAPE.test(text.slice(i))) fail();
        i += at() === 'u' ? 5 : 1;
      }
    }
    i++;
  };
  /** Comma-separated items up to `close`, after the opening bracket. */
  const items = (close: string, item: () => void): void => {
    space();
    if (at() === close) {
      i++;
      return;
    }
    for (;;) {
      item();
      space();
      if (at() === close) break;
      expect(',');
    }
    i++;
  };
  const value = (): void => {
    space();
    const c = at();
    if (c === '{' || c === '[') {
      i++;
      if (c === '[') items(']', value);
      else
        items('}', () => {
          string();
          expect(':');
          value();
        });
      return;
    }
    if (c === '"') {
      string();
      return;
    }
    const literal = LITERAL.exec(text.slice(i));
    if (literal === null) fail();
    else i += literal[0].length;
  };
  try {
    value();
    space();
    if (i < text.length) fail();
    return i;
  } catch (error) {
    return (error as SyntaxAt).offset;
  }
}

/** "line L column C" (1-based) of an offset in `text`. */
export function lineColumn(text: string, offset: number): string {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  const column = offset - before.lastIndexOf('\n');
  return `line ${String(line)} column ${String(column)}`;
}
