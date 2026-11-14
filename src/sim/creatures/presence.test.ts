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
import { beginConversing, endConversing } from '../ai/conversing';
import { PlacementComponent } from '../stimulus/placement';
import { errandOf } from '../ai/errand';
import { compileBehaviours } from '../ai/behaviour';
import { installAi } from '../ai/runtime';
import { hourNow, sceneExits, syncPresence } from './presence';
import { MINUTE_FACT } from '../rest/day-clock';
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

describe('presence by hour of the day (mw-e24.13)', () => {
  const SHIFT = { hours: [8, 18] } as const;
  const NIGHT_HOURS = { phases: ['night'], hours: [22, 4] } as const;

  it('AC-1: a scheduled spawn is there inside its window, [from, to), and wraps past midnight', () => {
    expect(presentIn(spawn({ presence: SHIFT }), undefined, 8)).toBe(true);
    expect(presentIn(spawn({ presence: SHIFT }), 'day', 17.99)).toBe(true);
    expect(presentIn(spawn({ presence: SHIFT }), 'day', 18)).toBe(false);
    expect(presentIn(spawn({ presence: SHIFT }), 'day', 7.5)).toBe(false);
    expect(presentIn(spawn({ presence: SHIFT }), 'day', 32)).toBe(true);
    expect(presentIn(spawn({ presence: SHIFT }), 'day', -10)).toBe(true);
    const late = spawn({ presence: { hours: [22, 4] } });
    expect(presentIn(late, 'night', 23)).toBe(true);
    expect(presentIn(late, 'night', 3)).toBe(true);
    expect(presentIn(late, 'night', 12)).toBe(false);
  });

  it('with both phases and hours both must hold; what the caller does not know is not checked', () => {
    const both = spawn({ presence: NIGHT_HOURS });
    expect(presentIn(both, 'night', 23)).toBe(true);
    expect(presentIn(both, 'day', 23)).toBe(false);
    expect(presentIn(both, 'night', 12)).toBe(false);
    expect(presentIn(both, 'night')).toBe(true);
    expect(presentIn(both, undefined, 23)).toBe(true);
    expect(presentIn(spawn({ presence: SHIFT }), 'day')).toBe(true);
    expect(presentIn(spawn({ presence: NIGHT }), 'night', 3)).toBe(true);
  });

  it('AC-2: a scene loads with the people who are scheduled to be there at the hour it loads', () => {
    const spawns = [
      spawn({ id: 'always', creature: 'hound' }),
      spawn({ id: 'clerk', creature: 'hound', presence: SHIFT }),
    ];
    const noon = world();
    expect(spawnSceneCreatures(noon, options, spawns, 'day', 12).entities).toHaveLength(2);
    const dark = world();
    expect(spawnSceneCreatures(dark, options, spawns, 'night', 23).entities).toHaveLength(1);
    const noClock = world();
    expect(spawnSceneCreatures(noClock, options, spawns).entities).toHaveLength(2);
  });

  it('AC-2: the clock minute is the hour of the day, and no clock is no hour', () => {
    const w = world();
    expect(hourNow(w)).toBeUndefined();
    w.facts.declare(MINUTE_FACT, { type: 'int', default: 360 });
    expect(hourNow(w)).toBe(6);
    w.facts.set(MINUTE_FACT, 1290);
    expect(hourNow(w)).toBe(21.5);
  });

  it('AC-1: the person arrives when their window opens and leaves when it closes', () => {
    const w = world();
    const spawns = [spawn({ id: 'clerk', creature: 'hound', presence: SHIFT })];
    expect(syncPresence(w, options, spawns, 'day', 7)).toEqual({
      arrived: [],
      left: [],
      errors: [],
    });
    expect(syncPresence(w, options, spawns, 'day', 8).arrived).toEqual(['clerk']);
    expect(syncPresence(w, options, spawns, 'day', 12).arrived).toEqual([]);
    expect(living(w)).toHaveLength(1);
    expect(syncPresence(w, options, spawns, 'dusk', 18).left).toEqual(['clerk']);
    expect(living(w)).toHaveLength(0);
  });

  it('AC-3: a person in a conversation when their window ends stays until it ends', () => {
    const w = world();
    const spawns = [spawn({ id: 'clerk', creature: 'hound', presence: SHIFT })];
    syncPresence(w, options, spawns, 'day', 12);
    const [clerk] = living(w);
    beginConversing(w, clerk as never, w.spawn());
    expect(syncPresence(w, options, spawns, 'dusk', 18)).toEqual({
      arrived: [],
      left: [],
      errors: [],
    });
    expect(living(w)).toHaveLength(1);
    w.destroy(clerk as never);
    expect(living(w)).toHaveLength(0);
  });

  it('AC-3: nobody arrives or leaves on the player’s screen; they do once it is out of view', () => {
    const w = world();
    const spawns = [spawn({ id: 'clerk', creature: 'hound', presence: SHIFT })];
    let seen = true;
    const hold = { inView: () => seen };
    expect(syncPresence(w, options, spawns, 'day', 9, hold).arrived).toEqual([]);
    expect(living(w)).toHaveLength(0);
    seen = false;
    expect(syncPresence(w, options, spawns, 'day', 9, hold).arrived).toEqual(['clerk']);
    seen = true;
    expect(syncPresence(w, options, spawns, 'dusk', 19, hold).left).toEqual([]);
    expect(living(w)).toHaveLength(1);
    seen = false;
    expect(syncPresence(w, options, spawns, 'dusk', 19, hold).left).toEqual(['clerk']);
    expect(living(w)).toHaveLength(0);
  });

  it('a person with no placement is not held by the view', () => {
    const w = world();
    const spawns = [spawn({ id: 'clerk', creature: 'hound', presence: SHIFT })];
    syncPresence(w, options, spawns, 'day', 9);
    const [clerk] = living(w);
    w.remove(clerk as never, PlacementComponent);
    expect(syncPresence(w, options, spawns, 'day', 19, { inView: () => true }).left).toEqual([
      'clerk',
    ]);
  });
});

