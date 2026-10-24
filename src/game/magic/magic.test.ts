// Casting in the game world (mw-e06.15): the controller's commands against the real installed
// pipeline, with the fixture bolt from content and a channelled self spell.
import { describe, expect, it } from 'vitest';
import { loadSpellFixtureContent } from '@content/test-fixtures';
import {
  actionButton,
  actionFrame,
  actionVector,
  CastCancelled,
  castStateOf,
  DamageModel,
  DAMAGE_COMPONENTS,
  healthOf,
  HIT_VOLUME_COMPONENTS,
  installStimuli,
  learnSpellCommand,
  manaOf,
  placeEntity,
  registerWorldProperties,
  SpellCast,
  SpellFizzled,
  SpellHit,
  stimulusSystem,
  World,
  type ActionFrame,
  type ButtonAction,
  type CollisionWorld,
  type EntityId,
  type Vec3,
} from '@sim/index';
import { makeSpell, projectileDelivery } from '@sim/magic/testing';
import { spawnTrainingDummy } from '../combat/training-dummy';
import type { AimRay } from './aim';
import { SpellCaster, type SpellCommand } from './caster';
import { givePlayerMana, installGameMagic } from './install';
import { attachSpellReadout } from './readout';

type Input = ActionFrame | SpellCommand | ReturnType<typeof learnSpellCommand>;

/** A level that is only a floor at y = 0. */
const floor: CollisionWorld = {
  sweepCapsule: () => undefined,
  overlapCapsule: () => false,
  bodyVelocity: () => ({ x: 0, y: 0, z: 0 }),
  raycast(origin, d, max) {
    if (d.y >= 0) return undefined;
    const t = origin.y / -d.y;
    if (t > max) return undefined;
    const point = { x: origin.x + d.x * t, y: 0, z: origin.z + d.z * t };
    return { distance: t, normal: { x: 0, y: 1, z: 0 }, point, body: 1 };
  },
};

const hold =
  (...held: ButtonAction[]) =>
  (pressed: ButtonAction[] = [], released: ButtonAction[] = []): ActionFrame =>
    actionFrame({
      move: actionVector(0, 0),
      look: actionVector(0, 0),
      buttons: (a) =>
        actionButton(
          pressed.includes(a),
          held.includes(a) || pressed.includes(a),
          released.includes(a),
        ),
    });
const press = (...a: ButtonAction[]) => hold()(a);
const release = (...a: ButtonAction[]) => hold()([], a);

const channelSpell = makeSpell('t-channel', {
  castTime: 0,
  cost: { mana: 0 },
  channel: { interval: 0.25, manaPerSecond: 4, maxDuration: 6 },
});
const touchSpell = makeSpell('t-touch', { delivery: { kind: 'touch', reach: 2 } });
const flame = makeSpell('t-flame', {
  delivery: projectileDelivery({ quenchedByWater: true }),
});
const groundSpell = makeSpell('t-ground', {
  delivery: { kind: 'summonPoint', range: 4, lineOfSight: false },
});

