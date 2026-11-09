// mw-e09.5 AC-5: footstep noise with the real controller, locomotion, noise propagation, perception,
// awareness and the frozen fixture guard's behaviour, on the shipped stealth tuning and surface
// table. The guard stands 6 m from the player's line facing away from it, so only its ears work: a
// player creeping past on carpet is never noticed; the same path sprinting on gravel makes it
// Suspicious inside a second.
import {
  compileCreatures,
  compileSurfaceTable,
  STEALTH_ID,
  SURFACE_TABLE_ID,
} from '@content/index';
import type { ControllerTuning, Frozen } from '@content/index';
import { loadGameContent } from '@content/game-content';
import { loadFixtureContent } from '@content/test-fixtures';
import { markExercised } from '@content/testing';
import {
  AlertStateChanged,
  box,
  brainOf,
  buildFactionTable,
  buildSoundGraph,
  CharacterController,
  CharacterLocomotion,
  CharacterTuning,
  characterControllerSystem,
  compileBehaviours,
  createSurfaceMap,
  DEFAULT_FOOTSTEP_SURFACES,
  DEFAULT_STEALTH_TUNING,
  entitySource,
  factionSpecFromDef,
  FakeCollisionWorld,
  FakeSightWorld,
  giveLocomotion,
  installAi,
  installAwareness,
  installFactions,
  emitNoise,
  installFootstepNoise,
  isFriendlyToPlayer,
  joinFaction,
  installNoisePropagation,
  LineOfSight,
  locomotionSystem,
  movementProfileOf,
  noiseEmitted,
  perceptionSystem,
  perceptSourcePresent,
  registerCreatureComponents,
  SKIN,
  spawnCharacter,
  spawnCreature,
  surfaceAt,
  World,
  type CharacterInput,
  type FactionTable,
  type NoiseEvent,
} from '@sim/index';
import { describe, expect, it } from 'vitest';

const fixtures = loadFixtureContent();
const game = loadGameContent();
const stealth = game.get('stealth', STEALTH_ID);
const HZ = 60;
const CONTROLLER: Frozen<ControllerTuning> = {
  capsule: { radius: 0.35, height: 1.8, crouchHeight: 1.0 },
  speeds: { run: 5, sprint: 7.5, crouch: 2.2 },
  accelTime: 0.15,
  decelTime: 0.1,
  airControl: 0.3,
  gravity: 25,
  maxFallSpeed: 40,
  jumpApex: 1.2,
  coyoteMs: 120,
  jumpBufferMs: 150,
  stepHeight: 0.35,
  slopeLimit: 45,
  stealth: DEFAULT_STEALTH_TUNING,
};

const HELD = { pressed: false, held: true };
const OFF = { pressed: false, held: false };
const east = (button: 'sprint' | 'crouch' | 'slowWalk' | null): CharacterInput => ({
  actions: {
    move: { x: 1, y: 0 },
    jump: OFF,
    sprint: button === 'sprint' ? HELD : OFF,
    crouch: button === 'crouch' ? HELD : OFF,
    ...(button === 'slowWalk' && { slowWalk: HELD }),
  },
  cameraYaw: 0,
});

/** The player walks east along z = 6 from x = -3 for `seconds`; the guard at the origin faces -z. */
/** Who the player passes, how far off its line, and what it wears (the multiplier of its load class). */
interface Passing {
  readonly creature?: string;
  /** Use the shipped creatures and behaviours instead of the frozen fixtures'. */
  readonly shipped?: boolean;
  readonly z?: number;
  /** Which way the creature faces along z: -1 (away from the player, the default) or 1. */
  readonly facing?: number;
  readonly encumbrance?: number;
  /** Called before every tick, to make a noise or change a stance. */
  readonly each?: (
    world: World<CharacterInput>,
    tick: number,
    table: FactionTable,
    guard: number,
  ) => void;
}