describe('people walk to doors (mw-8551)', () => {
  const SHIFT = { hours: [8, 18] } as const;
  const clerk = (over: Partial<SceneSpawnPlacement> = {}) =>
    spawn({ id: 'clerk', creature: 'hound', presence: SHIFT, position: at, ...over });
  const WEST = { x: -20, y: 0, z: 2 };
  const EAST = { x: 30, y: 0, z: 2 };

  it('AC-3: exits are the doors, then authored exit markers, then the middles of the ways out', () => {
    const exits = sceneExits({
      spawns: [
        spawn({ id: 'marker' }),
        spawn({ id: 'exit-back', position: { x: 5, y: 0, z: 5 } }),
        spawn({
          id: 'front-door',
          position: { x: 1, y: 0, z: 1 },
          door: { profile: 'wood' },
        }),
        spawn({
          id: 'exit-door',
          door: { profile: 'x' },
        }),
      ],
      transitions: [
        {
          id: 'to-green',
          min: { x: 10, y: 1, z: 0 },
          max: { x: 14, y: 3, z: 6 },
          scene: 'g',
          spawn: 's',
          follow: false,
        },
      ],
    });
    expect(exits).toEqual([{ x: 1, y: 0, z: 1 }, at, { x: 5, y: 0, z: 5 }, { x: 12, y: 1, z: 3 }]);
  });

  it('AC-3: a leaver sets off for the nearest exit and stays in the world, even on screen', () => {
    const w = world();
    const spawns = [clerk()];
    syncPresence(w, options, spawns, 'day', 12);
    const [who] = living(w);
    const hold = { exits: [EAST, WEST, { x: -19, y: 0, z: 2 }], inView: () => true };
    expect(syncPresence(w, options, spawns, 'dusk', 18, hold)).toEqual({
      arrived: [],
      left: ['clerk'],
      errors: [],
    });
    expect(living(w)).toEqual([who]);
    expect(errandOf(w, who as never)).toEqual({ goal: { x: -19, y: 0, z: 2 }, leave: true });
    // It is not sent again while it walks.
    expect(syncPresence(w, options, spawns, 'dusk', 18.5, hold).left).toEqual([]);
  });

  it('AC-3: a leaver in a conversation is not sent, and one whose window reopens turns back', () => {
    const w = world();
    const spawns = [clerk()];
    syncPresence(w, options, spawns, 'day', 12);
    const [who] = living(w);
    const hold = { exits: [WEST] };
    beginConversing(w, who as never, w.spawn());
    expect(syncPresence(w, options, spawns, 'dusk', 18, hold).left).toEqual([]);
    expect(errandOf(w, who as never)).toBeUndefined();
    endConversing(w, who as never);
    syncPresence(w, options, spawns, 'dusk', 18, hold);
    expect(errandOf(w, who as never)?.leave).toBe(true);
    syncPresence(w, options, spawns, 'day', 9, hold);
    expect(errandOf(w, who as never)).toBeUndefined();
    expect(living(w)).toEqual([who]);
  });

  it('AC-3: when no exit can be reached, the leaver goes in place, held while on screen', () => {
    const w = world();
    installAi(w, {
      behaviours: compileBehaviours([]),
      navigation: { travel: () => 'failure', distance: () => Infinity },
    });
    const spawns = [clerk()];
    syncPresence(w, options, spawns, 'day', 12);
    expect(
      syncPresence(w, options, spawns, 'dusk', 18, { exits: [WEST], inView: () => true }).left,
    ).toEqual([]);
    expect(living(w)).toHaveLength(1);
    expect(syncPresence(w, options, spawns, 'dusk', 18, { exits: [WEST] }).left).toEqual(['clerk']);
    expect(living(w)).toHaveLength(0);
  });

  it('AC-3: the AI port decides which exit is nearest by the way there', () => {
    const w = world();
    installAi(w, {
      behaviours: compileBehaviours([]),
      navigation: { travel: () => 'running', distance: (_w, _e, goal) => (goal.x > 0 ? 1 : 99) },
    });
    const spawns = [clerk()];
    syncPresence(w, options, spawns, 'day', 12);
    const [who] = living(w);
    syncPresence(w, options, spawns, 'dusk', 18, { exits: [WEST, EAST] });
    expect(errandOf(w, who as never)?.goal).toEqual(EAST);
  });

  it('AC-3: an arrival is made at the nearest exit, walks to its spot, and waits while the exit is on screen', () => {
    const w = world();
    const spawns = [clerk()];
    let seen = true;
    const hold = { exits: [EAST, WEST], inView: () => seen };
    expect(syncPresence(w, options, spawns, 'day', 9, hold).arrived).toEqual([]);
    expect(living(w)).toHaveLength(0);
    seen = false;
    expect(syncPresence(w, options, spawns, 'day', 9, hold).arrived).toEqual(['clerk']);
    const [who] = living(w);
    expect(w.get(who as never, PlacementComponent)).toMatchObject({ x: -20, z: 2 });
    expect(errandOf(w, who as never)).toEqual({ goal: at, leave: false });
    expect(w.get(who as never, CreatureComponent)?.origin.at).toEqual(at);
  });

  it('AC-3: an arrival whose creature cannot be made reports it and makes no errand', () => {
    const w = world();
    const change = syncPresence(w, options, [clerk({ creature: 'wyvern' })], 'day', 9, {
      exits: [WEST],
    });
    expect(change.errors).toHaveLength(1);
    expect(change.arrived).toEqual([]);
  });
});