function game(collision: CollisionWorld = floor, water?: (point: Vec3) => boolean) {
  const content = loadSpellFixtureContent();
  const spells = [...content.all('spell'), channelSpell, groundSpell, touchSpell, flame];
  const world = new World<Input>({ seed: 5 });
  installStimuli(registerWorldProperties(world));
  world.register(...DAMAGE_COMPONENTS, ...HIT_VOLUME_COMPONENTS);
  const magic = installGameMagic(world, {
    spells,
    damage: new DamageModel(),
    collision: floor,
    invulnerable: () => false,
    ...(water !== undefined && { water }),
  });
  world.addSystem(stimulusSystem());
  const player = world.spawn();
  placeEntity(world, player, { x: 0, y: 0, z: 0 }, 0.4);
  givePlayerMana(world, player, 100);
  let alive = true;
  const lock: { target: EntityId | null } = { target: null };
  const caster = new SpellCaster({
    world,
    caster: player,
    spells: magic.spells,
    collision,
    canCast: () => alive,
    locked: () => lock.target,
  });
  // The camera: 3 m behind the player and 2 m up, looking 5 degrees down along -z.
  const down = (5 * Math.PI) / 180;
  const ray = (): AimRay => ({
    origin: { x: 0, y: 2, z: 3 },
    direction: { x: 0, y: -Math.sin(down), z: -Math.cos(down) },
  });
  const frame = (f: ActionFrame): readonly SpellCommand[] => {
    const commands = caster.commands(f, ray);
    world.step([f, ...commands]);
    return commands;
  };
  const learn = (...ids: string[]): void => {
    world.step(ids.map((id) => learnSpellCommand(player, id)));
  };
  const dummyAt = (z: number): EntityId =>
    spawnTrainingDummy(world, {
      id: 'dummy',
      position: { x: 0, y: 0, z },
      yaw: 0,
      tags: [],
    } as never);
  return {
    world,
    magic,
    player,
    caster,
    frame,
    ray,
    learn,
    dummyAt,
    lock,
    die: () => {
      alive = false;
    },
  };
}

describe('installed magic', () => {
  it('lists the content spells, sorted', () => {
    const { magic } = game();
    expect(magic.spellIds).toContain('fixture-bolt');
    expect([...magic.spellIds]).toEqual([...magic.spellIds].sort());
  });

  it('learn-spell teaches the player, and the first learned spell is selected', () => {
    const { caster, learn } = game();
    expect(caster.selected).toBeUndefined();
    learn('fixture-bolt', 't-channel');
    expect(caster.learned()).toEqual(['fixture-bolt', 't-channel']);
    expect(caster.selected).toBe('fixture-bolt');
    expect(caster.select('t-channel')).toBe(true);
    expect(caster.selected).toBe('t-channel');
    expect(caster.select('fixture-ray')).toBe(false);
    expect(caster.spell()?.id).toBe('t-channel');
  });

  it('a flame cast under water is quenched, nothing spent', () => {
    const { world, player, learn, frame } = game(floor, () => true);
    const reasons: string[] = [];
    world.events.on(SpellFizzled, (f) => reasons.push(f.reason));
    learn('t-flame');
    frame(press('cast'));
    for (let i = 0; i < 5; i++) frame(hold()());
    expect(reasons).toEqual(['quenched']);
    expect(manaOf(world, player)?.current).toBe(100);
  });

  it('gives the player a mana pool of the size asked', () => {
    const { world, player } = game();
    expect(manaOf(world, player)?.profile.max).toBe(100);
  });
});

