import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { KNIGHT_SHIELD_ID, loadGameContent } from '@content/index';
import {
  ACTION_TIMELINE_COMPONENTS,
  actionTimelineSystem,
  ARROW_COMPONENTS,
  box,
  FakeCollisionWorld,
  giveActionTimeline,
  giveFacing,
  giveHitboxes,
  giveStamina,
  placeEntity,
  requestMove,
  StaminaComponent,
  staminaSystem,
  WallRecoil,
  type WallRecoilInfo,
  ArrowComponent,
  BlameComponent,
  CharacterController,
  DAMAGE_COMPONENTS,
  EnvironmentContactsComponent,
  RapierPhysics,
  DEFAULT_REACTION_PROFILE,
  giveCombatant,
  healthOf,
  HitReactionComponent,
  HurtboxComponent,
  PlayerCombatantComponent,
  poiseOf,
  HIT_VOLUME_COMPONENTS,
  PlacementComponent,
  World,
  type SceneSpawnPlacement,
} from '@sim/index';
import { installGamePhysics } from '../physics-objects';
import { prepareTestbedCombat, startTestbedCombat } from './testbed-combat';
import {
  dummyReadout,
  readDummyTransform,
  spawnTrainingDummy,
  TRAINING_DUMMY,
  TRAINING_DUMMY_TAG,
  trainingDummySpawns,
} from './training-dummy';

const spawn = (id: string, tags: string[], z = 0): SceneSpawnPlacement => ({
  id,
  position: { x: 1, y: 0, z },
  yaw: 0,
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  prop: undefined,
  tags,
});

const world = () =>
  new World<never>({ seed: 1 }).register(
    ...HIT_VOLUME_COMPONENTS,
    ...DAMAGE_COMPONENTS,
    PlacementComponent,
  );