function pass(
  surface: string,
  how: 'sprint' | 'crouch' | 'slowWalk' | null,
  seconds: number,
  who: Passing = {},
) {
  const source = who.shipped === true ? game : fixtures;
  const z = who.z ?? 6;
  const table = buildFactionTable(source.all('faction').map(factionSpecFromDef));
  const world = installFactions(
    registerCreatureComponents(new World<CharacterInput>({ seed: 5, hz: HZ })),
  );
  world.register(CharacterController, CharacterTuning, CharacterLocomotion);
  const surfaces = createSurfaceMap({
    table: compileSurfaceTable(game.get('surface-table', SURFACE_TABLE_ID)),
    regions: [
      {
        id: 'rug',
        min: { x: -50, y: -1, z: 0 },
        max: { x: 50, y: 1, z: 50 },
        surface: surface,
        priority: 1,
      },
    ],
  });
  const frame: CharacterInput = east(how);
  const floor = new FakeCollisionWorld([box({ x: -60, y: -1, z: -60 }, { x: 60, y: 0, z: 60 })]);
  const player = spawnCharacter(world, { x: -3, y: SKIN, z });
  world.add(player, CharacterTuning, CONTROLLER);
  giveLocomotion(world, player);
  world.addSystem(
    characterControllerSystem<CharacterInput>({
      collision: floor,
      tuning: CONTROLLER,
      input: () => frame,
    }),
  );
  world.addSystem(
    locomotionSystem<CharacterInput>({
      tuning: CONTROLLER,
      moving: () => true,
      surface: (entity) => {
        const state = world.get(entity, CharacterController);
        return state === undefined
          ? undefined
          : surfaceAt(surfaces, state.position, DEFAULT_FOOTSTEP_SURFACES);
      },
      noise: (entity) => movementProfileOf(world, entity, CONTROLLER)?.noise,
      encumbrance: () => who.encumbrance,
    }),
  );
  installNoisePropagation(world, {
    graph: buildSoundGraph({ rooms: [], portals: [] }),
    tuning: stealth.noise,
  });
  installFootstepNoise(world, { tuning: stealth.noise.footsteps });
  world.addSystem(
    perceptionSystem(world, {
      lineOfSight: new LineOfSight({ world: new FakeSightWorld() }),
      light: { levelAt: () => 1 },
      visibility: stealth.visibility,
      targets: () => [player],
      noticesMovement: (agent) => !isFriendlyToPlayer(world, table, agent),
    }),
  );
  installAi(world, { behaviours: compileBehaviours(source.all('behaviour')) });
  const playerSource = entitySource(player);
  installAwareness(world, {
    present: (s) => perceptSourcePresent(world, s),
    target: (s) => (s === playerSource ? player : undefined),
  });
  const spawned = spawnCreature(
    world,
    {
      creatures: compileCreatures(source.all('creature'), source),
      factions: table,
    },
    {
      creature: who.creature ?? 'fixture-guard',
      at: { x: 0, y: 0, z: 0 },
      facing: { x: 0, y: 0, z: who.facing ?? -1 },
    },
  );
  if (!spawned.ok) throw new Error('the guard did not spawn');
  const guard = spawned.entity;
  const noises: NoiseEvent[] = [];
  world.events.on(noiseEmitted, (n) => noises.push(n));
  const states: string[] = [];
  let suspiciousAt = -1;
  let suspiciousFrom = -1;
  world.events.on(AlertStateChanged, (c) => {
    states.push(`${c.from}>${c.to}`);
    if (c.to === 'suspicious' && suspiciousAt < 0) {
      suspiciousAt = c.tick;
      const at = world.get(player, CharacterController)?.position;
      suspiciousFrom = at === undefined ? -1 : Math.hypot(at.x, at.z);
    }
  });
  for (let i = 0; i < seconds * HZ; i++) {
    who.each?.(world, i, table, guard);
    world.step();
  }
  const brain = brainOf(world, guard);
  return {
    world,
    table,
    player,
    guard,
    state: brain?.state,
    states,
    noises,
    suspiciousAt,
    suspiciousFrom,
    awareness: brain?.awareness,
  };
}

describe('footstep noise wakes a guard by how you move (mw-e09.5)', () => {
  it('AC-5: sneaking past a guard 6 m away on carpet leaves it Unaware', ({ task }) => {
    markExercised(task, 'behaviour', 'fixture-guard');
    markExercised(task, 'creature', 'fixture-guard');
    markExercised(task, 'stealth', STEALTH_ID);
    markExercised(task, 'surface-table', SURFACE_TABLE_ID);
    for (const how of ['crouch', 'slowWalk'] as const) {
      const r = pass('carpet', how, 8);
      const steps = r.noises.filter((n) => n.kind === 'footstep' && n.entity === r.player);
      expect(steps.length).toBeGreaterThan(10);
      expect(new Set(steps.map((n) => Math.round(n.loudness)))).toEqual(new Set([15]));
      expect(r.states).toEqual([]);
      expect(r.state).toBe('unaware');
    }
  });

  it('AC-5: the same path sprinting on gravel makes it Suspicious within 1 s', () => {
    const r = pass('gravel', 'sprint', 3);
    const steps = r.noises.filter((n) => n.kind === 'footstep' && n.entity === r.player);
    expect(new Set(steps.map((n) => Math.round(n.loudness)))).toEqual(new Set([73]));
    expect(r.states[0]).toBe('unaware>suspicious');
    expect(r.suspiciousAt).toBeLessThanOrEqual(HZ);
  });
});

describe('friends of the player ignore its footsteps (mw-e09.5)', () => {
  const KNIGHT = 1.3;
  for (const creature of ['npc-garrick', 'npc-watchman-day']) {
    it(`${creature} never turns suspicious of a knight running or sprinting past`, ({ task }) => {
      markExercised(task, 'creature', creature);
      for (const how of [null, 'sprint'] as const) {
        const r = pass('stone', how, 6, { creature, shipped: true, z: 3, encumbrance: KNIGHT });
        expect(r.noises.filter((n) => n.entity === r.player).length).toBeGreaterThan(10);
        expect(r.states).toEqual([]);
        expect(r.state).toBe('unaware');
      }
    });
  }

  it('they still turn to a crash, and hear footsteps again once they stop being friends', () => {
    const crash = (world: World<CharacterInput>, tick: number): void => {
      if (tick === 30) {
        emitNoise(world, { position: { x: 3, y: 0, z: 0 }, loudness: 80, kind: 'break' });
      }
    };
    const heardCrash = pass('stone', 'crouch', 3, {
      creature: 'npc-garrick',
      shipped: true,
      each: crash,
    });
    expect(heardCrash.states[0]).toBe('unaware>suspicious');

    const turned = pass('stone', null, 4, {
      creature: 'npc-garrick',
      shipped: true,
      z: 3,
      each: (world, tick, table, guard) => {
        // His own regard for the knight turns (a theft he saw), not the whole town's.
        if (tick === 0) joinFaction(world, table, guard, 'townsfolk', { player: 'wary' });
      },
    });
    expect(turned.states[0]).toBe('unaware>suspicious');
  });
});
