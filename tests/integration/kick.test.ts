// mw-e04.18: the knight's kick in the game world — the testbed as src/main.ts and the replay world wire
// it (Rapier physics, stimuli, fire, the player with the kick on K, startTestbedCombat), headless,
// driven through the ActionSampler. A kick shoves objects up to 40 kg by physics, tips a burning
// brazier into the rug beside it (fire spreads by properties, never by a brazier-and-rug rule), slams
// a door open onto the creature behind it, and knocks a small creature off a ledge.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadDevContent } from '@content/dev-content';
import { materialPresets } from '@content/index';
import { markExercised } from '@content/testing';
import { ActionSampler } from '@game/input/index';
import {
  ActionStarted,
  addMaterialProperties,
  addPhysicsObject,
  addProperties,
  CharacterController,
  CreatureComponent,
  DamageApplied,
  DoorComponent,
  giveActionTimeline,
  giveCombatant,
  giveHitReactions,
  giveHurtboxes,
  hashWorld,
  HitReaction,
  ImpactResisted,
  initialCharacterState,
  makeDoor,
  PhysicsObjectComponent,
  placeEntity,
  SceneSpawnComponent,
  PlayerLook,
  readProperty,
  reactionProfileFromCreature,
  spawnCharacter,
  staminaOf,
  SKIN,
  type ActionStartInfo,
  type DamageResult,
  type EntityId,
  type HitReactionInfo,
  type ImpactResistance,
  type Vec3,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const content = loadDevContent();
const presets = materialPresets(content.all('material'));
const hound = content.get('creature', 'fixture-hound');

/** The knight faces −x (look yaw π/2), away from the testbed's dummies, with room to shove. */
const FACING_YAW = Math.PI / 2;

function testbed() {
  const game = createGameWorld<unknown>(RAPIER, { seed: 1, hz: 60, content, magic: true });
  const { world, player } = game;
  const look = world.get(player, PlayerLook) ?? expect.fail('no look');
  world.set(player, PlayerLook, { ...look, yaw: FACING_YAW });
  const sampler = new ActionSampler();
  const started: ActionStartInfo[] = [];
  const resisted: ImpactResistance[] = [];
  const hits: DamageResult[] = [];
  const reactions: HitReactionInfo[] = [];
  world.events.on(ActionStarted, (e) => {
    if (e.entity === player) started.push(e);
  });
  world.events.on(ImpactResisted, (e) => resisted.push(e));
  world.events.on(DamageApplied, (e) => hits.push(e));
  world.events.on(HitReaction, (e) => reactions.push(e));
  const step = (codes: readonly string[] = []) => {
    for (const code of codes) sampler.down(code);
    world.step(sampler.sampleCommands(world.tick));
    for (const code of codes) sampler.up(code);
  };
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) step();
  };
  run(20); // settle on the floor, turned
  const feet = world.get(player, CharacterController)?.position ?? expect.fail('no player');
  /** Presses the kick button and runs on for `after` ticks. */
  const kick = (after = 120) => {
    step(['KeyK']);
    run(after);
  };
  return { ...game, sampler, started, resisted, hits, reactions, step, run, feet, kick };
}

type Game = ReturnType<typeof testbed>;

/** A box of `weight` kg standing on the floor `ahead` m in front of the knight. */
function propInFront(game: Game, weight: number, init: Record<string, unknown>, ahead = 0.9) {
  const { world, feet } = game;
  const half = { x: 0.3, y: 0.45, z: 0.3 };
  const entity = world.spawn();
  addProperties(world, entity, { weight, friction: 0.5, material: 'wood', ...init });
  addPhysicsObject(world, entity, {
    shape: { kind: 'box', halfExtents: half },
    position: { x: feet.x - ahead, y: feet.y + half.y, z: feet.z },
  });
  game.run(10); // let it settle
  return entity;
}

const positionOf = (game: Game, entity: EntityId): Vec3 =>
  game.world.get(entity, PhysicsObjectComponent)?.position ?? expect.fail('no body');
const horizontal = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);

