// Cuttable ropes, what hangs from them and shootable targets (mw-e05.13). Bodies run on the real
// deterministic Rapier build; arrows and strikes arrive as the events and stimuli they really are.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { arrowImpact, type ArrowImpactInfo } from '../combat/arrows/events';
import { box } from '../character/greybox';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import {
  PhysicsObjectComponent,
  addPhysicsObject,
  installPhysicsObjects,
  removePhysicsObject,
} from '../physics/objects';
import { RapierPhysics } from '../physics/rapier';
import { InMemoryColliderSink } from '../physics/static-colliders';
import {
  addProperties,
  hasProperty,
  readProperty,
  registerWorldProperties,
  setProperty,
} from '../properties/components';
import type { SceneSpec } from '../scene/layout';
import { loadScene, registerSceneComponents } from '../scene/loader';
import { installSignals, signalSystem } from '../signals/runtime';
import type { StimulusShape, Vec3 } from '../stimulus/shapes';
import { applyStimulus, installStimuli, stimulusSystem } from '../stimulus/stimulus';
import {
  deliverImpact,
  ImpactSwitchComponent,
  impactSwitchChanged,
  makeImpactSwitch,
  makeShootable,
  passesFilter,
  type Impact,
} from './impacts';
import {
  CuttableComponent,
  makeCuttable,
  releaseSuspended,
  severCuttable,
  SuspendedComponent,
  suspendFrom,
  suspensionReleased,
  type SuspensionReleased,
} from './ropes';
import { addSceneMechanisms } from './scene';
import { SupportComponent } from './supports';
import { installMechanisms } from './system';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

function rig() {
  const physics = new RapierPhysics(RAPIER);
  const world = installSignals(
    installStimuli(registerWorldProperties(new World<never>({ seed: 5, hz: 60, physics }))),
  );
  installPhysicsObjects(world);
  physics.add(box(v(-20, -1, -20), v(20, 0, 20)));
  world.addSystem(stimulusSystem()).addSystem(signalSystem());
  installMechanisms(world);
  const released: SuspensionReleased[] = [];
  world.events.on(suspensionReleased, (e) => released.push(e));
  const steps = (n: number) => {
    for (let i = 0; i < n; i++) world.step();
  };
  /** A rope from (0, 4) down 2 m with a 20 kg weight hanging from its end. */
  const hang = () => {
    const rope = world.spawn();
    makeCuttable(world, rope, v(0, 4, 0), 2);
    const weight = world.spawn();
    addProperties(world, weight, { weight: 20 });
    world.step();
    addPhysicsObject(world, weight, {
      shape: { kind: 'box', halfExtents: v(0.3, 0.2, 0.3) },
      position: v(0, 1.8, 0),
    });
    world.step();
    suspendFrom(world, weight, rope);
    world.step();
    return { rope, weight };
  };
  const heightOf = (e: EntityId) => world.get(e, PhysicsObjectComponent)?.position.y ?? NaN;
  const cut = (
    element: 'slash' | 'pierce' | 'blunt' | 'force',
    shape: StimulusShape,
    source: EntityId | null = null,
  ) => {
    applyStimulus(world, { shape, element, intensity: 10, source });
    world.step();
  };
  return { world, released, steps, hang, heightOf, cut };
}