describe('the casting controller', () => {
  it('AC-1: the cast action sends a cast with the reticle aim point in the same frame', () => {
    const { world, player, learn, frame } = game();
    learn('fixture-bolt');
    const commands = frame(press('cast'));
    expect(commands).toHaveLength(1);
    const [cast] = commands;
    expect(cast).toMatchObject({ type: 'cast', caster: player, spell: 'fixture-bolt' });
    const aim = (cast as { aim: Vec3 }).aim;
    expect(aim.y).toBeCloseTo(0, 1);
    expect(aim.z).toBeLessThan(-3);
    // The very step that took the press began the 0.4 s wind-up.
    expect(castStateOf(world, player)?.spell).toBe('fixture-bolt');
  });

  it('does nothing without a learned spell, but counts the refusal', () => {
    const { caster, frame, ray } = game();
    expect(frame(press('cast'))).toEqual([]);
    expect(caster.refusals).toBe(1);
    expect(caster.lastRefusal).toBe('no-spell');
    expect(caster.preview(ray())).toBeUndefined();
    expect(frame(hold()())).toEqual([]);
  });

  it('sends nothing for an invalid ground aim, and says why', () => {
    const { caster, learn, frame } = game({ ...floor, raycast: () => undefined });
    learn('t-ground');
    expect(frame(press('cast'))).toEqual([]);
    expect(caster.refusals).toBe(1);
    expect(caster.lastRefusal).toBe('no-floor');
  });

  it('AC-3: releasing the cast action ends a channel on that tick', () => {
    const { world, player, caster, learn, frame } = game();
    learn('t-channel');
    expect(caster.select('t-channel')).toBe(true);
    expect(frame(press('cast'))).toHaveLength(1);
    expect(castStateOf(world, player)?.phase).toBe('channeling');
    for (let i = 0; i < 20; i++) frame(hold('cast')());
    expect(castStateOf(world, player)?.phase).toBe('channeling');
    const commands = frame(release('cast'));
    expect(commands).toEqual([{ type: 'cancel-cast', caster: player }]);
    expect(castStateOf(world, player)).toBeUndefined();
  });

  it('a released button does not cancel a spell that is not a channel', () => {
    const { world, player, learn, frame } = game();
    learn('fixture-bolt');
    frame(press('cast'));
    expect(frame(release('cast'))).toEqual([]);
    expect(castStateOf(world, player)?.phase).toBe('winding');
  });

  it('the cancel action calls off a wind-up, freeing the mana', () => {
    const { world, player, learn, frame } = game();
    learn('fixture-bolt');
    let cancelled = 0;
    world.events.on(CastCancelled, () => (cancelled += 1));
    frame(press('cast'));
    expect(frame(press('cancelCast'))).toEqual([{ type: 'cancel-cast', caster: player }]);
    expect(cancelled).toBe(1);
    expect(castStateOf(world, player)).toBeUndefined();
    expect(manaOf(world, player)?.current).toBe(100);
  });

  it('a touch spell is sent with the locked target', () => {
    const { world, learn, frame, lock, dummyAt, caster } = game();
    const dummy = dummyAt(-1.5);
    lock.target = dummy;
    learn('t-touch');
    expect(frame(press('cast'))[0]).toMatchObject({
      type: 'cast',
      spell: 't-touch',
      target: dummy,
    });
    lock.target = null;
    world.destroy(dummy);
    expect(frame(press('cast'))).toEqual([]);
    expect(caster.lastRefusal).toBe('no-target');
  });

  it('a caster who cannot act sends nothing and drops a channel', () => {
    const { caster, learn, frame, die } = game();
    learn('t-channel');
    caster.select('t-channel');
    frame(press('cast'));
    die();
    expect(frame(press('cast'))).toEqual([]);
    expect(frame(release('cast'))).toEqual([]);
  });

  it('AC-4: a scripted player selects, aims and casts a bolt at a dummy, which registers a hit', () => {
    const { world, player, caster, learn, frame, dummyAt } = game();
    const dummy = dummyAt(-8);
    const hits: (EntityId | null)[] = [];
    world.events.on(SpellHit, (hit) => hits.push(hit.target));
    let casts = 0;
    world.events.on(SpellCast, () => (casts += 1));
    learn('fixture-bolt');
    expect(caster.select('fixture-bolt')).toBe(true);
    const before = healthOf(world, dummy)?.current ?? 0;
    frame(press('cast'));
    for (let i = 0; i < 120 && hits.length === 0; i++) frame(hold()());
    expect(casts).toBe(1);
    expect(hits).toContain(dummy);
    expect(healthOf(world, dummy)?.current).toBeLessThan(before);
    expect(manaOf(world, player)?.current).toBeLessThan(100);
  });

  it('a refusal by the sim (no mana pool left, on cooldown) is a fizzle the HUD can read', () => {
    const { world, learn, frame } = game();
    learn('fixture-bolt');
    const reasons: string[] = [];
    world.events.on(SpellFizzled, (f) => reasons.push(f.reason));
    frame(press('cast'));
    for (let i = 0; i < 30; i++) frame(hold()());
    frame(press('cast'));
    for (let i = 0; i < 30; i++) frame(hold()());
    expect(reasons).toContain('cooldown');
  });
});