describe('the kick in the testbed (mw-e04.18)', () => {
  it('AC-1: a 25 kg object kicked on flat ground moves at least 1.5 m, deterministically', ({
    task,
  }) => {
    markExercised(task, 'move', 'kick');
    const run = () => {
      const game = testbed();
      const crate = propInFront(game, 25, { pushable: true });
      const before = positionOf(game, crate);
      game.kick();
      return { game, crate, before };
    };
    const { game, crate, before } = run();
    expect(game.started.map((e) => e.move)).toEqual(['kick']);
    const after = positionOf(game, crate);
    expect(horizontal(after, before)).toBeGreaterThanOrEqual(1.5);
    expect(after.x).toBeLessThan(before.x); // along the knight's facing (−x)
    expect(game.resisted).toEqual([]);
    expect(hashWorld(run().game.world)).toBe(hashWorld(game.world));
  });

  it('AC-1: a 50 kg object does not move, and ImpactResisted fires', () => {
    const game = testbed();
    const crate = propInFront(game, 50, { pushable: true });
    const before = positionOf(game, crate);
    game.kick();
    expect(horizontal(positionOf(game, crate), before)).toBeLessThan(0.01);
    expect(game.resisted).toMatchObject([{ entity: crate, weight: 50, maxWeight: 40 }]);
  });

  it('the kick costs 8 stamina on its own button (K)', () => {
    const game = testbed();
    const before = staminaOf(game.world, game.player)?.current ?? 0;
    game.step(['KeyK']);
    expect(before - (staminaOf(game.world, game.player)?.current ?? 0)).toBe(8);
    game.run(40);
    expect(game.started.map((e) => e.move)).toEqual(['kick']);
  });

  /** A 30 kg burning brazier 0.9 m ahead and a rug on the floor beyond it, 2.6 m ahead. */
  function brazierAndRug(game: Game) {
    const { world, feet } = game;
    const brazier = world.spawn();
    addMaterialProperties(world, brazier, presets, {
      material: 'wood',
      weight: 30,
      friction: 0.5,
      pushable: true,
      flammable: true,
      burning: true,
      temperature: 600,
      fuel: 600,
    });
    addPhysicsObject(world, brazier, {
      shape: { kind: 'box', halfExtents: { x: 0.3, y: 0.45, z: 0.3 } },
      position: { x: feet.x - 0.9, y: feet.y + 0.45, z: feet.z },
    });
    const rug = world.spawn();
    addMaterialProperties(world, rug, presets, { material: 'cloth', temperature: 20 });
    placeEntity(world, rug, { x: feet.x - 2.6, y: feet.y + 0.02, z: feet.z }, 0.6);
    game.run(10);
    expect(readProperty(world, brazier, 'burning')).toBe(true);
    expect(readProperty(world, rug, 'burning')).toBe(false);
    return { brazier, rug };
  }

  it('AC-2: a burning brazier kicked into the rug beyond it sets the rug alight within 2 s', ({
    task,
  }) => {
    markExercised(task, 'material', 'cloth');
    const game = testbed();
    const { rug, brazier } = brazierAndRug(game);
    const start = positionOf(game, brazier);
    game.step(['KeyK']);
    let litAfter = -1;
    for (let tick = 0; tick < 300 && litAfter < 0; tick++) {
      game.step();
      if (readProperty(game.world, rug, 'burning')) litAfter = tick;
    }
    expect(horizontal(positionOf(game, brazier), start)).toBeGreaterThan(1);
    // From the press: 10 startup ticks, then within 2 s (120 ticks) of the kick landing.
    expect(litAfter).toBeGreaterThanOrEqual(0);
    expect(litAfter).toBeLessThanOrEqual(10 + 120);
  });

  it('AC-2 control: left alone, the same brazier does not light the rug', () => {
    const game = testbed();
    const { rug } = brazierAndRug(game);
    game.run(300);
    expect(readProperty(game.world, rug, 'burning')).toBe(false);
  });
});

