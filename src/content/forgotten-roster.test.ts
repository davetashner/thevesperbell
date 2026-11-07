// mw-ju8.19 AC-1: the Forgotten roster beside the miner - the archer, the shield-bearer and the brute
// (src/content/data/creature/forgotten-*.json). Each is a valid CreatureDef following the miner,
// every attack and move it performs passes the creature readability rule, and its loot lies inside
// the economy bands of its tier (docs/design/economy.md: tier 1 1-4 gold, tier 2 3-8, tier 3 8-20,
// gear base values 20-60 at tier 2 and 40-120 at tier 3, scrap 5-15 at tier 1). The fights are
// tests/integration/forgotten-roster.test.ts; the seeded yields tests/integration/forgotten-drops.test.ts.

import { describe, expect, it } from 'vitest';
import { CREATURE_MIN_WINDUP_TICKS } from './attack-checks.ts';
import { loadGameContent } from './game-content.ts';
import { markExercised } from './testing.ts';
import { compileAttack } from './types/attack.ts';
import { compileCreature, creatureSchema } from './types/creature.ts';
import { compileMoves } from './types/move.ts';

const content = loadGameContent();
const FILES = import.meta.glob<Record<string, unknown>>('./data/creature/forgotten-*.json', {
  eager: true,
  import: 'default',
});
const moves = compileMoves(content.all('move'));

interface Band {
  readonly min: number;
  readonly max: number;
}
interface Variant {
  readonly id: string;
  readonly tier: 1 | 2 | 3;
  readonly attacks: readonly string[];
  readonly gold: Band;
  /** Item values of the gear and scrap tables (anything outside is listed in `rare`). */
  readonly gear: Band;
  readonly health: Band;
}

const VARIANTS: readonly Variant[] = [
  {
    id: 'forgotten-miner',
    tier: 1,
    attacks: ['forgotten-overhead-chop', 'forgotten-two-hit-slash', 'forgotten-lunging-thrust'],
    gold: { min: 1, max: 4 },
    gear: { min: 5, max: 15 },
    health: { min: 100, max: 100 },
  },
  {
    id: 'forgotten-archer',
    tier: 2,
    attacks: ['forgotten-archer-shot', 'forgotten-archer-shove'],
    gold: { min: 3, max: 8 },
    gear: { min: 20, max: 60 },
    health: { min: 50, max: 90 },
  },
  {
    id: 'forgotten-shield-bearer',
    tier: 2,
    attacks: ['forgotten-shield-bash', 'forgotten-shield-counter'],
    gold: { min: 3, max: 8 },
    gear: { min: 20, max: 60 },
    health: { min: 80, max: 130 },
  },
  {
    id: 'forgotten-brute',
    tier: 3,
    attacks: ['forgotten-brute-overhead', 'forgotten-brute-sweep'],
    gold: { min: 8, max: 20 },
    gear: { min: 40, max: 120 },
    health: { min: 180, max: 300 },
  },
];

/** Catalogue pieces over their tier's gear band, allowed at most this share of a table's weight. */
const RARE: Readonly<Record<string, number>> = { 'kite-shield': 0.05, 'kettle-helm': 0.05 };

