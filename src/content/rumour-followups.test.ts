// mw-e22.11: Dot trades each follow-up line back once after the player has visited the target. The
// line in her dialogue is the rumour's own `followUp` text, gated on the rumour facts the rumour
// book writes (src/game/rumours/rumours.ts), and the debunkers' dialogue emits `rumor.corrected`.
import { describe, expect, it } from 'vitest';
import { loadGameContent } from './game-content.ts';
import type { Rumor } from './types/rumor.ts';

const content = loadGameContent();
const rumours = content.all('rumor') as readonly Rumor[];
const withFollowUp = rumours.filter((r) => r.followUp !== undefined);
const dot = content.get('dialogue', 'dot-sleeping-ox');
const nodes = new Map(dot.nodes.map((n) => [n.id, n]));
const slug = (r: Rumor): string => r.id.slice(9);

describe('Dot follow-up lines', () => {
  it('AC-5: every rumour with a follow-up has a Dot line equal to its text', () => {
    expect(withFollowUp.length).toBeGreaterThan(0);
    for (const rumour of withFollowUp) {
      const node = nodes.get(`follow-${slug(rumour)}`);
      expect(node, rumour.id).toMatchObject({ kind: 'line', speaker: 'dot' });
      expect((node as { text: string }).text).toBe(rumour.followUp?.text);
    }
  });

  it('AC-5: each line is offered only once the rumour is investigated and not yet followed', () => {
    const choice = nodes.get('followup-choice') as unknown as {
      options: { id: string; when?: unknown }[];
    };
    for (const rumour of withFollowUp) {
      const option = choice.options.find((o) => o.id === `fu-${slug(rumour)}`);
      expect(JSON.stringify(option?.when), rumour.id).toBe(
        JSON.stringify({
          kind: 'all',
          of: [
            { kind: 'fact', fact: `entity:rumours/${rumour.id}.investigated` },
            {
              kind: 'not',
              condition: { kind: 'fact', fact: `entity:rumours/${rumour.id}.followed` },
            },
          ],
        }),
      );
    }
  });

  it('AC-5: the line sets followed and returns to the menu', () => {
    for (const rumour of withFollowUp) {
      expect(nodes.get(`follow-${slug(rumour)}-fx`), rumour.id).toMatchObject({
        kind: 'effect',
        effects: [{ kind: 'setFact', fact: `entity:rumours/${rumour.id}.followed`, value: true }],
        next: 'followup-choice',
      });
    }
  });

  it('AC-5: the hub offers the menu only while some line is pending', () => {
    const hub = nodes.get('hub') as unknown as {
      options: { id: string; when?: { kind: string; of: unknown[] } }[];
    };
    const option = hub.options.find((o) => o.id === 'ask-followup');
    expect(option?.when?.kind).toBe('any');
    expect(option?.when?.of).toHaveLength(withFollowUp.length);
  });
});

describe('debunkers', () => {
  const emitsCorrected = (id: string, rumor: number): boolean =>
    new RegExp(`"event": "rumor.corrected",\\s*"data": \\{\\s*"rumor": ${String(rumor)},`).test(
      JSON.stringify(content.get('dialogue', id), null, 2),
    );

  it('AC-4: every false rumour with an ask debunk has its debunker emit rumor.corrected', () => {
    expect(emitsCorrected('kettleback-kitchen', 3)).toBe(true);
    expect(emitsCorrected('mags-patient-ann', 18)).toBe(true);
    const asks = rumours.flatMap((r) =>
      (r.debunk ?? []).flatMap((d) => (d.via === 'ask' ? [`${r.id}:${d.npc}`] : [])),
    );
    expect(asks.sort()).toEqual(
      ['rumor-03-goblins-took-them:npc-kettleback', 'rumor-18-sea-serpent:npc-mags'].sort(),
    );
  });
});
