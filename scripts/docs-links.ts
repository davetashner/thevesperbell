// Markdown link check (mw-e00.22 AC-3): every relative link in the listed docs points at a file or
// directory that exists. External links, mail links and in-page anchors are not checked, and links
// inside code fences and inline code are ignored.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** Docs whose relative links are checked on every run of the unit tests. */
export const CHECKED_DOCS: readonly string[] = [
  'CONTRIBUTING.md',
  'README.md',
  'AGENTS.md',
  'docs/adr/README.md',
];

export interface MarkdownLink {
  line: number;
  target: string;
}

/** The relative link targets in a markdown text (no scheme, no leading `#`, anchors stripped). */
export function relativeLinks(markdown: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  let fenced = false;
  markdown.split('\n').forEach((raw, i) => {
    if (/^\s*(```|~~~)/.test(raw)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const text = raw.replace(/`[^`]*`/g, '');
    for (const m of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = String(m[1]).replace(/^<|>$/g, '');
      if (target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const path = target.replace(/#.*$/, '');
      links.push({ line: i + 1, target: path });
    }
  });
  return links;
}

/** One message per relative link in `file` (repo-relative) whose target does not exist. */
export function brokenLinks(file: string, markdown: string, root: string): string[] {
  const base = dirname(resolve(root, file));
  return relativeLinks(markdown)
    .filter((l) => !existsSync(resolve(base, decodeURIComponent(l.target))))
    .map((l) => `${file}:${String(l.line)}: broken link to ${l.target}`);
}
