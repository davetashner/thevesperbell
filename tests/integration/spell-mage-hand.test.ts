// Mage Hand (mw-e08.10) against real content, the real mechanisms and signals, and the deterministic
// Rapier physics. The spell is pure data plus the generic `tether` delivery: nothing in src/sim names
// it. Constitution section 4: it is too useful on purpose, so no test asks it to be weaker.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent, type ItemDef } from '@content/index';
import { markExercised } from '@content/testing';
import {
  addInteractable,
  addInteractor,
  addPhysicsObject,
  addProperties,
  addSignalGraph,
  box,
  DAMAGE_COMPONENTS,
  ForceResisted,
  giveCombatant,
  giveMana,
  healthOf,
  INTERACTION_COMPONENTS,
  installCasting,
  installMana,
  installMechanisms,
  installPhysicsObjects,
  installSignals,
  installSpellEmission,
  installSpells,
  installSpellTether,
  installStimuli,
  interacted,
  learnSpell,
  makeSwitch,
  manaOf,
  PlayerLook,
  placeEntity,
  placementOf,
  RapierPhysics,
  RapierSightWorld,
  registerWorldProperties,
  signalOutput,
  signalSystem,
  SpellCast,
  SpellFizzled,
  stimulusSystem,
  switchUsed,
  SwitchComponent,
  TetherReleased,
  World,
  type CancelCastCommand,
  type CastCommand,
  type EntityId,
  type SignalGraphDef,
  type TetherReleaseCommand,
  type TetherUseCommand,
  type Vec3,
} from '@sim/index';

const content = loadGameContent();
const mageHand = content.get('spell', 'mage-hand');

type Input = CastCommand | CancelCastCommand | TetherUseCommand | TetherReleaseCommand;
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

function scene(aim: () => Vec3 = () => v(0, 1.5, -4)) {
  const physics = new RapierPhysics(RAPIER);
  const world = installSignals(
    installStimuli(registerWorldProperties(new World<Input>({ seed: 11, hz: 60, physics }))),
  );
  world.register(...INTERACTION_COMPONENTS, ...DAMAGE_COMPONENTS, PlayerLook);
  installPhysicsObjects(world);
  installMechanisms(world);
  physics.add(box(v(-60, -1, -60), v(60, 0, 60))); // the floor
  const sightWorld = new RapierSightWorld(physics);
  const pipeline = installSpells(world, {
    spells: (id) => (id === 'mage-hand' ? mageHand : undefined),
  });
  installMana(world, pipeline);
  const casting = installCasting(world, pipeline);
  installSpellEmission(world, pipeline);
  const tether = installSpellTether(world, pipeline, {
    casting,
    sight: sightWorld,
    aim: () => aim(),
  });
  world.addSystem(stimulusSystem()).addSystem(signalSystem());
  const caster = world.spawn();
  placeEntity(world, caster, v(0, 0, 0), 0.5);
  addInteractor(world, caster);
  giveMana(world, caster);
  learnSpell(world, caster, 'mage-hand');

  const crate = (at: Vec3, weight = 10): EntityId => {
    const entity = world.spawn();
    addProperties(world, entity, { weight, material: 'wood' });
    addPhysicsObject(world, entity, {
      shape: { kind: 'box', halfExtents: v(0.25, 0.25, 0.25) },
      position: at,
    });
    return entity;
  };
  const lever = (at: Vec3): EntityId => {
    const entity = world.spawn();
    addInteractable(world, entity, { affordances: [{ verb: 'pull' }] }, at);
    makeSwitch(world, entity, 'lever');
    return entity;
  };
  const run = (n: number, inputs: readonly Input[] = []): void => {
    for (let i = 0; i < n; i++) world.step(i === 0 ? inputs : []);
  };
  /** Casts Mage Hand the way the game does (a learned cast: wind-up, then the channel's first tick). */
  const cast = (target: EntityId): void => {
    run(1, [{ type: 'cast', caster, spell: 'mage-hand', target }]);
    run(40); // the 0.4 s wind-up and the first channel tick
  };
  return { world, physics, pipeline, sightWorld, tether, caster, crate, lever, run, cast, casting };
}

const where = (world: World<never>, entity: EntityId): Vec3 => {
  const p = placementOf(world, entity);
  if (p === undefined) throw new Error('no placement');
  return { x: p.x, y: p.y, z: p.z };
};

