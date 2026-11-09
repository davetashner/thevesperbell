// Surface-aware footsteps (mw-e28.6): the footsteps cue sheet on the sim's locomotion events, with
// the surface read from the material of the collider the character stands on.

import { describe, expect, it, vi } from 'vitest';
import type { PlayOptions } from '@audio/index';
import { loadGameContent, PLAYER_CONTROLLER_ID, type ControllerTuning } from '@content/index';
import {
  addProperties,
  box,
  CharacterController,
  characterControllerSystem,
  CharacterLocomotion,
  FakeCollisionWorld,
  giveLocomotion,
  LocomotionEvents,
  locomotionSystem,
  GuardComponent,
  PhysicsColliderComponent,
  PhysicsObjectComponent,
  registerWorldProperties,
  spawnCharacter,
  World,
  type CharacterInput,
  type EntityId,
  type GreyboxShape,
} from '@sim/index';
import { AudioCueBridge, DEFAULT_FOOTSTEP_SURFACE, worldCueLookups } from './audio-bridge.ts';
import type { CueLookups } from './events.ts';

const content = loadGameContent();
const footsteps = content.get('cue-sheet', 'footsteps');
const tuning = content.get('controller', PLAYER_CONTROLLER_ID) as ControllerTuning;

interface Played {
  readonly cue: string;
  readonly options: PlayOptions;
}

/** The footsteps sheet on a bridge; `handle` feeds it readings directly. */
function bridgeWith(lookups: CueLookups) {
  const played: Played[] = [];
  let now = 0;
  const bridge = new AudioCueBridge({
    sheets: [footsteps],
    player: { play: (cue, options) => played.push({ cue, options }) },
    now: () => (now += 1000),
    lookups,
  });
  return { bridge, played };
}

const walkInput = (magnitude: number, crouch = false): CharacterInput => ({
  actions: {
    move: { x: 0, y: magnitude },
    jump: { pressed: false, held: false },
    sprint: { pressed: false, held: false },
    crouch: { pressed: false, held: crouch },
  },
  cameraYaw: 0,
});

/**
 * A walking character on the player's controller tuning over `floors` (fake collider ids are 1, 2…
 * in order), each bound to an entity of the given material, with the footsteps sheet attached.
 */
function walkingWorld(floors: readonly { shape: GreyboxShape; material: string }[]) {
  const collision = new FakeCollisionWorld(floors.map((f) => f.shape));
  const world = registerWorldProperties(new World<CharacterInput>({ seed: 1 })).register(
    CharacterController,
    CharacterLocomotion,
    PhysicsColliderComponent,
  );
  world.addSystem(
    characterControllerSystem<CharacterInput>({
      collision,
      tuning,
      input: (inputs) => inputs[0],
    }),
  );
  world.addSystem(
    locomotionSystem<CharacterInput>({
      tuning,
      moving: (inputs) => (inputs[0]?.actions.move.y ?? 0) !== 0,
      facing: () => 0,
    }),
  );
  floors.forEach(({ material }, index) => {
    const floor = world.spawn();
    addProperties(world, floor, { material });
    world.add(floor, PhysicsColliderComponent, { colliders: [index + 1] });
  });
  const player = spawnCharacter(world, { x: 0, y: 0.01, z: 0 });
  giveLocomotion(world, player);
  const warn = vi.fn<(message: string) => void>();
  const played: Played[] = [];
  const bridge = new AudioCueBridge({
    sheets: [footsteps],
    player: { play: (cue, options) => played.push({ cue, options }) },
    now: () => world.tick * 1000,
    lookups: worldCueLookups(world, content.all('material'), { warn }),
  });
  bridge.attach(world.events);
  // Forward input at camera yaw 0 walks towards -z: distance walked is -z.
  const walked = () => -(world.get(player, CharacterController)?.position.z ?? Number.NaN);
  return { world, player, played, walked };
}

