// Where in a JSON text a value sits (mw-e22.3): maps every RFC 6901 pointer of a well-formed JSON
// document to the 1-based line its value starts on, so tools can report "file, node id and line"
// for problems the schema found by pointer. The text must already have parsed with `JSON.parse`.

/** Pointer (`/nodes/3/kind`, `` for the root) → line the value starts on. */
export type JsonLines = ReadonlyMap<string, number>;

const escape = (key: string): string => key.replaceAll('~', '~0').replaceAll('/', '~1');

/** The start line of every value of the JSON document `text`. */
export function locateJson(text: string): JsonLines {
  const lines = new Map<string, number>();
  let pos = 0;
  let line = 1;

  const skipSpace = (): void => {
    for (;;) {
      const ch = text[pos];
      if (ch === '\n') line++;
      else if (ch !== ' ' && ch !== '\t' && ch !== '\r') return;
      pos++;
    }
  };

  /** Skips a string at `pos` (opening quote included) and returns its decoded value. */
  const string = (): string => {
    const start = pos;
    pos++;
    while (text[pos] !== '"') pos += text[pos] === '\\' ? 2 : 1;
    pos++;
    return JSON.parse(text.slice(start, pos)) as string;
  };

  const value = (pointer: string): void => {
    skipSpace();
    lines.set(pointer, line);
    const ch = text[pos];
    if (ch === '{') {
      pos++;
      skipSpace();
      while (text[pos] !== '}') {
        const key = string();
        skipSpace();
        pos++; // the colon
        value(`${pointer}/${escape(key)}`);
        skipSpace();
        if (text[pos] === ',') pos++;
        skipSpace();
      }
      pos++;
    } else if (ch === '[') {
      pos++;
      skipSpace();
      for (let index = 0; text[pos] !== ']'; index++) {
        value(`${pointer}/${String(index)}`);
        skipSpace();
        if (text[pos] === ',') pos++;
        skipSpace();
      }
      pos++;
    } else if (ch === '"') {
      string();
    } else {
      while (!/[\s,\]}]/.test(text[pos] ?? ' ')) pos++;
    }
  };

  value('');
  return lines;
}

/** The line of `pointer`, or of its nearest ancestor (a missing key reports the object missing it). */
export function lineOf(lines: JsonLines, pointer: string): number {
  for (let at = pointer; ; at = at.slice(0, at.lastIndexOf('/'))) {
    const line = lines.get(at);
    if (line !== undefined) return line;
  }
}
