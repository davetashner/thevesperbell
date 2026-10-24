// Presence by phase of the day (mw-ju8.14): a spawn's `presence` decides whether its creature is
// spawned and its interaction is on, for the phase the scene loads in and as the phase changes.
import type { CreatureTable, RuntimeCreature } from '@content/index';
import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { installFactions } from '../factions/runtime';
import { buildFactionTable, UNALIGNED_FACTION } from '../factions/table';
import { InteractableComponent, INTERACTION_COMPONENTS } from '../interaction/system';
import type { SceneSpawnPlacement } from '../scene/layout';
import { SceneSpawnComponent } from '../scene/loader';
import { CreatureComponent } from './components';
import { syncPresence } from './presence';
import {
  presentIn,
  registerCreatureComponents,
  spawnSceneCreatures,
  type CreatureSpawnOptions,
} from './spawn';

type Def = RuntimeCreature['def'];

/** A grey-box creature as compileCreature would give it (only the fields spawning reads). */
function creature(
  id: string,
  overrides: Partial<Record<keyof Def, unknown>> = {},
): RuntimeCreature {
  const def = {
    id,
    stats: { health: 60, poise: 20, mass: 35, size: 'small' },
    attacks: [],
    resistances: { fire: 1.5 },
    poiseRegen: { delayTicks: 120, percentPerSecond: 25 },
    reactions: { knockbackImpulse: 300, knockdownImpulse: 900, launchSpeed: 2, replace: {} },
    disposition: {},
    behaviour: { profile: `${id}-profile`, tuning: { patience: 3 } },
    needs: {
      sleep: { ratePerMinute: 1, threshold: 80 },
      hunger: { ratePerMinute: 2, threshold: 50 },
    },
    ...overrides,
  } as unknown as Def;
  return Object.freeze({
    id,
    def,
    senses: Object.freeze({ sight: { range: 20 } }) as unknown as RuntimeCreature['senses'],
    nav: Object.freeze({ mask: 1, radius: 0.4, height: 0.9 }) as unknown as RuntimeCreature['nav'],
    gaits: Object.freeze({ sneak: 1, walk: 1.5, run: 4 }),
  });
}

const hound = creature('hound');

const creatures: CreatureTable = new Map([[hound.id, hound]]);

const factions = buildFactionTable([
  {
    id: UNALIGNED_FACTION,
    towardPlayer: 'hostile',
    towardMembers: 'neutral',
    towardOthers: 'neutral',
    relations: [],
  },
]);

const options: CreatureSpawnOptions = { creatures, factions };

function world() {
  const w = installFactions(registerCreatureComponents(new World<unknown>({ seed: 7 })));
  w.register(...INTERACTION_COMPONENTS, SceneSpawnComponent);
  return w as unknown as World<never>;
}

const at = { x: 1, y: 0, z: 2 };
const spawn = (over: Partial<SceneSpawnPlacement>): SceneSpawnPlacement => ({
  id: 'marker',
  position: at,
  yaw: 0,
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  prop: undefined,
  tags: [],
  ...over,
});
const NIGHT = { phases: ['dusk', 'night'] } as const;
const living = (w: World<never>) => [...w.query(CreatureComponent).ids()];