describe('cuttable ropes (mw-e05.13)', () => {
  it('holds what hangs from it, and a cutting contact frees it to fall', () => {
    const r = rig();
    const { rope, weight } = r.hang();
    r.steps(60);
    expect(r.heightOf(weight)).toBeCloseTo(1.8, 2);
    expect(readProperty(r.world, weight, 'suspended')).toBe(true);
    r.cut('pierce', { kind: 'contact', target: rope }, 9);
    r.steps(60);
    expect(r.world.isAlive(rope)).toBe(false);
    expect(r.released).toMatchObject([{ entity: weight, support: rope, source: 9 }]);
    expect(readProperty(r.world, weight, 'suspended')).toBe(false);
    expect(r.world.has(weight, SuspendedComponent)).toBe(false);
    expect(r.heightOf(weight)).toBeLessThan(1);
  });

  it('is cut by a slash or pierce that reaches it along its length, not by one that misses', () => {
    const r = rig();
    const { rope, weight } = r.hang();
    r.cut('slash', { kind: 'sphere', center: v(2, 3, 0), radius: 0.5 }); // 2 m away
    r.steps(5);
    expect(r.world.isAlive(rope)).toBe(true);
    r.cut('slash', { kind: 'sphere', center: v(0.3, 3.1, 0), radius: 0.5 }); // reaches the middle
    r.steps(5);
    expect(r.world.isAlive(rope)).toBe(false);
    expect(r.released).toMatchObject([{ entity: weight }]);
  });

  it('is not cut by blunt or force, nor by a cut with nothing in it', () => {
    const r = rig();
    const { rope, weight } = r.hang();
    r.cut('blunt', { kind: 'contact', target: rope });
    r.cut('force', { kind: 'contact', target: rope });
    r.world.events.emit(arrowImpact, { position: v(0, 3, 0) } as ArrowImpactInfo);
    applyStimulus(r.world, {
      shape: { kind: 'contact', target: rope },
      element: 'pierce',
      intensity: 0,
    });
    r.steps(5);
    expect(r.world.isAlive(rope)).toBe(true);
    expect(r.released).toEqual([]);
    expect(readProperty(r.world, weight, 'suspended')).toBe(true);
  });

  it('cannot be cut once its cuttable property is false, and only a cut once', () => {
    const r = rig();
    const { rope } = r.hang();
    setProperty(r.world, rope, 'cuttable', false);
    expect(severCuttable(r.world, rope)).toBe(false);
    setProperty(r.world, rope, 'cuttable', true);
    expect(severCuttable(r.world, rope, 4)).toBe(true);
    expect(severCuttable(r.world, rope, 4)).toBe(false); // already going
    expect(severCuttable(r.world, r.world.spawn())).toBe(false); // not a rope
    r.steps(2);
    expect(r.released).toHaveLength(1);
  });

  it('frees what it held when it burns away (destroyed), blaming no one', () => {
    const r = rig();
    const { rope, weight } = r.hang();
    r.world.destroy(rope); // a burnt rope is destroyed (mw-e03.5)
    r.steps(60);
    expect(r.released).toMatchObject([{ entity: weight, source: null }]);
    expect(r.heightOf(weight)).toBeLessThan(1);
  });

  it('lets go when `suspended` is turned off by anything else', () => {
    const r = rig();
    const { weight } = r.hang();
    setProperty(r.world, weight, 'suspended', false);
    r.steps(2);
    expect(r.released).toHaveLength(1);
    expect(r.world.has(weight, SuspendedComponent)).toBe(false);
    expect(releaseSuspended(r.world, weight)).toBe(false);
  });

  it('trips a counterweight when its rope is cut, whatever its filter says', () => {
    const r = rig();
    const { rope, weight } = r.hang();
    makeImpactSwitch(r.world, weight, v(0, 1.8, 0), 'counterweight');
    r.steps(1);
    const changes: boolean[] = [];
    r.world.events.on(impactSwitchChanged, (e) => changes.push(e.active));
    r.cut('pierce', { kind: 'contact', target: rope });
    r.steps(1);
    expect(r.world.get(weight, ImpactSwitchComponent)?.active).toBe(true);
    expect(changes).toEqual([true]);
  });

  it('keeps the cuttable property its entity already has', () => {
    const r = rig();
    const rope = r.world.spawn();
    addProperties(r.world, rope, { cuttable: false });
    r.steps(1);
    makeCuttable(r.world, rope, v(0, 3, 0), 1);
    r.steps(1);
    expect(readProperty(r.world, rope, 'cuttable')).toBe(false);
    expect(severCuttable(r.world, rope)).toBe(false);
  });

  it('cutting one rope leaves what hangs from another, and a body removed from physics hangs on', () => {
    const r = rig();
    const a = r.hang();
    const b = r.hang();
    removePhysicsObject(r.world, b.weight);
    r.steps(2);
    expect(severCuttable(r.world, a.rope)).toBe(true);
    r.steps(2);
    expect(r.released.map((e) => e.entity)).toEqual([a.weight]);
    expect(r.world.has(b.weight, SuspendedComponent)).toBe(true);
    expect(r.world.has(b.weight, PhysicsObjectComponent)).toBe(false);
  });

  it('a rope with a sink gets a thin collider that goes with it', () => {
    const r = rig();
    const sink = new InMemoryColliderSink();
    const rope = r.world.spawn();
    makeCuttable(r.world, rope, v(1, 3, 1), 1.5, { radius: 0.1, colliders: sink });
    r.steps(1);
    expect(r.world.get(rope, CuttableComponent)?.collider).not.toBeNull();
    expect(hasProperty(r.world, rope, 'cuttable')).toBe(true);
  });

  it('refuses a rope without length or thickness, and hanging what has no body', () => {
    const r = rig();
    const e = r.world.spawn();
    expect(() => {
      makeCuttable(r.world, e, v(0, 3, 0), 0);
    }).toThrow(RangeError);
    expect(() => {
      makeCuttable(r.world, e, v(0, 3, 0), 1, { radius: 0 });
    }).toThrow(RangeError);
    expect(() => {
      suspendFrom(r.world, e, e);
    }).toThrow('not a physics object');
  });
});

