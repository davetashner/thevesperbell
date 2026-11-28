// Reads the filled prompt block out of an asset prompt file (assets/prompts/<category>/<id>.md) and
// checks it against the style bible: the §14 preamble must open the block verbatim (never
// paraphrased, assets/prompts/README.md Rules), and the paragraph after it names the §14.1 category.

/** The style-bible text a prompt is checked against. */
export interface StyleRules {
  /** The §14 GPT STYLE PREAMBLE, verbatim. */
  readonly preamble: string;
  /** §14.1 add-ons by category name, as the table spells it (e.g. "Tileable texture"). */
  readonly addOns: ReadonlyMap<string, string>;
}

/** A prompt ready for a generator. */
export interface ParsedPrompt {
  /** The filename stem, which is the asset id (contract §6). */
  readonly assetId: string;
  /** The §14.1 category whose add-on follows the preamble, or null when none does. */
  readonly category: string | null;
  /** What the generator gets: the block, minus reference-image lines a local model cannot use. */
  readonly text: string;
  /** Lines dropped from the block (reference-image instructions). */
  readonly dropped: readonly string[];
}

/** The first ```text fence at or after `from`, or null. */
function textFence(markdown: string, from: number): string | null {
  const open = markdown.indexOf('```text\n', from);
  if (open < 0) return null;
  const start = open + '```text\n'.length;
  const close = markdown.indexOf('\n```', start - 1);
  if (close < 0) return null;
  return markdown.slice(start, close);
}

/** Pulls the §14 preamble and the §14.1 add-on table out of docs/art/style-bible.md. */
export function readStyleRules(bible: string): StyleRules {
  const heading = /^## 14\. .*$/m.exec(bible);
  const preamble = heading === null ? null : textFence(bible, heading.index)?.trim();
  if (preamble === undefined || preamble === null || preamble === '') {
    throw new Error('style bible: no §14 preamble block found');
  }
  const addOns = new Map<string, string>();
  for (const [, name = '', text = ''] of bible.matchAll(/^\| \*\*(.+?)\*\* \| `(.+)` \|$/gm)) {
    addOns.set(name, text);
  }
  return { preamble, addOns };
}

/** The asset id of a prompt file path: its filename stem. */
export function assetIdOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base.endsWith('.md') ? base.slice(0, -3) : base;
}

/**
 * Parses a filled prompt file. Throws, naming the file, when there is no filled-prompt block, the
 * block does not open with the verbatim preamble, or a template placeholder is left in it.
 */
export function parsePrompt(path: string, markdown: string, rules: StyleRules): ParsedPrompt {
  const heading = /^## \d+\. Filled prompt.*$/m.exec(markdown);
  const block = heading === null ? null : textFence(markdown, heading.index);
  if (block === null) throw new Error(`${path}: no \`\`\`text block under a "Filled prompt" heading`);
  const lines = block.split('\n').filter((line) => !line.startsWith('# '));
  const dropped = lines.filter((line) => line.startsWith('REFERENCE IMAGES:'));
  const text = lines
    .filter((line) => !dropped.includes(line))
    .join('\n')
    .trim();
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim());
  if (paragraphs[0] !== rules.preamble) {
    throw new Error(`${path}: the prompt does not open with the style bible §14 preamble verbatim`);
  }
  const placeholder = /\{\{[^}]*\}\}|<[^<>\n]+>/.exec(text);
  if (placeholder !== null) throw new Error(`${path}: unfilled placeholder ${placeholder[0]}`);
  let category: string | null = null;
  for (const [name, addOn] of rules.addOns) {
    if (paragraphs[1] === addOn) category = name;
  }
  return { assetId: assetIdOf(path), category, text, dropped };
}
