// mw-18w, mw-ily9: where the Wendmouth harbour texts are placed and how the harbour rumours reach the player.
// Notes and inscriptions have no inventory item and no reader yet, so a placement is a marker spawn tagged
// `readable` plus the text's id, with a `read` affordance (the signpost's pattern); the reader and the
// evidence facts on reading are a follow-up bead.
import { describe, expect, it } from 'vitest';
import { loadGameContent } from './game-content.ts';
import type { Rumor } from './types/rumor.ts';

const content = loadGameContent();
const scene = content.get('scene', 'wendmouth-harbour');

/** Every emit effect of a dialogue, however deeply nested. */
function emits(node: unknown, found: { event: string; data: Record<string, unknown> }[] = []) {
  if (Array.isArray(node)) node.forEach((n) => emits(n, found));
  else if (typeof node === 'object' && node !== null) {
    const o = node as Record<string, unknown>;
    if (o['kind'] === 'emit')
      found.push({ event: String(o['event']), data: (o['data'] ?? {}) as never });
    Object.values(o).forEach((v) => emits(v, found));
  }
  return found;
}
const told = (npc: string) =>
  emits(content.get('dialogue', npc))
    .filter((e) => e.event === 'rumor.told')
    .map((e) => ({
      rumor: e.data['rumor'],
      source: e.data['source'],
      secondHand: e.data['secondHand'],
    }));

const TELLER_DIALOGUE: Record<string, string> = {
  'npc-nell': 'nell-drowned-gull',
  'npc-mags': 'mags-patient-ann',
  'npc-reed': 'reed-kestrel-lock',
};

const PLACED: Record<string, readonly string[]> = {
  'note-cargo-manifest': ['read-manifest-clerk-desk', 'read-manifest-crate-seal'],
  'note-cargo-manifest-quell-copy': ['read-manifest-quell-desk'],
  'note-foundry-invoice': ['read-foundry-invoice'],
  'note-sealed-letter-line': ['read-sealed-letter-line'],
  'note-lantern-court-notice': ['read-notice-stone-wharf', 'read-notice-customs-house'],
  'note-tidefair-board': ['read-tidefair-board'],
  'note-impound-ledger': ['read-impound-ledger'],
  'inscription-kestrel-lock-toll-board': ['toll-board'],
};

describe('mw-18w: harbour texts are placed in Wendmouth', () => {
  it('AC-1: every harbour text has its anchors, tagged readable with a read affordance', () => {
    for (const [text, anchors] of Object.entries(PLACED)) {
      const kind = text.split('-')[0] as 'note' | 'inscription';
      expect(content.get(kind, text).id).toBe(text);
      const tagged = scene.spawns.filter((s) => s.tags.includes(text));
      expect(tagged.map((s) => s.id).sort(), text).toEqual([...anchors].sort());
      for (const spawn of tagged) {
        expect(spawn.tags).toContain('readable');
        expect(spawn.interact?.affordances[0]?.verb).toBe('read');
      }
    }
  });

  it('AC-1: the anchors sit where the bead says (customs house, bay nine, wharf, Cray, Kestrel Lock)', () => {
    const at = (id: string) =>
      scene.spawns.find((s) => s.id === id)?.at as [number, number, number];
    const near = (id: string, to: string, metres: number) => {
      const [a, b] = [at(id), at(to)];
      expect(Math.hypot(a[0] - b[0], a[2] - b[2]), id).toBeLessThan(metres);
    };
    near('read-manifest-clerk-desk', 'customs-house', 6);
    near('read-notice-customs-house', 'customs-entry', 3);
    near('read-impound-ledger', 'npc-cray', 6);
    near('read-manifest-crate-seal', 'bay-nine-crate', 3);
    near('read-sealed-letter-line', 'bay-nine-crate', 3);
    near('read-manifest-quell-desk', 'manifest-desk', 3);
    near('read-foundry-invoice', 'manifest-desk', 3);
    near('read-notice-stone-wharf', 'stone-wharf', 12);
    near('read-tidefair-board', 'tidefair-flagstones', 8);
  });
});

describe('mw-18w: the harbour rumours are told in dialogue', () => {
  const rumours = content.all('rumor') as readonly Rumor[];
  const number = (r: Rumor) => Number(/^rumor-(\d+)-/.exec(r.id)?.[1]);

  it('AC-2: every first-hand source emits rumor.told for each rumour it tells', () => {
    for (const rumour of rumours) {
      for (const npc of rumour.source) {
        const dialogueId = TELLER_DIALOGUE[npc];
        expect(dialogueId, npc).toBeDefined();
        const heard = told(dialogueId ?? '').filter((t) => t.rumor === number(rumour));
        expect(heard, `${rumour.id} from ${npc}`).toEqual([
          { rumor: number(rumour), source: npc, secondHand: undefined },
        ]);
      }
    }
  });

  it('AC-3: Dot repeats each harbour rumour second-hand, only before the player has been to Wendmouth', () => {
    const dot = content.get('dialogue', 'dot-sleeping-ox');
    const heard = told('dot-sleeping-ox').filter((t) => t.secondHand === true);
    expect(heard.map((t) => t.rumor)).toEqual(rumours.map(number));
    const option = dot.nodes
      .flatMap((n) => ('options' in n ? n.options : []))
      .find((o) => o.id === 'harbour-news');
    expect(option?.when).toEqual({
      kind: 'not',
      condition: { kind: 'fact', fact: 'wendmouth.visited' },
    });
    for (const rumour of rumours) {
      const line = dot.nodes.find(
        (n) => 'text' in n && n.text === rumour.secondHand?.text && n.speaker === 'dot',
      );
      expect(line, rumour.id).toBeDefined();
    }
  });
});
