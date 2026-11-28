import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assetIdOf, parsePrompt, readStyleRules } from './gen-image-prompt';

const bible = readFileSync('docs/art/style-bible.md', 'utf8');
const rules = readStyleRules(bible);
const TILE = rules.addOns.get('Tileable texture') ?? '';

const file = (block: string, heading = '## 3. Filled prompt'): string =>
  `# tex-x-01\n\n${heading}\n\n\`\`\`text\n${block}\n\`\`\`\n\n## 4. Output spec\n`;

describe('readStyleRules', () => {
  it('reads the §14 preamble and every §14.1 add-on from the real bible', () => {
    expect(rules.preamble.startsWith('STYLE: Stylized hand-painted fantasy art')).toBe(true);
    expect(rules.preamble.endsWith('no gore.')).toBe(true);
    expect(rules.addOns.size).toBe(14);
    expect(TILE.startsWith('Seamless tileable texture')).toBe(true);
  });

  it('throws when the bible has no §14 block', () => {
    expect(() => readStyleRules('# nothing here')).toThrow('no §14 preamble');
    expect(() => readStyleRules('## 14. GPT STYLE PREAMBLE\n\nno fence')).toThrow('no §14 preamble');
    expect(() => readStyleRules('## 14. GPT\n\n```text\nunclosed')).toThrow('no §14 preamble');
    expect(() => readStyleRules('## 14. GPT\n\n```text\n   \n```')).toThrow('no §14 preamble');
  });
});

describe('parsePrompt', () => {
  it('AC-1: rejects a prompt whose preamble is not verbatim', () => {
    const paraphrased = rules.preamble.replace('broad confident', 'bold');
    expect(() => parsePrompt('p/tex-x-01.md', file(`${paraphrased}\n\n${TILE}`), rules)).toThrow(
      'p/tex-x-01.md: the prompt does not open with the style bible §14 preamble verbatim',
    );
    expect(() => parsePrompt('p/tex-x-01.md', file(`MATERIAL: stone\n\n${rules.preamble}`), rules)).toThrow('verbatim');
  });

  it('AC-1: rejects a file with no filled-prompt block, or an unfilled placeholder', () => {
    expect(() => parsePrompt('a.md', '# a\n\n```text\nSTYLE\n```', rules)).toThrow('no ```text block');
    expect(() => parsePrompt('a.md', file('x', '## 3. Brief'), rules)).toThrow('no ```text block');
    expect(() => parsePrompt('a.md', file(`${rules.preamble}\n\nMATERIAL: <cobblestone|plank>.`), rules)).toThrow(
      'unfilled placeholder <cobblestone|plank>',
    );
    expect(() => parsePrompt('a.md', file(`${rules.preamble}\n\n{{GPT_STYLE_PREAMBLE}}`), rules)).toThrow(
      'unfilled placeholder {{GPT_STYLE_PREAMBLE}}',
    );
  });

  it('takes the block under the heading, drops template comments and reference-image lines, names the category', () => {
    const block = `${rules.preamble}\n# ↑ a template comment\n\n${TILE}\n\nCOLOURS: #8C8A80 stone.\nREFERENCE IMAGES: the attached images.`;
    const parsed = parsePrompt('assets/prompts/texture/tex-x-01.md', file(block, '## 2. Filled prompt (preamble verbatim)'), rules);
    expect(parsed).toEqual({
      assetId: 'tex-x-01',
      category: 'Tileable texture',
      text: `${rules.preamble}\n\n${TILE}\n\nCOLOURS: #8C8A80 stone.`,
      dropped: ['REFERENCE IMAGES: the attached images.'],
    });
  });

  it('has no category when no add-on follows the preamble', () => {
    expect(parsePrompt('x.md', file(rules.preamble), rules).category).toBeNull();
  });

  it('parses every committed texture, environment and prop-sheet prompt file', () => {
    for (const path of [
      'assets/prompts/texture/tex-stone-breakwater-01.md',
      'assets/prompts/texture/tex-rope-hawser-trim-01.md',
      'assets/prompts/environment/env-gilded-tern-deck-01.md',
    ]) {
      expect(parsePrompt(path, readFileSync(path, 'utf8'), rules).category, path).not.toBeNull();
    }
  });
});

describe('assetIdOf', () => {
  it('is the filename stem', () => {
    expect(assetIdOf('assets/prompts/texture/tex-a-01.md')).toBe('tex-a-01');
    expect(assetIdOf('tex-b-01')).toBe('tex-b-01');
  });
});