const withoutImpulse = (impact: Impact): Impact => {
  const rest: { -readonly [K in keyof Impact]?: Impact[K] } = { ...impact };
  delete rest.impulse;
  return rest as Impact;
};

describe('shootable targets (mw-e05.13)', () => {
  const hit = (over: Partial<Impact> = {}): Impact => ({
    position: v(0, 2, 0),
    energy: 40,
    impulse: 1.5,
    damageType: 'pierce',
    element: null,
    source: null,
    ...over,
  });

  function target(shootable: number) {
    const r = rig();
    const e = r.world.spawn();
    addProperties(r.world, e, { shootable });
    r.steps(1);
    makeShootable(r.world, e, v(0, 2, 0));
    r.steps(1);
    return { ...r, e, on: () => r.world.get(e, ImpactSwitchComponent)?.active };
  }

  it('AC-4: an impact below the threshold impulse emits no signal', () => {
    const t = target(1);
    const changes: boolean[] = [];
    t.world.events.on(impactSwitchChanged, (e) => changes.push(e.active));
    expect(deliverImpact(t.world, hit({ impulse: 0.99 }))).toBe(0);
    expect(deliverImpact(t.world, hit({ impulse: null }))).toBe(0);
    const bare = withoutImpulse(hit());
    expect(deliverImpact(t.world, bare)).toBe(0); // a source that reports none
    t.steps(2);
    expect(changes).toEqual([]);
    expect(t.on()).toBe(false);
  });

  it('fires, for good, on any projectile at or above the threshold', () => {
    const t = target(1);
    expect(deliverImpact(t.world, hit({ impulse: 1, damageType: 'blunt' }))).toBe(1);
    expect(t.on()).toBe(true);
    t.steps(300);
    expect(t.on()).toBe(true);
    expect(t.world.get(t.e, ImpactSwitchComponent)).toMatchObject({
      variant: 'target',
      minImpulse: 1,
    });
  });

  it('a force stimulus carries its amount as impulse, a spark carries none', () => {
    const t = target(5);
    t.cut('slash', { kind: 'point', at: v(0, 2, 0) });
    expect(t.on()).toBe(false);
    applyStimulus(t.world, {
      shape: { kind: 'sphere', center: v(0, 2, 0), radius: 1 },
      element: 'force',
      intensity: 4,
      direction: v(1, 0, 0),
    });
    t.steps(1);
    expect(t.on()).toBe(false);
    applyStimulus(t.world, {
      shape: { kind: 'sphere', center: v(0, 2, 0), radius: 1 },
      element: 'force',
      intensity: 8,
      direction: v(1, 0, 0),
    });
    t.steps(1);
    expect(t.on()).toBe(true);
  });

  it('a filter without minImpulse takes any impulse', () => {
    const filter = { minEnergy: 0, damageTypes: ['pierce'], elements: [] } as const;
    const bare = withoutImpulse(hit());
    expect(passesFilter(filter, bare)).toBe(true);
    expect(passesFilter({ ...filter, minImpulse: 2 }, hit({ impulse: 1.5 }))).toBe(false);
  });

  it('needs the shootable property, and a sane impulse', () => {
    const r = rig();
    const e = r.world.spawn();
    expect(() => {
      makeShootable(r.world, e, v(0, 2, 0));
    }).toThrow('no shootable property');
    expect(() => {
      makeImpactSwitch(r.world, e, v(0, 2, 0), 'target', { minImpulse: -1 });
    }).toThrow(RangeError);
  });
});

