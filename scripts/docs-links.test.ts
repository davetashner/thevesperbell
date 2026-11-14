import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { brokenLinks, CHECKED_DOCS, relativeLinks } from './docs-links.ts';

describe('relativeLinks', () => {
  it('finds relative targets, strips anchors and titles, and skips the rest', () => {
    const md = [
      '[a](docs/a.md) [b](docs/b.md#part) [c](<docs/c.md>) [d](docs/d.md "Title")',
      '[web](https://example.com/x.md) [mail](mailto:a@b.c) [top](#top)',
      '`[code](missing.md)`',
      '```',
      '[fenced](missing.md)',
      '```',
      '[after](e.md)',
    ].join('\n');
    expect(relativeLinks(md)).toEqual([
      { line: 1, target: 'docs/a.md' },
      { line: 1, target: 'docs/b.md' },
      { line: 1, target: 'docs/c.md' },
      { line: 1, target: 'docs/d.md' },
      { line: 7, target: 'e.md' },
    ]);
  });
});

describe('brokenLinks', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('AC-3: reports a missing target with its line, resolving from the file own folder', () => {
    const root = mkdtempSync(join(tmpdir(), 'links-'));
    dirs.push(root);
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs', 'ok.md'), '');
    const md = '[ok](ok.md)\n[bad](nope.md)\n[up](../docs/ok.md)';
    expect(brokenLinks('docs/x.md', md, root)).toEqual(['docs/x.md:2: broken link to nope.md']);
  });
});

describe('repository docs', () => {
  it.each(CHECKED_DOCS)('AC-3: %s has no broken relative links', (file) => {
    expect(brokenLinks(file, readFileSync(file, 'utf8'), process.cwd())).toEqual([]);
  });
});