describe('surface-aware footsteps (mw-e28.6)', () => {
  it('AC-1: walking from stone onto wood, the next foot plant plays a wood footstep', () => {
    // Stone for the first 2 m walked, wood after.
    const { world, played, walked } = walkingWorld([
      { shape: box({ x: -50, y: -1, z: -2 }, { x: 50, y: 0, z: 50 }), material: 'stone' },
      { shape: box({ x: -50, y: -1, z: -50 }, { x: 50, y: 0, z: -2 }), material: 'wood' },
    ]);
    world.step([]);
    const cues: { cue: string; z: number }[] = [];
    for (let i = 0; i < 150; i++) {
      const before = played.length;
      world.step([walkInput(0.4)]);
      for (const p of played.slice(before)) cues.push({ cue: p.cue, z: walked() });
    }
    expect(walked()).toBeGreaterThan(3);
    const onStone = cues.filter((c) => c.z < 1.9);
    const onWood = cues.filter((c) => c.z > 2.1);
    expect(onStone.length).toBeGreaterThan(0);
    expect(onWood.length).toBeGreaterThan(0);
    expect(new Set(onStone.map((c) => c.cue))).toEqual(new Set(['sfx-foot-stone-walk']));
    expect(new Set(onWood.map((c) => c.cue))).toEqual(new Set(['sfx-foot-wood-walk']));
  });

  it('AC-3: without animation foot plants (stride fallback), walking 3.5 m plays exactly 5 footsteps', () => {
    const { world, played, walked } = walkingWorld([
      { shape: box({ x: -50, y: -1, z: -50 }, { x: 50, y: 0, z: 50 }), material: 'stone' },
    ]);
    world.step([]);
    const start = walked();
    // Walk (below the run threshold), letting go early enough that the stop lands at 3.5 m.
    for (let i = 0; i < 600 && walked() - start < 3.5 - 0.1; i++) world.step([walkInput(0.4)]);
    for (let i = 0; i < 30; i++) world.step([]);
    expect(Math.abs(walked() - start - 3.5)).toBeLessThan(0.3);
    expect(played.map((p) => p.cue)).toEqual(Array(5).fill('sfx-foot-stone-walk'));
  });

  it('AC-2: a crouched footstep resolves 10 dB below the standing one; sprint is 3 dB above the run', () => {
    const { bridge } = bridgeWith({ materialOf: () => undefined, impactClassOf: () => undefined });
    const step = (gait: string) =>
      bridge.handle('LocomotionEvents', {
        anchors: { entity: { entity: 1 } },
        facts: { kind: 'footstep', foot: 'left', gait, surface: 'stone' },
      })[0];
    const rule = (gait: string) =>
      footsteps.rules.find((r) => r.match['gait'] === gait && r.match['kind'] === 'footstep');
    const standing = footsteps.rules.find(
      (r) => r.layer === 'step' && Object.keys(r.match).join() === 'kind',
    );
    expect((rule('crouch')?.volumeDb ?? 0) - (standing?.volumeDb ?? 0)).toBe(-10);
    expect((rule('sprint')?.volumeDb ?? 0) - (rule('run')?.volumeDb ?? 0)).toBe(3);
    const walk = step('walk');
    const crouch = step('crouch');
    expect(walk?.cue).toBe('sfx-foot-stone-walk');
    expect(crouch?.cue).toBe('sfx-foot-stone-walk');
    // Volume jitter is ±1 dB on each, so the resolved gap is 10 ± 2 dB.
    const gapDb = 20 * Math.log10((walk?.options.volume ?? 1) / (crouch?.options.volume ?? 1));
    expect(gapDb).toBeGreaterThanOrEqual(8);
    expect(gapDb).toBeLessThanOrEqual(12);
    expect(step('run')?.cue).toBe('sfx-foot-stone-run');
    expect(step('sprint')?.cue).toBe('sfx-foot-stone-run');
  });

  it('AC-4: an unknown surface plays the stone set and a dev warning names it once', () => {
    const world = registerWorldProperties(new World({ seed: 1 })).register(
      CharacterController,
      PhysicsColliderComponent,
    );
    const floor = world.spawn();
    addProperties(world, floor, { material: 'iron' }); // no footstepSurface: no set yet
    world.add(floor, PhysicsColliderComponent, { colliders: [7] });
    const player = spawnCharacter(world, { x: 0, y: 0, z: 0 });
    const state = world.get(player, CharacterController);
    if (state === undefined) throw new Error('no controller');
    world.add(player, CharacterController, { ...state, groundBody: 7 });
    const warn = vi.fn<(message: string) => void>();
    const lookups = worldCueLookups(world, content.all('material'), { warn });
    const { bridge, played } = bridgeWith(lookups);
    for (let i = 0; i < 3; i++) {
      bridge.handle('LocomotionEvents', {
        anchors: { entity: { entity: player } },
        facts: { kind: 'footstep', gait: 'walk', surface: lookups.surfaceUnder?.(player) },
      });
    }
    expect(DEFAULT_FOOTSTEP_SURFACE).toBe('stone');
    expect(played.map((p) => p.cue)).toEqual(Array(3).fill('sfx-foot-stone-walk'));
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('"iron"');
  });

  it('AC-5: in plate armour, every footstep also plays the plate layer', () => {
    const { world, player, played } = (() => {
      const w = registerWorldProperties(new World({ seed: 1 })).register(CharacterController);
      const p = spawnCharacter(w, { x: 0, y: 0, z: 0 });
      const out: Played[] = [];
      const bridge = new AudioCueBridge({
        sheets: [footsteps],
        player: { play: (cue, options) => out.push({ cue, options }) },
        now: () => w.tick * 1000,
        lookups: worldCueLookups(w, content.all('material'), {
          armorOf: (entity: EntityId) => (entity === p ? 'plate' : undefined),
        }),
      });
      bridge.attach(w.events);
      return { world: w, player: p, played: out };
    })();
    const other = spawnCharacter(world, { x: 3, y: 0, z: 0 });
    for (const [entity, foot] of [
      [player, 'left'],
      [player, 'right'],
      [other, 'left'],
    ] as const) {
      world.events.emit(LocomotionEvents, {
        tick: world.tick,
        entity,
        kind: 'footstep',
        foot,
        gait: 'walk',
        position: { x: 0, y: 0, z: 0 },
        wet: false,
        frozen: false,
        burning: false,
        profileNoise: 0.3,
        encumbrance: 1,
        surfaceDb: 0,
        loudness: 0.3,
      });
      world.step();
    }
    // Unbound ground reads the default material: stone. The layer is its own rule layer, so it
    // sounds together with the step rather than instead of it.
    expect(played.map((p) => p.cue)).toEqual([
      'sfx-armor-plate-layer',
      'sfx-foot-stone-walk',
      'sfx-armor-plate-layer',
      'sfx-foot-stone-walk',
      'sfx-foot-stone-walk',
    ]);
    expect(played[0]?.options.entity).toBe(player);
  });

  it('landings thud louder the faster the fall, heavy from the hard-landing speed', () => {
    const { bridge, played } = bridgeWith({
      materialOf: () => undefined,
      impactClassOf: () => undefined,
    });
    const land = (impactSpeed: number, landing: string) =>
      bridge.handle('LocomotionEvents', {
        anchors: { entity: { entity: 1 } },
        facts: { kind: 'land', impactSpeed, landing, surface: 'stone' },
      });
    land(3, 'light');
    land(5.5, 'light');
    land(12, 'heavy');
    expect(played.map((p) => p.cue)).toEqual([
      'sfx-foot-land-light',
      'sfx-foot-land-light',
      'sfx-foot-land-heavy',
    ]);
    expect(played[1]?.options.volume ?? 0).toBeGreaterThan(played[0]?.options.volume ?? 0);
  });

  it('reads the surface of a physics object stood on, and stone where nothing is known', () => {
    const bare = registerWorldProperties(new World({ seed: 1 }));
    const nobody = bare.spawn();
    const warn = vi.fn();
    // No controller, physics or guard components registered: defaults, no throw, no warning.
    const plain = worldCueLookups(bare, content.all('material'), { warn });
    expect(plain.surfaceUnder?.(nobody)).toBe('stone');
    expect(plain.shieldOf?.(nobody)).toBeUndefined();
    expect(plain.moveSoundOf?.('sword-light-1')).toBeUndefined();
    expect(plain.armorOf).toBeUndefined();
    const world = registerWorldProperties(new World({ seed: 1 })).register(
      CharacterController,
      PhysicsObjectComponent,
      GuardComponent,
    );
    const raft = world.spawn();
    addProperties(world, raft, { material: 'dry-wood' });
    world.add(raft, PhysicsObjectComponent, { body: 3 } as never);
    const rider = spawnCharacter(world, { x: 0, y: 0, z: 0 });
    const state = world.get(rider, CharacterController);
    if (state === undefined) throw new Error('no controller');
    world.add(rider, CharacterController, { ...state, groundBody: 3 });
    world.add(rider, GuardComponent, { shield: { id: 'wood-shield' }, held: true } as never);
    const lookups = worldCueLookups(world, content.all('material'), {
      warn,
      moves: content.all('move'),
    });
    expect(lookups.surfaceUnder?.(rider)).toBe('wood');
    expect(lookups.shieldOf?.(rider)).toBe('wood-shield');
    expect(lookups.moveSoundOf?.('sword-heavy')).toBe('sfx-knight-sword-swing-heavy');
    // Standing on a collider nobody owns (unbound geometry): the default material, stone.
    world.add(rider, CharacterController, { ...state, groundBody: 99 });
    expect(lookups.surfaceUnder?.(rider)).toBe('stone');
    world.destroy(rider);
    world.step();
    expect(lookups.surfaceUnder?.(rider)).toBe('stone');
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns through console.warn by default', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const world = registerWorldProperties(new World({ seed: 1 })).register(
      CharacterController,
      PhysicsColliderComponent,
    );
    const floor = world.spawn();
    addProperties(world, floor, { material: 'glass' });
    world.add(floor, PhysicsColliderComponent, { colliders: [1] });
    const walker = spawnCharacter(world, { x: 0, y: 0, z: 0 });
    const state = world.get(walker, CharacterController);
    if (state === undefined) throw new Error('no controller');
    world.add(walker, CharacterController, { ...state, groundBody: 1 });
    expect(worldCueLookups(world, content.all('material')).surfaceUnder?.(walker)).toBe('stone');
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});
