// mw-e39.17: class-specific arrivals, first journal entries and signature beats. Narration lookups
// by player.class, the audit sheet against real content ids, and the lint warning for a missing variant.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { NARRATIVE_CLASSES } from '@content/narrative/class-variants';
import { markExercised } from '@content/testing';
import {
  CLASS_BEAT_IDS,
  classBeat,
  classesWithoutVariant,
  narrationSchema,
  newGameClassText,
  wordCount,
  type Narration,
} from '@content/types/narration';
import type { QuestDef } from '@content/types/quest';
import { glossary } from '@content/narrative/glossary';
import { lintNarrative, type LintEnv } from '../../src/tools/narrative-lint/lint';

const content = loadGameContent();
const narrations = content.all('narration') as readonly Narration[];
const beats = narrations.filter((n) => n.kind === 'class-beat');

describe('class beats', () => {
  it('AC-1: a new game of each class gets its own arrival text and first journal entry', ({
    task,
  }) => {
    const seen = new Set<string>();
    for (const c of NARRATIVE_CLASSES) {
      const start = newGameClassText(narrations, c);
      expect(start, c).toBeDefined();
      expect(start?.arrival.own, c).toBe(true);
      expect(start?.journal.own, c).toBe(true);
      const arrival = start?.arrival.pages.map((p) => p.text).join(' ') ?? '';
      seen.add(arrival);
      seen.add(start?.journal.pages.map((p) => p.text).join(' ') ?? '');
    }
    expect(seen.size).toBe(8);
    const text = (c: string) =>
      newGameClassText(narrations, c)
        ?.arrival.pages.map((p) => p.text)
        .join(' ');
    expect(text('knight')).toMatch(/Oath for Hire/);
    expect(text('archer')).toMatch(/Silent Wolves/);
    expect(text('sorcerer')).toMatch(/Letter from the Lamplit Stacks/);
    expect(text('thief')).toMatch(/Commission from the City/);
    expect(text('thief')).not.toMatch(/Mr\. S\b.*(Vane|buyer is)/);
    for (const c of NARRATIVE_CLASSES) markExercised(task, 'class', c);
    markExercised(task, 'narration', 'narration-class-beats');
  });

  it('AC-3: every class has its own text for every signature beat, and a beat has at most four variants', () => {
    expect(beats).toHaveLength(1);
    const ids = beats[0]?.sequences.map((s) => s.id);
    expect(ids).toEqual([...CLASS_BEAT_IDS]);
    expect(CLASS_BEAT_IDS.length).toBeGreaterThanOrEqual(4);
    for (const c of NARRATIVE_CLASSES) {
      const own = CLASS_BEAT_IDS.filter((id) => classBeat(narrations, id, c)?.own === true);
      expect(own, c).toEqual([...CLASS_BEAT_IDS]);
    }
    for (const id of CLASS_BEAT_IDS) {
      expect(classesWithoutVariant(narrations, id), id).toEqual([]);
      const texts = NARRATIVE_CLASSES.map((c) =>
        classBeat(narrations, id, c)
          ?.pages.map((p) => p.text)
          .join(' '),
      );
      expect(new Set(texts).size, `${id} variants are distinct`).toBe(4);
      const generic = classBeat(narrations, id, undefined)
        ?.pages.map((p) => p.text)
        .join(' ');
      expect(texts, id).not.toContain(generic);
    }
  });

  it('AC-4: a class with no variant gets the generic pages, and the lint warns', () => {
    const entry = (variants: object) => ({
      id: 'narration-test-beats',
      kind: 'class-beat',
      notes: 'Test.',
      sequences: [
        { id: 'arrival', pages: [{ text: 'Generic.' }], variants },
        { id: 'horn', pages: [{ text: 'Generic horn.' }], variants: { knight: [{ text: 'K.' }] } },
      ],
    });
    const parsed = narrationSchema.parse(
      entry({ knight: [{ text: 'K.' }], thief: [{ text: 'T.' }] }),
    );
    const found = classBeat([parsed], 'horn', 'archer');
    expect(found).toEqual({ pages: [{ text: 'Generic horn.' }], own: false });
    expect(classBeat([parsed], 'horn', 'knight')?.own).toBe(true);
    expect(classBeat([parsed], 'horn', undefined)?.own).toBe(false);
    expect(classBeat([parsed], 'nope', 'knight')).toBeUndefined();
    expect(newGameClassText([parsed], 'knight')).toBeUndefined();
    expect(classesWithoutVariant([parsed], 'horn')).toEqual(['archer', 'sorcerer', 'thief']);

    const path = 'src/content/data/narration/narration-test-beats.json';
    const env: LintEnv = {
      glossary,
      fact: () => true,
      npc: () => true,
      item: () => true,
      quest: () => true,
      scene: () => true,
    };
    const result = lintNarrative(
      [
        {
          path,
          text: JSON.stringify(entry({ knight: [{ text: 'K.' }], thief: [{ text: 'T.' }] })),
        },
      ],
      env,
    );
    const warnings = result.warnings.filter((w) => w.check === 'class-variants');
    expect(warnings.map((w) => w.message)).toEqual([
      'class beat has no variant for: archer, sorcerer (they see the generic text)',
      'class beat has no variant for: archer, sorcerer, thief (they see the generic text)',
    ]);
    expect(result.errors).toEqual([]);
  });

  it('a class beat needs variants, and variants belong to class beats only', () => {
    const base = { id: 'narration-x', notes: 'N.' };
    const seq = { id: 'a', pages: [{ text: 'G.' }] };
    const issues = (value: unknown) =>
      (narrationSchema.safeParse(value).error?.issues ?? []).map((i) => i.message);
    expect(issues({ ...base, kind: 'class-beat', sequences: [seq] })).toEqual([
      'a class beat has a variant for each class',
    ]);
    expect(
      issues({
        ...base,
        kind: 'barge',
        sequences: [{ ...seq, variants: { knight: [{ text: 'K.' }] } }],
      }),
    ).toEqual(['only a class beat has class variants']);
    expect(issues({ ...base, kind: 'class-beat', sequences: [{ ...seq, variants: {} }] })).toEqual([
      'needs at least one class',
    ]);
    const long = Array.from({ length: 91 }, () => 'w').join(' ');
    expect(
      issues({
        ...base,
        kind: 'class-beat',
        sequences: [{ ...seq, variants: { thief: [{ text: long }] } }],
      }),
    ).toEqual(['at most 90 words']);
    expect(wordCount(long)).toBe(91);
  });

  it('the first journal entry reads as an entry, and the thief commission stays unresolved', () => {
    for (const c of NARRATIVE_CLASSES) {
      const pages = classBeat(narrations, 'first-journal', c)?.pages ?? [];
      expect(pages).toHaveLength(1);
      expect(pages[0]?.text).toMatch(/^Briar Glen, dusk\./);
    }
    const all = JSON.stringify(beats);
    expect(all).not.toMatch(/Mr\. S\w/);
  });
});