describe('presence by phase (mw-ju8.14)', () => {
  it('a spawn with no presence is always there; one with presence is there in its phases only', () => {
    expect(presentIn(spawn({}), 'day')).toBe(true);
    expect(presentIn(spawn({ presence: NIGHT }), 'night')).toBe(true);
    expect(presentIn(spawn({ presence: NIGHT }), 'day')).toBe(false);
  });

  it('AC-1: the scene spawns a night creature at night and not by day', () => {
    const spawns = [
      spawn({ id: 'always', creature: 'hound' }),
      spawn({ id: 'sorcerer', creature: 'hound', presence: NIGHT }),
    ];
    const byDay = world();
    expect(spawnSceneCreatures(byDay, options, spawns, 'day').entities).toHaveLength(1);
    const byNight = world();
    expect(spawnSceneCreatures(byNight, options, spawns, 'night').entities).toHaveLength(2);
    const noClock = world();
    expect(spawnSceneCreatures(noClock, options, spawns).entities).toHaveLength(2);
  });

  it('AC-1: the creature arrives at dusk and leaves at dawn, once, and the always-there one stays', () => {
    const w = world();
    const spawns = [
      spawn({ id: 'always', creature: 'hound' }),
      spawn({ id: 'sorcerer', creature: 'hound', presence: NIGHT }),
      spawn({ id: 'marker' }),
    ];
    spawnSceneCreatures(w, options, spawns, 'day');
    expect(living(w)).toHaveLength(1);
    expect(syncPresence(w, options, spawns, 'day')).toEqual({ arrived: [], left: [], errors: [] });
    expect(syncPresence(w, options, spawns, 'dusk')).toEqual({
      arrived: ['sorcerer'],
      left: [],
      errors: [],
    });
    expect(living(w)).toHaveLength(2);
    expect(syncPresence(w, options, spawns, 'night').arrived).toEqual([]);
    expect(living(w)).toHaveLength(2);
    expect(syncPresence(w, options, spawns, 'dawn')).toEqual({
      arrived: [],
      left: ['sorcerer'],
      errors: [],
    });
    expect(living(w)).toHaveLength(1);
    expect(w.get(living(w)[0] as never, CreatureComponent)?.origin.point).toBe('always');
  });

  it('reports a spawn that fails and keeps going', () => {
    const w = world();
    const spawns = [spawn({ id: 'ghost', creature: 'wyvern', presence: NIGHT })];
    const change = syncPresence(w, options, spawns, 'night');
    expect(change.errors).toEqual([
      { point: 'ghost', error: { kind: 'unknown-creature', creature: 'wyvern' } },
    ]);
  });

  it('does nothing about creatures in a world without creatures installed', () => {
    const bare = new World<unknown>({ seed: 1 }) as unknown as World<never>;
    const spawns = [spawn({ id: 'sorcerer', creature: 'hound', presence: NIGHT })];
    expect(syncPresence(bare, options, spawns, 'night')).toEqual({
      arrived: [],
      left: [],
      errors: [],
    });
  });

  it('AC-1: the lesson table answers at night only: its interaction is switched with the phase', () => {
    const w = world();
    const table = w.spawn();
    w.add(table, SceneSpawnComponent, { id: 'lessons', tags: [] });
    const other = w.spawn();
    w.add(other, SceneSpawnComponent, { id: 'elsewhere', tags: [] });
    const interact = { affordances: [{ verb: 'talk' as const }] };
    const spawns = [spawn({ id: 'lessons', interact, presence: NIGHT })];
    // The scene loader makes it interactable at load (any phase).
    syncPresence(w, options, spawns, 'night');
    expect(w.has(table, InteractableComponent)).toBe(true);
    expect(w.has(other, InteractableComponent)).toBe(false);
    expect(syncPresence(w, options, spawns, 'day')).toMatchObject({ left: ['lessons'] });
    expect(w.has(table, InteractableComponent)).toBe(false);
    expect(syncPresence(w, options, spawns, 'day').left).toEqual([]);
    expect(syncPresence(w, options, spawns, 'dusk')).toMatchObject({ arrived: ['lessons'] });
    expect(w.has(table, InteractableComponent)).toBe(true);
    expect(syncPresence(w, options, spawns, 'night').arrived).toEqual([]);
  });

  it('leaves an interaction alone in a world without interaction installed', () => {
    const w = installFactions(
      registerCreatureComponents(new World<unknown>({ seed: 7 })),
    ) as unknown as World<never>;
    const interact = { affordances: [{ verb: 'talk' as const }] };
    expect(
      syncPresence(w, options, [spawn({ id: 'lessons', interact, presence: NIGHT })], 'day'),
    ).toEqual({ arrived: [], left: [], errors: [] });
  });
});