describe('the Forgotten roster’s data (mw-ju8.19)', () => {
  for (const variant of VARIANTS) {
    const { id } = variant;
    const def = () => content.get('creature', id);

    it(`AC-1: ${id} passes CreatureDef as a Forgotten walker like the miner`, ({ task }) => {
      markExercised(task, 'creature', id);
      // The file as written, less the editor's `$schema` hint (the loader drops it too).
      const file = FILES[`./data/creature/${id}.json`] ?? expect.fail(`no file for ${id}`);
      const parsed = creatureSchema.safeParse(
        Object.fromEntries(Object.entries(file).filter(([key]) => key !== '$schema')),
      );
      expect(parsed.error).toBeUndefined();
      expect(def()).toMatchObject({ id, family: 'forgotten' });
      expect(def().presentation).toEqual({ mesh: 'placeholder-capsule-bones', sfx: 'placeholder' });
      expect(def().resistances).toMatchObject({ pierce: 0.5, poison: 0 });
      const creature = compileCreature(def(), content);
      expect(creature.senses.sight).toBeDefined();
      expect(creature.senses.hearing).toBeDefined();
      expect(creature.senses.special).toEqual({}); // quiet players are ignored, as the miner does
      expect(creature.gaits.walk).toBeGreaterThan(0);
      const health = def().stats.health;
      expect(health).toBeGreaterThanOrEqual(variant.health.min);
      expect(health).toBeLessThanOrEqual(variant.health.max);
      expect(content.has('behaviour', def().behaviour.profile)).toBe(true);
      expect(def().attacks.map((a) => a.id)).toEqual(variant.attacks);
    });

    it(`AC-1: every move ${id} performs winds up at least 300 ms from its telegraph (the readability rule)`, ({
      task,
    }) => {
      markExercised(task, 'creature', id);
      for (const ref of def().attacks) {
        markExercised(task, 'attack', ref.id);
        const attack = compileAttack(content.get('attack', ref.id), moves);
        for (const move of attack.chain ?? [attack.move]) {
          markExercised(task, 'move', move.id);
          expect(move.startup - move.telegraphTick).toBeGreaterThanOrEqual(
            CREATURE_MIN_WINDUP_TICKS,
          );
        }
      }
    });

    it(`AC-1: ${id}'s loot table rolls its tier ${String(variant.tier)} coins and gear inside the economy bands`, () => {
      const table = def().loot;
      expect(table).toBe(`${id}-drops`);
      const coins = content.get('loot-table', `${id}-coins`);
      // One pile of exactly the tier's gold band.
      expect(coins.entries.map((e) => [e.item?.id, e.count])).toEqual([['gold', variant.gold]]);
      expect(content.get('loot-table', `${id}-drops`).entries.map((e) => e.table?.id)).toContain(
        `${id}-coins`,
      );
    });
  }

  it('AC-1: the gear tables hold only items inside their tier’s base-value band, bar the rare catalogue pieces', () => {
    for (const variant of VARIANTS) {
      for (const tableId of [`${variant.id}-gear`, `${variant.id}-scrap`]) {
        if (!content.has('loot-table', tableId)) continue;
        const table = content.get('loot-table', tableId);
        const total = table.entries.reduce((sum, e) => sum + e.weight, 0);
        for (const entry of table.entries) {
          const item = entry.item?.id;
          if (item === undefined || item === 'gold') continue; // gold at count 0 is "nothing"
          const value = content.get('item', item).value;
          const rare = RARE[item];
          if (rare !== undefined) {
            expect(entry.weight / total, item).toBeLessThanOrEqual(rare);
          } else {
            expect(value, `${tableId}: ${item}`).toBeGreaterThanOrEqual(variant.gear.min);
            expect(value, `${tableId}: ${item}`).toBeLessThanOrEqual(variant.gear.max);
          }
        }
      }
    }
  });

  it('AC-1: the archer’s shot is a projectile attack and the others are melee', () => {
    const shot = compileAttack(content.get('attack', 'forgotten-archer-shot'), moves);
    expect(shot.kind).toBe('projectile');
    expect(shot.projectile).toMatchObject({ speed: 14, maxRange: 16 });
    expect(shot.rangeMin).toBeGreaterThanOrEqual(4);
    for (const id of VARIANTS.flatMap((v) => v.attacks).filter(
      (a) => a !== 'forgotten-archer-shot',
    )) {
      expect(content.get('attack', id).kind).toBe('melee');
    }
  });

  it('AC-1: the shield-bearer carries a shieldless-style guard the knight’s bash breaks; nobody else has one', ({
    task,
  }) => {
    markExercised(task, 'shield', 'forgotten-board-shield');
    expect(content.get('creature', 'forgotten-shield-bearer').shield?.id).toBe(
      'forgotten-board-shield',
    );
    expect(content.get('shield', 'forgotten-board-shield')).toMatchObject({
      kind: 'weapon',
      arcDegrees: 110,
    });
    for (const id of ['forgotten-miner', 'forgotten-archer', 'forgotten-brute']) {
      expect(content.get('creature', id).shield).toBeUndefined();
    }
  });

  it('AC-4: the brute’s swings are slower to wind up and to recover than anything the miner does', () => {
    const swing = (id: string) => moves.get(id) ?? expect.fail(id);
    const slowest = Math.max(
      ...['forgotten-overhead-chop', 'forgotten-slash-1', 'forgotten-lunging-thrust'].map(
        (m) => swing(m).startup,
      ),
    );
    for (const id of ['forgotten-brute-overhead', 'forgotten-brute-sweep']) {
      expect(swing(id).startup).toBeGreaterThan(slowest);
      expect(swing(id).recovery).toBeGreaterThanOrEqual(
        swing('forgotten-overhead-chop').recovery * 2,
      );
    }
    expect(swing('forgotten-shield-counter').startup).toBeGreaterThanOrEqual(36); // slow counter-swing
    expect(swing('forgotten-archer-shot').startup).toBeGreaterThanOrEqual(36); // a visible draw
  });

  it('mw-ju8.25 AC-1: the brute’s overhead and sweep are bespoke clips that hit within one tick of the move’s first active tick', () => {
    for (const id of ['forgotten-brute-overhead', 'forgotten-brute-sweep']) {
      const move = content.get('move', id);
      const clip = content.get('anim-clip', move.presentation.anim);
      expect(clip.id).toBe(`anim-${id}`);
      expect(clip.notes).not.toMatch(/placeholder|retimed/i);
      const hits = clip.markers.filter((m) => m.kind === 'hit');
      expect(hits, id).toHaveLength(1);
      expect(Math.abs((hits[0]?.t ?? NaN) * 60 - move.frames.startup), id).toBeLessThanOrEqual(1);
      // The clip spans the whole move, and is keyed on the legs as well as the arms (a stance, not a retimed arm swing).
      const ticks = move.frames.startup + move.frames.active + move.frames.recovery;
      expect(clip.duration * 60, id).toBeCloseTo(ticks, 0);
      for (const bone of ['spine', 'chest', 'upper-arm-r', 'upper-arm-l', 'thigh-r', 'shin-l']) {
        expect(Object.keys(clip.tracks), id).toContain(bone);
      }
    }
  });

  it('mw-ju8.25 AC-1: the overhead lifts above the head, holds at the top, then slams down and stays down through the recovery', () => {
    const clip = content.get('anim-clip', 'anim-forgotten-brute-overhead');
    const arm = clip.tracks['upper-arm-r'] ?? expect.fail('no right arm track');
    const hit = clip.markers.find((m) => m.kind === 'hit')?.t ?? NaN;
    const top = Math.max(...arm.map((k) => k.rot[0]));
    expect(top).toBeGreaterThan(150); // past vertical
    const held = arm.filter((k) => k.rot[0] >= top - 15 && k.t < hit);
    const hold = Math.max(...held.map((k) => k.t)) - Math.min(...held.map((k) => k.t));
    expect(hold).toBeGreaterThanOrEqual(0.15); // a visible pause at the top
    expect(Math.min(...held.map((k) => k.t))).toBeGreaterThanOrEqual(0.5); // after a long lift
    const slam = arm.find((k) => k.t === hit);
    expect(slam?.rot[0]).toBeLessThan(90);
    const after = arm.filter((k) => k.t > hit && k.t <= hit + 0.3);
    expect(after.length).toBeGreaterThan(0);
    for (const k of after) expect(k.rot[0]).toBeLessThan(90); // still down on the maul
  });

  it('mw-ju8.25 AC-1: the sweep winds far round to the right and finishes far round to the left', () => {
    const clip = content.get('anim-clip', 'anim-forgotten-brute-sweep');
    const chest = clip.tracks['chest'] ?? expect.fail('no chest track');
    expect(Math.min(...chest.map((k) => k.rot[1]))).toBeLessThanOrEqual(-50);
    expect(Math.max(...chest.map((k) => k.rot[1]))).toBeGreaterThanOrEqual(50);
  });
});
