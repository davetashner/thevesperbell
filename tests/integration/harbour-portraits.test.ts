// The harbour cast dialogue portraits (owner-approved 2026-11-16): one per named harbour character, each
// with its approved source image, a CREDITS row and an approved prompt file; the veiled agent's prompt
// never shows a face (style bible §5.4: only glimpsed).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PORTRAITS = [
  'portrait-npc-mags-bargewoman',
  'portrait-npc-nell-gull-keeper',
  'portrait-npc-cray-inspector',
  'portrait-npc-tereza-merchant',
  'portrait-npc-jasper-shipping-agent',
  'portrait-npc-oona-dockhand',
  'portrait-npc-reed-lock-keeper',
  'portrait-npc-hesketh-captain',
  'portrait-npc-agent-veiled',
] as const;
const credits = readFileSync('assets/CREDITS.md', 'utf8');

describe('harbour cast portraits', () => {
  it('every portrait has its approved source image, a CREDITS row and an approved prompt file', () => {
    for (const id of PORTRAITS) {
      expect(existsSync(`assets/source/portrait/${id}/${id}.png`), `${id} source`).toBe(true);
      expect(credits, `${id} CREDITS row`).toContain(`| \`${id}\` | portrait |`);
      expect(readFileSync(`assets/prompts/portrait/${id}.md`, 'utf8')).toContain(
        '**Status: owner-approved concept**',
      );
    }
  });

  it('the veiled agent is drawn without a face', () => {
    const prompt = readFileSync('assets/prompts/portrait/portrait-npc-agent-veiled.md', 'utf8');
    expect(prompt).toContain('NO face');
  });

  it('every creature portrait id has its runtime webp, source image and CREDITS row (mw-e37.433)', () => {
    const ids = readdirSync('src/content/data/creature').flatMap((file) => {
      const def = JSON.parse(readFileSync(`src/content/data/creature/${file}`, 'utf8')) as {
        presentation?: { portrait?: string };
      };
      return def.presentation?.portrait === undefined ? [] : [def.presentation.portrait];
    });
    expect(ids.length).toBeGreaterThanOrEqual(9);
    for (const id of ids) {
      expect(existsSync(`public/assets/portrait/${id}.webp`), `${id} runtime file`).toBe(true);
      expect(existsSync(`assets/source/portrait/${id}/${id}.png`), `${id} source`).toBe(true);
      expect(credits, `${id} CREDITS row`).toContain(`| \`${id}\` | portrait |`);
    }
  });
});