describe('training dummy (mw-e04.6)', () => {
  it('picks the tagged spawns and spawns a torso-only dummy with health at the feet', () => {
    const spawns = [spawn('a', ['player-start']), spawn('b', [TRAINING_DUMMY_TAG], 2)];
    expect(trainingDummySpawns(spawns).map((s) => s.id)).toEqual(['b']);
    const w = world();
    const [target] = trainingDummySpawns(spawns);
    if (target === undefined) throw new Error('no dummy spawn');
    const dummy = spawnTrainingDummy(w, target);
    expect(dummyReadout(w, dummy)).toEqual({ health: 200, max: 200 });
    expect(TRAINING_DUMMY.health).toBe(200);
    expect(readDummyTransform(w, dummy)).toEqual({
      position: { x: 1, y: 0, z: 2 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    });
    w.destroy(dummy);
    w.step();
    expect(dummyReadout(w, dummy)).toBeUndefined();
    expect(readDummyTransform(w, dummy)).toBeUndefined();
  });

  it('the testbed combat: moves, tracks and the wood shield from content; systems and dummies', () => {
    const combat = prepareTestbedCombat(loadGameContent());
    expect(combat.moves.get('sword-light-1')?.chainNext).toBe('sword-light-2');
    expect(combat.tracks.has('knight-sword-arc-light-1')).toBe(true);
    expect(combat.melee.shield?.id).toBe(KNIGHT_SHIELD_ID);
    expect([combat.melee.parry, combat.melee.riposte]).toEqual(['shield-parry', 'sword-riposte']);
    expect([combat.melee.bash, combat.melee.bashFallback]).toEqual(['shield-bash', 'kick']);
    expect(combat.damage.modifiers().map((m) => [m.name, m.stage])).toEqual([
      ['shield-block', 'guard'],
    ]);
    expect(combat.sandbox.tuning.id).toBe('combat-sandbox');
    expect([...combat.spawners.keys()]).toEqual(['dummy', 'attacker-dummy']);
    expect(combat.moves.has('training-dummy-swing:parryable:unblockable')).toBe(true);
    const w = world();
    const { dummies, sandboxDummies } = startTestbedCombat(w, combat, [
      spawn('d1', [TRAINING_DUMMY_TAG]),
      spawn('x', []),
      spawn('d2', [TRAINING_DUMMY_TAG], 3),
    ]);
    expect(dummies).toHaveLength(2);
    expect(sandboxDummies).toEqual([]);
    // Parry and riposte (mw-e04.12) and hit reactions (mw-e04.7, mw-e04.31) joined the damage model.
    expect(combat.damage.modifiers().map((m) => m.name)).toEqual([
      'counter-hit',
      'riposte',
      'wake-up-iframes',
      'hyperarmor',
      'shield-block',
      'parry',
    ]);
    w.step();
    expect(dummies.map((d) => dummyReadout(w, d)?.health)).toEqual([200, 200]);
  });

  it('arms the player: health, poise, a hurtbox and hit reactions, unless it is a combatant already (mw-e04.31)', () => {
    const combat = prepareTestbedCombat(loadGameContent());
    const w = world();
    const knight = w.spawn();
    startTestbedCombat(w, combat, [], knight);
    const again = world();
    const other = again.spawn();
    giveCombatant(again, other, { health: 5 });
    again.step();
    startTestbedCombat(again, prepareTestbedCombat(loadGameContent()), [], other);
    w.step();
    again.step();
    expect(healthOf(w, knight)).toEqual({ max: 100, current: 100 });
    expect(poiseOf(w, knight)?.max).toBe(30);
    expect(w.has(knight, PlayerCombatantComponent)).toBe(true);
    expect(w.get(knight, HurtboxComponent)?.boxes.map((b) => b.region)).toEqual(['torso']);
    expect(w.get(knight, HitReactionComponent)?.profile).toEqual(DEFAULT_REACTION_PROFILE);
    // Already a combatant: left as it was.
    expect(healthOf(again, other)).toEqual({ max: 5, current: 5 });
    expect(again.has(other, HurtboxComponent)).toBe(false);
  });

  it('mw-e04.34: a physics world without a player still gets the world-as-weapon rules', () => {
    const combat = prepareTestbedCombat(loadGameContent());
    const w = new World<never>({ seed: 1, physics: new RapierPhysics(RAPIER) });
    w.register(...HIT_VOLUME_COMPONENTS, ...DAMAGE_COMPONENTS);
    installGamePhysics(w);
    startTestbedCombat(w, combat, []);
    expect(w.isRegistered(CharacterController)).toBe(true);
    expect(w.isRegistered(BlameComponent)).toBe(true);
    expect(w.query(EnvironmentContactsComponent).ids()).toHaveLength(1);
    w.step();
    // A bare combat world (no physics objects) gets none of it.
    const bare = world();
    startTestbedCombat(bare, prepareTestbedCombat(loadGameContent()), []);
    expect(bare.isRegistered(BlameComponent)).toBe(false);
  });

  it('mw-e05.21: installs the arrow system, unless the world already has one', () => {
    const combat = prepareTestbedCombat(loadGameContent());
    expect(combat.bow.loadout).toMatchObject({ bow: 'shortbow' });
    expect(combat.bow.aim).toEqual({ fov: 55, time: 0.15 });
    const w = world();
    startTestbedCombat(w, combat, []);
    expect(w.isRegistered(ArrowComponent)).toBe(true);
    const own = world().register(...ARROW_COMPONENTS);
    expect(() => startTestbedCombat(own, combat, [])).not.toThrow();
  });

  it('mw-e04.15: with a level to probe, the player’s halberd sweep clangs off a corridor wall, a brute’s does not', () => {
    const combat = prepareTestbedCombat(loadGameContent());
    expect(combat.reach.wallRecoil.ticks).toBe(30);
    const v = (x: number, y: number, z: number) => ({ x, y, z });
    const corridor = new FakeCollisionWorld([
      box(v(-5, -1, -5), v(5, 0, 30)),
      box(v(-2, 0, -5), v(-1, 3, 30)),
      box(v(1, 0, -5), v(2, 3, 30)),
    ]);
    const run = (collision: FakeCollisionWorld | undefined, withPlayer: boolean) => {
      const w = world().register(...ACTION_TIMELINE_COMPONENTS, StaminaComponent);
      w.addSystem(staminaSystem()).addSystem(actionTimelineSystem({ moves: combat.moves }));
      const fighters = [w.spawn(), w.spawn()] as const;
      startTestbedCombat(w, combat, [], withPlayer ? fighters[0] : undefined, collision);
      fighters.forEach((fighter, i) => {
        placeEntity(w, fighter, v(0, 0, i * 12), 0.35);
        giveActionTimeline(w, fighter);
        giveStamina(w, fighter);
        giveFacing(w, fighter);
        giveHitboxes(w, fighter);
        requestMove(w, fighter, 'halberd-sweep');
      });
      const recoils: WallRecoilInfo[] = [];
      w.events.on(WallRecoil, (e) => recoils.push(e));
      for (let i = 0; i < 60; i++) w.step();
      return { recoils: recoils.map((r) => r.entity), player: fighters[0] };
    };
    const armed = run(corridor, true);
    expect(armed.recoils).toEqual([armed.player]);
    // No level to probe, or no player to recoil: the system is not installed.
    expect(run(undefined, true).recoils).toEqual([]);
    expect(run(corridor, false).recoils).toEqual([]);
  });
});