describe('Mage Hand: the spell file (mw-e08.10)', () => {
  it('AC-1: it validates and loads with a school, a teaching book item and its cues', (ctx) => {
    markExercised(ctx.task, 'spell', 'mage-hand');
    expect(mageHand).toMatchObject({
      id: 'mage-hand',
      school: 'arcane',
      bookId: 'mage-hand',
      vfxCue: 'vfx-spell-mage-hand-tether',
      sfxCue: 'sfx-spell-mage-hand-grab',
      delivery: { kind: 'tether', range: 15 },
      flags: { tooUseful: true },
    });
    const book = content.get('item', 'mage-hand') as ItemDef;
    markExercised(ctx.task, 'item', 'mage-hand');
    if (book.category !== 'book') throw new Error('mage-hand is not a book');
    expect(book.book).toMatchObject({
      kind: 'tome',
      school: 'arcane',
      teaches: { kind: 'spell', spell: { id: 'mage-hand' } },
    });
  });

  it('AC-1: the Scroll of Mage Hand casts Mage Hand', (ctx) => {
    markExercised(ctx.task, 'item', 'scroll-of-mage-hand');
    const scroll = content.get('item', 'scroll-of-mage-hand') as ItemDef;
    if (scroll.category !== 'book') throw new Error('not a book');
    expect(scroll.book.kind).toBe('scroll');
    expect(scroll.book.casts?.id).toBe('mage-hand');
  });

  it('AC-1: it casts in the headless sim, spending its mana and then draining per second', () => {
    const s = scene();
    const crate = s.crate(v(0, 1.5, -4));
    let casts = 0;
    s.world.events.on(SpellCast, () => casts++);
    s.cast(crate);
    expect(casts).toBeGreaterThan(0);
    expect(s.tether.heldBy(s.caster)).toBe(crate);
    const after = manaOf(s.world, s.caster)?.current ?? 0;
    expect(after).toBeLessThan(100 - mageHand.cost.mana + 0.001);
    s.run(120); // two more seconds of the channel
    expect(manaOf(s.world, s.caster)?.current ?? 0).toBeLessThan(after);
    s.run(1, [{ type: 'cancel-cast', caster: s.caster }]);
    expect(s.tether.heldBy(s.caster)).toBeNull();
  });

  it('AC-1: a scroll is a free cast: no learning, no mana, the same tether', () => {
    const s = scene();
    const reader = s.world.spawn(); // knows nothing and has no mana pool
    placeEntity(s.world, reader, v(0, 0, 0), 0.5);
    addInteractor(s.world, reader);
    const crate = s.crate(v(0, 1.5, -4));
    const result = s.pipeline.cast(s.world, {
      caster: reader,
      spell: 'mage-hand',
      source: 'free',
      target: crate,
    });
    expect(result.status).toBe('cast');
    expect(s.tether.heldBy(reader)).toBe(crate);
  });
});

describe('Mage Hand: remote use (mw-e08.10)', () => {
  it('AC-2: a lever 14 m away in plain sight is pulled exactly as a direct interaction pulls it', () => {
    const s = scene();
    const direct = s.lever(v(3, 0, -2));
    const remote = s.lever(v(0, 0, -13)); // anchored 1 m up: its focus point is 14 m out
    const pulls: string[] = [];
    s.world.events.on(switchUsed, (e) =>
      pulls.push(`${String(e.entity)}:${e.kind}:${String(e.position)}:${String(e.source)}`),
    );
    s.world.events.emit(interacted, {
      actor: s.caster,
      target: direct,
      verb: 'pull',
      affordance: 0,
    });
    s.run(1);
    s.cast(remote);
    expect(s.tether.heldBy(s.caster)).toBe(remote);
    s.run(1, [{ type: 'tether-use', caster: s.caster }]);
    expect(pulls).toEqual([
      `${String(direct)}:lever:1:${String(s.caster)}`,
      `${String(remote)}:lever:1:${String(s.caster)}`,
    ]);
    expect(s.world.get(remote, SwitchComponent)).toEqual(s.world.get(direct, SwitchComponent));
  });

  it('AC-2: it needs line of sight: a wall between the caster and the lever stops the grab', () => {
    const s = scene();
    const lever = s.lever(v(0, 0, -10));
    s.physics.add(box(v(-3, 0, -6), v(3, 4, -5.5)));
    const reasons: string[] = [];
    s.world.events.on(SpellFizzled, (e) => reasons.push(e.reason));
    s.run(1, [{ type: 'cast', caster: s.caster, spell: 'mage-hand', target: lever }]);
    s.run(60);
    expect(s.tether.heldBy(s.caster)).toBeNull();
    expect(reasons).toContain('blocked');
    expect(s.world.get(lever, SwitchComponent)?.position).toBe(0);
  });

  it('AC-2: it reaches 15 m and no further', () => {
    const s = scene();
    const far = s.lever(v(0, 0, -17)); // focus point 18 m out
    s.run(1, [{ type: 'cast', caster: s.caster, spell: 'mage-hand', target: far }]);
    s.run(60);
    expect(s.tether.heldBy(s.caster)).toBeNull();
  });
});