describe('the spell readout', () => {
  it('reports casts, hits (and whether the target burns), fizzles and refusals', () => {
    const { world, player, caster, learn, frame, dummyAt } = game();
    const dummy = dummyAt(-8);
    const readout = attachSpellReadout({
      world,
      player,
      caster,
      aim: () => caster.preview({ origin: { x: 0, y: 2, z: 3 }, direction: { x: 0, y: 0, z: -1 } }),
      spawnOf: (entity) => (entity === dummy ? 'the-dummy' : null),
    });
    expect(readout.read()).toMatchObject({ selected: null, mana: 100, casts: 0, aim: null });
    learn('fixture-bolt');
    frame(press('cast'));
    for (let i = 0; i < 120; i++) frame(hold()());
    const read = readout.read();
    expect(read.selected).toBe('fixture-bolt');
    expect(read.casts).toBe(1);
    expect(read.hits[0]).toMatchObject({ spell: 'fixture-bolt', spawn: 'the-dummy' });
    expect(read.aim).toMatchObject({ mode: 'reticle', valid: true });
    expect(read.fizzles).toEqual([]);
    readout.dispose();
  });

  it('reads a target on fire, and no mana without a pool', () => {
    const { world, player, caster, dummyAt } = game();
    const dummy = dummyAt(-3);
    const readout = attachSpellReadout({
      world,
      player,
      caster,
      aim: () => undefined,
      spawnOf: () => null,
    });
    world.events.emit(SpellHit, {
      tick: 0,
      caster: player,
      spell: 'x',
      delivery: player,
      target: dummy,
      point: { x: 0, y: 0, z: 0 },
    });
    world.events.emit(SpellHit, {
      tick: 0,
      caster: player + 100,
      spell: 'x',
      delivery: player,
      target: dummy,
      point: { x: 0, y: 0, z: 0 },
    });
    world.events.emit(SpellCast, {
      tick: 0,
      caster: player + 100,
      spell: 'x',
      source: 'known',
      delivery: player,
      deliveryKind: 'self',
    });
    world.step([]);
    expect(readout.read().hits).toHaveLength(1);
    expect(readout.read().casts).toBe(0);
    world.destroy(dummy);
    world.step([]);
    expect(readout.read().hits[0]).toMatchObject({ burning: false });
    const bare = new World<never>({ seed: 1 });
    const lone = attachSpellReadout({
      world: bare,
      player: 1,
      caster,
      aim: () => undefined,
      spawnOf: () => null,
    });
    expect(lone.read().mana).toBeNull();
  });

  it('keeps only the latest few hits and fizzles', () => {
    const { world, player, caster, learn } = game();
    const readout = attachSpellReadout({
      world,
      player,
      caster,
      aim: () => undefined,
      spawnOf: () => null,
    });
    learn('fixture-bolt');
    for (let i = 0; i < 12; i++) {
      world.events.emit(SpellFizzled, {
        tick: 0,
        caster: player,
        spell: 'x',
        reason: `r${String(i)}`,
        stage: 'validate',
      });
      world.events.emit(SpellHit, {
        tick: 0,
        caster: player,
        spell: 'x',
        delivery: player,
        target: null,
        point: { x: 0, y: 0, z: 0 },
      });
    }
    world.events.emit(SpellFizzled, {
      tick: 0,
      caster: player + 100,
      spell: 'x',
      reason: 'other',
      stage: 'validate',
    });
    world.step([]);
    const read = readout.read();
    expect(read.fizzles).toHaveLength(8);
    expect(read.fizzles.at(-1)).toBe('r11');
    expect(read.hits).toHaveLength(8);
    expect(read.hits[0]).toMatchObject({ entity: null, spawn: null, burning: false });
  });
});