describe('class beat audit sheet', () => {
  const audit = readFileSync('docs/narrative/class-beat-audit.md', 'utf8');
  const rows = audit
    .split('\n')
    .map((l) => /^\| (knight|archer|sorcerer|thief) \| (.+?) \| (.+) \|$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null);

  it('AC-2: every bible 4.3 class moment maps to an existing content id', () => {
    expect(rows.length).toBeGreaterThanOrEqual(28);
    for (const row of rows) {
      const [, cls = '', moment = '', cell = ''] = row;
      const ids = [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? '');
      expect(ids.length, `${cls}: ${moment}`).toBeGreaterThan(0);
      for (const id of ids) {
        const [kind, ref = ''] = id.split(':') as [string, string | undefined];
        if (kind === 'narration') {
          expect(classBeat(narrations, ref, cls)?.own, `${cls} ${id}`).toBe(true);
        } else if (kind === 'dialogue') {
          const [file = '', node = ''] = ref.split('/');
          const dialogue = content.all('dialogue').find((d) => d.id === file);
          expect(
            dialogue?.nodes.some((n) => n.id === node),
            `${cls} ${id}`,
          ).toBe(true);
        } else if (kind === 'objective') {
          const [quest = '', objective = ''] = ref.split('/');
          const def = content.get('quest', quest) as unknown as QuestDef;
          expect(
            def.objectives.some((o) => o.id === objective),
            `${cls} ${id}`,
          ).toBe(true);
        } else {
          expect(kind, `${cls} ${id}`).toBe('bead');
          expect(ref, id).toMatch(/^mw-[a-z0-9.]+$/);
        }
      }
    }
  });

  it('AC-2: each class has a row for every one of its signature beats', () => {
    for (const c of NARRATIVE_CLASSES) {
      const mine = rows.filter((r) => r[1] === c).join(' ');
      for (const id of ['arrival', 'mooring-watch', 'getting-in', 'wendmouth', 'horn', 'climax']) {
        expect(mine, `${c} ${id}`).toContain(`narration:${id}\``);
      }
    }
  });
});