describe('scene authoring (mw-e05.13)', () => {
  const kit = () => undefined;
  const SCENE = (spawns: unknown[]) =>
    ({ id: 'range', grid: 1, placements: [], spawns, signals: [] }) as unknown as SceneSpec;

  function load(spawns: unknown[]) {
    const world = installSignals(
      installStimuli(
        registerWorldProperties(registerSceneComponents(new World<never>({ seed: 2 }))),
      ),
    );
    installMechanisms(world);
    const loaded = loadScene(world, SCENE(spawns), kit, new InMemoryColliderSink());
    return { world, loaded };
  }
  const options = { doors: () => undefined, locks: () => undefined, graphs: () => undefined };

  it('a spawn with the shootable property is a target of that threshold, and a bell keeps its prefab', () => {
    const { world, loaded } = load([
      { id: 'plain', at: [0, 2, 0], yaw: 0, tags: [] },
      { id: 'gong', at: [2, 2, 0], yaw: 0, tags: [], impactSwitch: { variant: 'bell' } },
    ]);
    const [plain, gong] = loaded.spawns.map((s) => s.entity) as [EntityId, EntityId];
    addProperties(world, plain, { shootable: 2 });
    addProperties(world, gong, { shootable: 0.5 });
    const made = addSceneMechanisms(world, loaded, options);
    expect(made.impactSwitches).toEqual([plain, gong]);
    expect(world.get(plain, ImpactSwitchComponent)).toMatchObject({
      variant: 'target',
      minImpulse: 2,
    });
    expect(world.get(gong, ImpactSwitchComponent)).toMatchObject({
      variant: 'bell',
      minImpulse: 0.5,
    });
  });

  it('a rope spawn is a cuttable rope with its own radius', () => {
    const { world, loaded } = load([
      { id: 'cord', at: [0, 3, 0], yaw: 0, tags: [], rope: { length: 2, radius: 0.1 } },
      { id: 'line', at: [1, 3, 0], yaw: 0, tags: [], rope: { length: 1 } },
    ]);
    const made = addSceneMechanisms(world, loaded, options);
    expect(made.ropes).toEqual(loaded.spawns.map((s) => s.entity));
    const [cord, line] = made.ropes as [EntityId, EntityId];
    expect(world.get(cord, CuttableComponent)).toMatchObject({ length: 2, radius: 0.1 });
    expect(world.get(line, CuttableComponent)?.radius).toBe(0.05);
    expect(readProperty(world, cord, 'cuttable')).toBe(true);
  });

  it('a rope spawn gets its collider in the sink the game gives', () => {
    const physics = new RapierPhysics(RAPIER);
    const world = installSignals(
      installStimuli(
        registerWorldProperties(
          registerSceneComponents(new World<never>({ seed: 2, hz: 60, physics })),
        ),
      ),
    );
    installPhysicsObjects(world);
    installMechanisms(world);
    const loaded = loadScene(
      world,
      SCENE([{ id: 'cord', at: [0, 3, 0], yaw: 0, tags: [], rope: { length: 2 } }]),
      kit,
      new InMemoryColliderSink(),
    );
    const made = addSceneMechanisms(world, loaded, { ...options, colliders: physics });
    const [cord] = made.ropes as [EntityId];
    expect(world.get(cord, CuttableComponent)?.collider).not.toBeNull();
  });

  it('mw-e03.13: a rope spawn with support is a support, its ends in metres, its span linked', () => {
    const { world, loaded } = load([
      {
        id: 'left',
        at: [0, 2, 0],
        yaw: 0,
        tags: [],
        rope: {
          to: [4, 2, 0],
          radius: 0.08,
          support: { rating: 150, resistances: { pierce: 0.3 }, span: 'bridge' },
        },
      },
      {
        id: 'right',
        at: [0, 2, 1],
        yaw: 0,
        tags: [],
        rope: { to: [4, 2, 1], support: { span: 'bridge' } },
      },
      { id: 'chain', at: [0, 5, 3], yaw: 0, tags: [], rope: { length: 2, support: {} } },
    ]);
    const made = addSceneMechanisms(world, loaded, options);
    const [left, right, chain] = made.ropes as [EntityId, EntityId, EntityId];
    expect(world.get(left, SupportComponent)).toMatchObject({
      from: { x: 0, y: 2, z: 0 },
      to: { x: 4, y: 2, z: 0 },
      radius: 0.08,
      rating: 150,
      resistances: { pierce: 0.3 },
      peers: [right],
    });
    expect(world.get(right, SupportComponent)).toMatchObject({ rating: null, peers: [left] });
    expect(world.get(chain, SupportComponent)).toMatchObject({
      to: { x: 0, y: 3, z: 3 },
      peers: [],
    });
    expect(world.has(left, CuttableComponent)).toBe(false);
  });

  it('mw-e03.13: a support spawn gets its collider in the sink the game gives', () => {
    const physics = new RapierPhysics(RAPIER);
    const world = installSignals(
      installStimuli(
        registerWorldProperties(
          registerSceneComponents(new World<never>({ seed: 2, hz: 60, physics })),
        ),
      ),
    );
    installPhysicsObjects(world);
    installMechanisms(world);
    const loaded = loadScene(
      world,
      SCENE([{ id: 'cord', at: [0, 3, 0], yaw: 0, tags: [], rope: { length: 2, support: {} } }]),
      kit,
      new InMemoryColliderSink(),
    );
    const made = addSceneMechanisms(world, loaded, { ...options, colliders: physics });
    const [cord] = made.ropes as [EntityId];
    expect(world.get(cord, SupportComponent)?.collider).not.toBeNull();
  });

  it('a prop that hangs from a rope spawn the scene does not have is an error', () => {
    const { world, loaded } = load([
      { id: 'lamp', at: [0, 1, 0], yaw: 0, tags: [], suspendedFrom: 'nowhere' },
    ]);
    expect(() => addSceneMechanisms(world, loaded, options)).toThrow(
      'hangs from "nowhere", which the scene does not have',
    );
  });
});
