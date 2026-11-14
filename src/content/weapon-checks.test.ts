import { describe, expect, it } from 'vitest';
import type { LoadedEntry } from './loader.ts';
import { compileMoves } from './types/move.ts';
import { describeContent } from './testing.ts';
import { loadGameContent } from './game-content.ts';
import { checkWeapons, hitboxExtent } from './weapon-checks.ts';

const content = loadGameContent();
const MOVES = compileMoves(content.all('move'));

describeContent(
  'item',
  'AC-5: a weapon declares a reach class and a moveset whose moves exist',
  (item) => {
    if (item.category !== 'weapon') return;
    expect(['close', 'short', 'medium', 'long']).toContain(item.weapon.reach);
    for (const { id } of item.weapon.moves) expect(MOVES.has(id)).toBe(true);
  },
);

describe('weapon reach checks (mw-e04.15)', () => {
  it('AC-5: the shipped weapons pass: every move fits its class and its weapon', () => {
    const entries = (['item', 'move', 'socket-track', 'reach-class'] as const).flatMap((type) =>
      content.all(type).map((value) => ({ type, file: `${type}/${value.id}.json`, value })),
    );
    expect(checkWeapons(entries as unknown as readonly LoadedEntry[])).toEqual([]);
    const reaches = Object.fromEntries(
      content.all('item').flatMap((i) => (i.category === 'weapon' ? [[i.id, i.weapon.reach]] : [])),
    );
    expect(reaches).toMatchObject({
      'arming-sword': 'medium',
      spear: 'long',
      halberd: 'long',
      mace: 'short',
      'hunting-knife': 'short',
    });
  });

  it('measures a hit volume at its widest on its track, radius included', () => {
    const spear = content.get('move', 'spear-thrust');
    const track = content.get('socket-track', 'spear-thrust-lunge');
    if (spear.hitbox === undefined) throw new Error('no hitbox');
    // 0.1 across, 2.4 + 0.5 along at the last key, and the 0.08 m radius.
    expect(hitboxExtent(spear.hitbox, track)).toBeCloseTo(Math.hypot(0.1, 2.9) + 0.08, 6);
    // A sphere and a box measure from their centres; a turned track keeps horizontal distance.
    const turn = { x: 0, y: 0.7071068, z: 0, w: 0.7071068 };
    const keys = [{ position: { x: 1, y: 0, z: 0 }, rotation: turn }];
    const sphere = { shape: { kind: 'sphere', center: { x: 0, y: 1, z: 1 }, radius: 0.5 } };
    expect(hitboxExtent(sphere as never, { keys })).toBeCloseTo(2.5, 5);
    const crate = {
      shape: { kind: 'box', center: { x: 0, y: 1, z: 1 }, halfExtents: { x: 0.3, y: 0.4, z: 0.5 } },
    };
    expect(hitboxExtent(crate as never, { keys })).toBeCloseTo(2 + Math.hypot(0.3, 0.4, 0.5), 5);
  });

  /** A table, a move, its track and a weapon holding it, as the loader would hand the check. */
  function entries(
    reach: string,
    weaponReach: string,
    to: number,
    rest: Partial<{ track: boolean; table: boolean }> = {},
  ) {
    const hitbox = {
      track: 'arc',
      shape: { kind: 'capsule', from: { x: 0, y: 1, z: 0 }, to: { x: 0, y: 1, z: to }, radius: 0 },
      reach,
      swing: 'thrust',
    };
    const all = [
      { type: 'move', file: 'move/m.json', value: { id: 'm', hitbox } },
      {
        type: 'item',
        file: 'item/w.json',
        value: {
          id: 'w',
          category: 'weapon',
          weapon: { reach: weaponReach, moves: [{ id: 'm' }, { id: 'missing' }] },
        },
      },
      { type: 'item', file: 'item/apple.json', value: { id: 'apple', category: 'consumable' } },
    ];
    if (rest.track !== false) {
      all.push({
        type: 'socket-track',
        file: 'socket-track/arc.json',
        value: {
          id: 'arc',
          keys: [{ position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } }],
        },
      } as never);
    }
    if (rest.table !== false) {
      all.push({
        type: 'reach-class',
        file: 'reach-class/r.json',
        value: { id: 'r', metres: { close: 0.6, short: 1.2, medium: 2, long: 3 } },
      } as never);
    }
    return all as unknown as readonly LoadedEntry[];
  }
  const messages = (list: readonly LoadedEntry[]) => checkWeapons(list).map((i) => i.message);

  it('a move that reaches past its class, or no farther than the class below, is reported', () => {
    expect(messages(entries('medium', 'medium', 1.5))).toEqual([]);
    expect(messages(entries('medium', 'medium', 2.5))).toEqual([
      'weapon "w": move "m" reaches 2.50 m, past its medium class\'s 2.00 m',
    ]);
    expect(messages(entries('long', 'long', 1.5))).toEqual([
      'weapon "w": move "m" reaches only 1.50 m, no farther than the medium class\'s 2.00 m: it is not long reach',
    ]);
    expect(messages(entries('close', 'close', 0.3))).toEqual([]);
  });

  it('a move may not out-reach its weapon', () => {
    expect(messages(entries('long', 'short', 2.5))).toEqual([
      'weapon "w": move "m" is long reach but the weapon is short',
    ]);
  });

  it('without a reach table, or a move’s track, there is nothing to hold it to', () => {
    expect(checkWeapons(entries('long', 'long', 9, { table: false }))).toEqual([]);
    expect(checkWeapons(entries('long', 'long', 9, { track: false }))).toEqual([]);
  });
});