describe('Mage Hand: carrying (mw-e08.10)', () => {
  it('AC-3: a light crate follows the aim point within 0.3 m and can be dropped onto a pressure plate', () => {
    let aim = v(0, 1.5, -4);
    const s = scene(() => aim);
    const crate = s.crate(v(0, 1.5, -4), 10);
    const graph: SignalGraphDef = {
      id: 'plate',
      nodes: [
        {
          id: 'plate',
          kind: 'volume',
          shape: { kind: 'box', center: v(5.5, 0.5, -4), halfExtents: v(0.5, 0.5, 0.5) },
          minWeight: 5,
        },
      ],
      wires: [],
    };
    const wired = addSignalGraph(s.world, graph, { bindings: {} });
    s.cast(crate);
    expect(signalOutput(s.world, wired, 'plate', 'active')).toBe(false);
    let worst = 0;
    for (let i = 0; i < 150; i++) {
      aim = v(Math.min(5.5, i * 0.04), 1.5, -4); // 2.4 m/s to the plate
      s.run(1);
      const p = where(s.world, crate);
      worst = Math.max(worst, Math.hypot(p.x - aim.x, p.y - aim.y, p.z - aim.z));
    }
    expect(worst).toBeLessThanOrEqual(0.3);
    expect(signalOutput(s.world, wired, 'plate', 'active')).toBe(false); // held above it
    s.run(1, [{ type: 'tether-release', caster: s.caster }]);
    s.run(120);
    expect(where(s.world, crate).y).toBeLessThan(0.4);
    expect(signalOutput(s.world, wired, 'plate', 'active')).toBe(true);
  });

  it('AC-4: a crate above the weight limit is not lifted, and ForceResisted fires', () => {
    const s = scene();
    const boulder = s.crate(v(0, 0.25, -4), 90);
    const resisted: number[] = [];
    s.world.events.on(ForceResisted, (e) => resisted.push(e.weight));
    s.run(1, [{ type: 'cast', caster: s.caster, spell: 'mage-hand', target: boulder }]);
    s.run(60);
    expect(resisted).toEqual([90]);
    expect(s.tether.heldBy(s.caster)).toBeNull();
    expect(where(s.world, boulder).y).toBeLessThan(0.3);
  });

  it('AC-5: a held crate swept through a creature at low speed deals it no damage', () => {
    let aim = v(0, 1, -3);
    const s = scene(() => aim);
    const crate = s.crate(v(0, 1, -3));
    const creature = s.world.spawn();
    giveCombatant(s.world, creature, { health: 50 });
    addProperties(s.world, creature, {});
    placeEntity(s.world, creature, v(2, 0, -3), 0.5);
    s.cast(crate);
    for (let i = 0; i < 120; i++) {
      aim = v(i * 0.04, 1, -3); // right through the creature at 2.4 m/s
      s.run(1);
    }
    expect(where(s.world, crate).x).toBeGreaterThan(3);
    expect(healthOf(s.world, creature)?.current).toBe(50);
  });
});

describe('Mage Hand: sight and release (mw-e08.10)', () => {
  it('AC-6: the object is dropped once line of sight has been broken for more than 0.5 s', () => {
    const s = scene();
    const crate = s.crate(v(0, 1.5, -4));
    const reasons: string[] = [];
    s.world.events.on(TetherReleased, (e) => reasons.push(e.reason));
    s.cast(crate);
    s.physics.add(box(v(-3, 0, -2.5), v(3, 4, -2)));
    s.run(31);
    expect(s.tether.heldBy(s.caster)).toBe(crate);
    s.run(2);
    expect(s.tether.heldBy(s.caster)).toBeNull();
    expect(reasons).toEqual(['line-of-sight']);
    s.run(90);
    expect(where(s.world, crate).y).toBeLessThan(0.4);
  });
});