describe('the kick against doors and creatures (mw-e04.18)', () => {
  /** A hinged door filling a doorway `ahead` m in front of the knight, with the scene's mechanisms. */
  function doorInFront(game: Game, lock = false) {
    const { world, feet, player } = game;
    const look = world.get(player, PlayerLook) ?? expect.fail('no look');
    world.set(player, PlayerLook, { ...look, yaw: -FACING_YAW }); // facing +x, clear of the props
    // The testbed's draught stands in this doorway; take it away.
    for (const id of world.query(SceneSpawnComponent).ids()) {
      if (world.get(id, SceneSpawnComponent)?.id === 'testbed-draught') world.destroy(id);
    }
    game.run(5);
    const door = world.spawn();
    addProperties(world, door, { weight: 60 });
    makeDoor(
      world,
      door,
      {
        id: 'wooden-door',
        kind: 'hinged',
        size: { x: 1.2, y: 2.2, z: 0.06 },
        seconds: 1,
        crush: 0,
        manual: true,
        blocks: { light: true, gas: true, sound: true },
        loudness: 50,
      },
      {
        origin: { x: feet.x + 1, y: feet.y, z: feet.z },
        yaw: 90,
        ...(lock && {
          lock: { id: 'cell', tier: 1, pickTier: 1, sealed: false, tags: [], hint: 'Locked.' },
        }),
      },
    );
    return door;
  }

  it('AC-3: a door kicked with a creature 0.5 m behind it opens; the creature takes blunt damage and flinches', ({
    task,
  }) => {
    markExercised(task, 'creature', 'fixture-hound');
    const game = testbed();
    const { world, feet } = game;
    const door = doorInFront(game);
    const goblin = spawnCharacter(world, { x: feet.x + 1.5, y: feet.y + SKIN, z: feet.z + 0.3 });
    giveCombatant(world, goblin, { health: 60, poise: 60 });
    giveHurtboxes(world, goblin, { boxes: [] });
    giveActionTimeline(world, goblin);
    giveHitReactions(world, goblin, reactionProfileFromCreature(hound));
    game.run(5);
    game.kick(60);
    const struck = game.hits.find((h) => h.target === goblin) ?? expect.fail('door did not hit');
    expect(struck.packet.source).toBe(door);
    expect(struck.packet.instigator).toBe(game.player);
    expect(struck.amounts.blunt).toBeGreaterThan(0);
    expect(game.reactions.find((r) => r.entity === goblin)).toMatchObject({ reaction: 'flinch' });
    expect(world.get(door, DoorComponent)?.openness).toBeGreaterThan(0);
  });

  it('AC-4: a locked door stays shut, with ImpactResisted', () => {
    const game = testbed();
    const door = doorInFront(game, true);
    game.kick(60);
    expect(game.world.get(door, DoorComponent)?.openness).toBe(0);
    expect(game.resisted.map((e) => e.entity)).toEqual([door]);
  });

  it('AC-5: a small creature kicked towards a ledge 0.5 m away goes over it and lands below', () => {
    const game = testbed();
    const { world, player } = game;
    // The arena platform at x 5…7, z 28…30, top at y = 2 (hit-reaction-ledge.test.ts): the knight
    // stands at its west side looking east, the creature between it and the edge.
    const state = world.get(player, CharacterController) ?? expect.fail('no player');
    world.set(player, CharacterController, initialCharacterState({ x: 5.3, y: 2 + SKIN, z: 29 }));
    expect(state).toBeDefined();
    const look = world.get(player, PlayerLook) ?? expect.fail('no look');
    world.set(player, PlayerLook, { ...look, yaw: -Math.PI / 2 });
    const goblin = spawnCharacter(world, { x: 6.5, y: 2 + SKIN, z: 29 });
    world.add(goblin, CreatureComponent, {
      origin: {
        creature: 'fixture-hound',
        at: { x: 6.5, y: 2, z: 29 },
        facing: { x: -1, y: 0, z: 0 },
      },
      behaviour: 'none',
      tuning: {},
      needs: {},
    });
    giveCombatant(world, goblin, { health: 60, poise: 20 });
    giveHurtboxes(world, goblin, {
      boxes: [
        {
          id: 'torso',
          socket: 'root',
          region: 'torso',
          armored: false,
          multiplier: 1,
          shape: {
            kind: 'capsule',
            from: { x: 0, y: 0.3, z: 0 },
            to: { x: 0, y: 0.7, z: 0 },
            radius: 0.35,
          },
        },
      ],
    });
    giveActionTimeline(world, goblin);
    giveHitReactions(world, goblin, reactionProfileFromCreature(hound));
    game.run(10);
    game.kick(90);
    expect(game.reactions.filter((r) => r.entity === goblin).map((r) => r.reaction)).toContain(
      'knockback',
    );
    const landed = world.get(goblin, CharacterController) ?? expect.fail('no goblin');
    expect(landed.position.x).toBeGreaterThan(7);
    expect(landed.position.y).toBeLessThan(0.5);
  });
});
