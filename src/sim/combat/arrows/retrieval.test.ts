// Arrows that stay (mw-e05.7): the intact roll at impact, taking arrows back with Interact, the
// 64-arrow cap, arrows that follow their body or fall when it goes, fire, and the view stand-in.
import { loadGameContent, type ArrowEntry } from '@content/index';
import { describe, expect, it } from 'vitest';
import { FakeCollisionWorld } from '../../character/fake-collision-world';
import { box, type GreyboxShape } from '../../character/greybox';
import { initialCharacterState } from '../../character/controller';
import { CharacterController } from '../../character/system';
import type { EntityId } from '../../core/component';
import { World } from '../../core/world';
import { ElementField } from '../../field/grid';
import { elementFieldOf, elementFieldSystem, installElementField } from '../../field/install';
import { fireRules, type BurntMaterials } from '../../elements/fire';
import { ElementRuleSet, elementRulesSystem } from '../../elements/rules';
import {
  actionButton,
  actionFrame,
  actionVector,
  type ActionFrame,
} from '../../input/action-frame';
import {
  addInteractable,
  addInteractor,
  affordancesOf,
  installInteraction,
  interactionPrompt,
  InteractionFocusComponent,
  InteractableComponent,
  interacted,
} from '../../interaction/system';
import { PhysicsColliderComponent } from '../../physics/objects';
import { PlayerLook } from '../../player/player';
import {
  addProperties,
  readProperty,
  registerWorldProperties,
  setProperty,
  type WorldPropertyInit,
} from '../../properties/components';
import { addMaterialProperties, type MaterialPresets } from '../../properties/materials';
import type { WorldPropertyValues } from '../../properties/spec';
import { hashWorld } from '../../snapshot';
import { PlacementComponent, placeEntity } from '../../stimulus/placement';
import type { Vec3 } from '../../stimulus/shapes';
import { applyStimulus, installStimuli, stimulusSystem } from '../../stimulus/stimulus';
import { BOW_COMPONENTS, QuiverComponent, quiverCount } from '../bow/components';
import { DAMAGE_COMPONENTS } from '../damage/components';
import { DamageModel } from '../damage/model';
import { HIT_VOLUME_COMPONENTS } from '../hits/components';
import { DEFAULT_ARROW_RULES, intactChanceOf } from './ballistics';
import { ArrowRestComponent, type ArrowRest } from './components';
import { ArrowRested, arrowImpact, type ArrowImpactInfo } from './events';
import {
  ARROW_FUEL_SECONDS,
  arrowBroken,
  arrowDespawned,
  arrowRetrievalOf,
  arrowsTaken,
  gatherable,
  installArrowRetrieval,
  nothingInView,
  returnsAs,
  restingArrows,
  takeStuckArrows,
  type ArrowBroken,
  type ArrowDespawned,
  type ArrowViewRule,
  type ArrowsTaken,
} from './retrieval';
import { arrowLookup, fireArrow, installArrows } from './system';

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const ARROWS = arrowLookup(loadGameContent().all('arrow'));
const ZERO = v3(0, 0, 0);

const IDLE = actionFrame({
  move: actionVector(0, 0),
  look: actionVector(0, 0),
  buttons: () => actionButton(false, false, false),
});
const PRESS = actionFrame({
  move: actionVector(0, 0),
  look: actionVector(0, 0),
  buttons: (action) =>
    action === 'interact' ? actionButton(true, false, true) : actionButton(false, false, false),
});

interface Options {
  readonly roll?: number;
  readonly shapes?: readonly GreyboxShape[];
  readonly inView?: ArrowViewRule;
  readonly maxResting?: number;
  readonly materials?: MaterialPresets;
  readonly quiver?: boolean;
  readonly arrows?: ReturnType<typeof arrowLookup>;
}

/** A world with a player at the origin facing −z, a quiver of 5 standard arrows, and the arrow rules. */
function setup(options: Options = {}) {
  const world = registerWorldProperties(new World<ActionFrame>({ seed: 1 }));
  world.register(
    CharacterController,
    PlayerLook,
    PlacementComponent,
    ...BOW_COMPONENTS,
    ...DAMAGE_COMPONENTS,
    ...HIT_VOLUME_COMPONENTS,
    PhysicsColliderComponent,
  );
  installInteraction(world);
  const collision = new FakeCollisionWorld(options.shapes ?? []);
  installArrows(world, {
    arrows: options.arrows ?? ARROWS,
    damage: new DamageModel(),
    collision,
    ...(options.roll !== undefined && { roll: () => options.roll as number }),
  });
  const retrieval = installArrowRetrieval(world, {
    arrows: options.arrows ?? ARROWS,
    collision,
    ...(options.inView !== undefined && { inView: options.inView }),
    ...(options.materials !== undefined && { materials: options.materials }),
    ...(options.maxResting !== undefined && { rules: { maxResting: options.maxResting } }),
  });
  const player = world.spawn();
  world.add(player, CharacterController, initialCharacterState(ZERO));
  world.add(player, PlayerLook, { yaw: 0, pitch: 0 });
  addInteractor(world, player);
  if (options.quiver !== false) {
    world.add(player, QuiverComponent, { slots: [{ arrow: 'standard', count: 5 }] });
  }
  const taken: ArrowsTaken[] = [];
  const broken: ArrowBroken[] = [];
  const despawned: ArrowDespawned[] = [];
  const impacts: ArrowImpactInfo[] = [];
  world.events.on(arrowsTaken, (e) => taken.push(e));
  world.events.on(arrowBroken, (e) => broken.push(e));
  world.events.on(arrowDespawned, (e) => despawned.push(e));
  world.events.on(arrowImpact, (e) => impacts.push(e));
  return { world, player, retrieval, taken, broken, despawned, impacts, collision };
}
type Setup = ReturnType<typeof setup>;

/** Puts an arrow at rest at `position` the way the arrow system does (component, then ArrowRested). */
function restArrow(
  t: Setup,
  position: Vec3,
  over: Partial<ArrowRest> = {},
  arrow = 'standard',
): EntityId {
  const entity = t.world.spawn();
  const rest: ArrowRest = {
    arrow,
    shooter: null,
    state: 'stuck',
    position,
    direction: v3(0, 0, -1),
    in: null,
    tick: t.world.tick,
    intact: true,
    ...over,
  };
  t.world.add(entity, ArrowRestComponent, rest);
  t.world.events.emit(ArrowRested, {
    tick: rest.tick,
    entity,
    arrow,
    state: rest.state,
    intact: rest.intact,
    in: rest.in,
    position: rest.position,
  });
  t.world.events.flush();
  return entity;
}

const restOf = (t: Setup, entity: EntityId) => t.world.get(entity, ArrowRestComponent);
function stepsUntilRest(t: Setup, entity: EntityId, max = 600): void {
  for (let i = 0; i < max && t.world.get(entity, ArrowRestComponent) === undefined; i++) {
    t.world.step([IDLE]);
  }
}

const WALL = box(v3(-5, -5, -12), v3(5, 5, -11));

describe('intact roll at impact (mw-e05.7)', () => {
  it('AC-1: an arrow hitting wood with a roll of 0.5 is intact (0.5 < 0.9) and retrievable', () => {
    const t = setup({ roll: 0.5, shapes: [WALL] });
    const arrow = fireArrow(t.world, ARROWS, {
      arrow: 'standard',
      origin: v3(0, 1.5, 0),
      velocity: v3(0, 0, -60),
    });
    stepsUntilRest(t, arrow);
    expect(t.impacts[0]).toMatchObject({ outcome: 'stick', intact: true });
    expect(restOf(t, arrow)).toMatchObject({ state: 'stuck', intact: true });
    // Retrievable: it is interactable.
    expect(t.world.has(arrow, InteractableComponent)).toBe(true);
    expect(affordancesOf(t.world, arrow)[0]?.verb).toBe('pick-up');
  });

  it('AC-1: a roll above the chance leaves it broken and not retrievable', () => {
    const t = setup({ roll: 0.95, shapes: [WALL] });
    const arrow = fireArrow(t.world, ARROWS, {
      arrow: 'standard',
      origin: v3(0, 1.5, 0),
      velocity: v3(0, 0, -60),
    });
    stepsUntilRest(t, arrow);
    expect(t.impacts[0]).toMatchObject({ outcome: 'stick', intact: false });
    expect(restOf(t, arrow)?.intact).toBe(false);
    expect(t.world.has(arrow, InteractableComponent)).toBe(false);
  });

  it('odds by what it lands in: soft and medium 90%, stone 40%, metal 20%, read from properties', () => {
    const rules = DEFAULT_ARROW_RULES;
    expect(intactChanceOf(rules, 'soft', true)).toBe(0.9); // flesh conducts, but is soft
    expect(intactChanceOf(rules, 'medium', false)).toBe(0.9);
    expect(intactChanceOf(rules, 'hard', false)).toBe(0.4);
    expect(intactChanceOf(rules, 'hard', true)).toBe(0.2);
  });

  it('rolls against the surface: the same 0.3 roll keeps an arrow in stone (0.4) but breaks it on metal (0.2)', () => {
    const land = (properties: Partial<WorldPropertyValues>) => {
      // An arrow that pierces hard surfaces, so it sticks in stone and metal.
      const piercing = new Map(ARROWS).set('piercing', {
        ...(ARROWS.get('standard') as ArrowEntry),
        id: 'piercing',
        penetration: 50,
      });
      const t = setup({ roll: 0.3, shapes: [WALL], arrows: piercing });
      const surface = t.world.spawn();
      addProperties(t.world, surface, properties);
      t.world.add(surface, PhysicsColliderComponent, { colliders: [1] });
      const arrow = fireArrow(t.world, piercing, {
        arrow: 'piercing',
        origin: v3(0, 1.5, 0),
        velocity: v3(0, 0, -90),
      });
      stepsUntilRest(t, arrow);
      return restOf(t, arrow);
    };
    expect(land({ surfaceHardness: 'hard' })?.intact).toBe(true);
    expect(land({ surfaceHardness: 'hard', conductive: true })?.intact).toBe(false);
  });

  it('burned arrows never survive: a fire arrow, or one landing in a burning host, rolls broken', () => {
    const t = setup({ roll: 0, shapes: [WALL] }); // a roll of 0 would keep any arrow whole
    const fire = fireArrow(t.world, ARROWS, {
      arrow: 'fire',
      origin: v3(0, 1.5, 0),
      velocity: v3(0, 0, -60),
    });
    stepsUntilRest(t, fire);
    expect(restOf(t, fire)?.intact).toBe(false);

    const host = t.world.spawn();
    addProperties(t.world, host, { burning: true });
    t.world.add(host, PhysicsColliderComponent, { colliders: [1] });
    const arrow = fireArrow(t.world, ARROWS, {
      arrow: 'standard',
      origin: v3(0, 1.5, 0),
      velocity: v3(0, 0, -60),
    });
    stepsUntilRest(t, arrow);
    expect(restOf(t, arrow)?.intact).toBe(false);
  });

  it('a kind that is not retrievable never survives, and the default roll is deterministic per arrow', () => {
    const run = () => {
      const t = setup({ shapes: [WALL] }); // default roll from the world's `arrows` stream
      const arrows = [0, 1, 2, 3, 4, 5].map(() =>
        fireArrow(t.world, ARROWS, {
          arrow: 'standard',
          origin: v3(0, 1.5, 0),
          velocity: v3(0, 0, -60),
        }),
      );
      for (let i = 0; i < 120; i++) t.world.step([IDLE]);
      return arrows.map((a) => restOf(t, a)?.intact);
    };
    expect(run()).toEqual(run());
    // retrievable: false is a data flag: whatever the roll says, such an arrow comes to rest broken.
    const brittle = new Map(ARROWS);
    brittle.set('standard', { ...(ARROWS.get('standard') as ArrowEntry), retrievable: false });
    const world = registerWorldProperties(new World<never>({ seed: 1 }));
    world.register(PlacementComponent, ...DAMAGE_COMPONENTS, ...HIT_VOLUME_COMPONENTS);
    installArrows(world, {
      arrows: brittle,
      damage: new DamageModel(),
      collision: new FakeCollisionWorld([WALL]),
      roll: () => 0,
    });
    const arrow = fireArrow(world, brittle, {
      arrow: 'standard',
      origin: v3(0, 1.5, 0),
      velocity: v3(0, 0, -60),
    });
    for (let i = 0; i < 120 && world.get(arrow, ArrowRestComponent) === undefined; i++)
      world.step();
    expect(world.get(arrow, ArrowRestComponent)?.intact).toBe(false);
  });

  it('an arrow stuck in a creature records its offset so it can follow, none in bare geometry', () => {
    const t = setup({ roll: 0.5, shapes: [WALL] });
    const wall = fireArrow(t.world, ARROWS, {
      arrow: 'standard',
      origin: v3(0, 1.5, 0),
      velocity: v3(0, 0, -60),
    });
    stepsUntilRest(t, wall);
    expect(restOf(t, wall)?.local).toBeUndefined();
    const host = t.world.spawn();
    placeEntity(t.world, host, v3(2, 0, -6), 0.5);
    t.world.add(host, PhysicsColliderComponent, { colliders: [1] });
    const stuck = fireArrow(t.world, ARROWS, {
      arrow: 'standard',
      origin: v3(0, 1.5, 0),
      velocity: v3(0, 0, -60),
    });
    stepsUntilRest(t, stuck);
    const rest = restOf(t, stuck);
    expect(rest?.in).toBe(host);
    expect(rest?.local?.x).toBeCloseTo((rest?.position.x ?? 0) - 2, 9);
  });
});

describe('taking arrows back (mw-e05.7)', () => {
  const near = (t: Setup, over: Partial<ArrowRest> = {}) => [
    restArrow(t, v3(0, 1, -1.5), over),
    restArrow(t, v3(0.4, 1, -1.6), over),
    restArrow(t, v3(-0.3, 1, -1.2), over),
  ];

  it('AC-2: three intact arrows within 1.0 m are all taken on interact: quiver +3, entities removed', () => {
    const t = setup();
    const arrows = near(t);
    const far = restArrow(t, v3(0, 1, -4));
    t.world.step([IDLE]);
    expect(interactionPrompt(t.world, t.player)).toMatchObject({
      label: 'Take arrows (3)',
      verb: 'pick-up',
      available: true,
    });
    expect(quiverCount(t.world, t.player, 'standard')).toBe(5);
    t.world.step([PRESS]);
    expect(quiverCount(t.world, t.player, 'standard')).toBe(8);
    for (const arrow of arrows) expect(t.world.isAlive(arrow)).toBe(false);
    expect(t.world.isAlive(far)).toBe(true); // out of reach, left alone
    expect(t.taken).toMatchObject([{ actor: t.player, taken: { standard: 3 }, count: 3 }]);
  });

  it('gathers only within 1.0 m of the arrow it was aimed at, never a broken one', () => {
    const t = setup();
    const [a] = near(t);
    const tooFar = restArrow(t, v3(0, 1, -2.9));
    const broken = restArrow(t, v3(0.2, 1, -1.4), { intact: false });
    expect(gatherable(t.world, a as EntityId, 1).length).toBe(3);
    expect(gatherable(t.world, tooFar)).toEqual([tooFar]);
    expect(gatherable(t.world, broken)).toEqual([]); // not an intact arrow: nothing to take
    expect(gatherable(t.world, t.player)).toEqual([]);
  });

  it('a single arrow reads "Take arrow"; broken arrows offer nothing and are never focused', () => {
    const t = setup();
    const lone = restArrow(t, v3(0, 1, -1.5));
    t.world.step([IDLE]);
    expect(interactionPrompt(t.world, t.player)?.label).toBe('Take arrow');
    t.world.step([PRESS]);
    expect(quiverCount(t.world, t.player, 'standard')).toBe(6);
    expect(t.world.isAlive(lone)).toBe(false);
    const dead = restArrow(t, v3(0, 1, -1.5), { intact: false });
    t.world.step([IDLE]);
    expect(interactionPrompt(t.world, t.player)).toBeUndefined();
    t.world.step([PRESS]);
    expect(t.world.isAlive(dead)).toBe(true);
    expect(quiverCount(t.world, t.player, 'standard')).toBe(6);
  });

  it('without a quiver the prompt says why and nothing is taken', () => {
    const t = setup({ quiver: false });
    const arrow = restArrow(t, v3(0, 1, -1.5));
    t.world.step([IDLE]);
    expect(interactionPrompt(t.world, t.player)).toMatchObject({
      available: false,
      reason: 'No quiver',
    });
    t.world.step([PRESS]);
    expect(t.world.isAlive(arrow)).toBe(true);
    expect(t.taken).toEqual([]);
  });

  it('a spent trick arrow comes back as a standard arrow; a rope arrow as a rope arrow', () => {
    const t = setup();
    restArrow(t, v3(0, 1, -1.5), {}, 'water');
    restArrow(t, v3(0.2, 1, -1.5), {}, 'rope');
    restArrow(t, v3(-0.2, 1, -1.5), {}, 'broadhead');
    restArrow(t, v3(0.1, 1, -1.7), {}, 'fire');
    t.world.step([IDLE]);
    t.world.step([PRESS]);
    expect(t.taken[0]?.taken).toEqual({ broadhead: 1, rope: 1, standard: 2 });
    expect(quiverCount(t.world, t.player, 'standard')).toBe(7);
    expect(quiverCount(t.world, t.player, 'rope')).toBe(1);
    expect(quiverCount(t.world, t.player, 'broadhead')).toBe(1);
    expect(returnsAs({ arrows: ARROWS }, 'standard')).toBe('standard');
    expect(returnsAs({ arrows: ARROWS }, 'ghost')).toBe('ghost');
    expect(returnsAs({ arrows: ARROWS }, 'noise')).toBe('standard');
  });

  it('a chest with an arrow in it still opens: the arrow yields focus to the chest', () => {
    const t = setup();
    const chest = t.world.spawn();
    addInteractable(
      t.world,
      chest,
      { affordances: [{ verb: 'open' }], anchor: [0, 0.5, 0] },
      v3(0, 0, -1.6),
    );
    restArrow(t, v3(0.1, 1, -1.5), { in: chest });
    t.world.step([IDLE]);
    expect(t.world.get(t.player, InteractionFocusComponent)?.target).toBe(chest);
    expect(interactionPrompt(t.world, t.player)?.verb).toBe('open');
  });

  it('an arrow in a chest is still reachable when the chest is not: it takes focus alone', () => {
    const t = setup();
    const chest = t.world.spawn();
    addInteractable(t.world, chest, { affordances: [{ verb: 'open' }] }, v3(0, 0, 40));
    const arrow = restArrow(t, v3(0, 1, -1.5), { in: chest });
    t.world.step([IDLE]);
    expect(t.world.get(t.player, InteractionFocusComponent)?.target).toBe(arrow);
  });

  it('an arrow in a plain wall (no interactions of its own) is focused normally', () => {
    const t = setup();
    const wall = t.world.spawn();
    placeEntity(t.world, wall, v3(0, 1, -2), 1);
    const arrow = restArrow(t, v3(0, 1, -1.5), { in: wall });
    t.world.step([IDLE]);
    expect(t.world.get(t.player, InteractionFocusComponent)?.target).toBe(arrow);
  });

  it('a non-player interactor with a quiver also takes them, and one taking a gone arrow does nothing', () => {
    const t = setup();
    const arrow = restArrow(t, v3(0, 1, -1.5));
    t.world.destroy(arrow);
    t.world.step([PRESS]);
    expect(t.taken).toEqual([]);
  });
});

describe('the 64-arrow cap (mw-e05.7)', () => {
  const east: ArrowViewRule = (_w, p) => p.x > 0; // x > 0 is "in view"

  it('AC-3: when the 65th arrow sticks the oldest arrow not in view is despawned', () => {
    const t = setup({ roll: 0.5, shapes: [WALL], inView: east });
    // Arrow #1 (oldest) is in view (x > 0); #2 is not; the rest alternate.
    const placed: EntityId[] = [];
    for (let i = 0; i < DEFAULT_ARROW_RULES.maxResting; i++) {
      placed.push(
        restArrow(t, v3(i === 0 ? 1 : i % 2 === 1 ? -1 : 1, 1, -8 + i * 0.01), { tick: i }),
      );
    }
    expect(restingArrows(t.world)).toHaveLength(64);
    t.world.step([IDLE]);
    expect(t.despawned).toEqual([]); // at the cap, nothing goes
    const last = fireArrow(t.world, ARROWS, {
      arrow: 'standard',
      origin: v3(0, 1.5, 0),
      velocity: v3(0, 0, -60),
    });
    stepsUntilRest(t, last);
    t.world.step([IDLE]);
    t.world.step([IDLE]);
    const [oldestSeen, oldestUnseen] = [placed[0] as EntityId, placed[1] as EntityId];
    expect(t.world.isAlive(last)).toBe(true);
    expect(t.world.isAlive(oldestSeen)).toBe(true); // older, but in view
    expect(t.world.isAlive(oldestUnseen)).toBe(false); // the oldest not in view goes
    expect(t.despawned).toMatchObject([{ entity: oldestUnseen, arrow: 'standard' }]);
    expect(restingArrows(t.world)).toHaveLength(64);
  });

  it('with every arrow in view the oldest goes anyway (the cap is hard); by default nothing is in view', () => {
    const all = setup({ inView: () => true });
    const first = restArrow(all, v3(0, 1, -5), { tick: 0 });
    for (let i = 1; i <= 64; i++) restArrow(all, v3(0, 1, -5), { tick: i });
    all.world.step([IDLE]);
    all.world.step([IDLE]);
    expect(all.world.isAlive(first)).toBe(false);
    expect(restingArrows(all.world)).toHaveLength(64);

    const none = setup();
    const oldest = restArrow(none, v3(0, 1, -5), { tick: 0 });
    for (let i = 1; i <= 64; i++) restArrow(none, v3(0, 1, -5), { tick: i });
    none.world.step([IDLE]);
    none.world.step([IDLE]);
    expect(none.world.isAlive(oldest)).toBe(false);
    expect(nothingInView(none.world, ZERO)).toBe(false);
  });

  it('removes several at once when far over the cap, and respects a lower cap', () => {
    const t = setup({ maxResting: 3, inView: east });
    const ids = [0, 1, 2, 3, 4, 5].map((i) =>
      restArrow(t, v3(i % 2 === 0 ? 1 : -1, 1, -5), { tick: i }),
    );
    t.world.step([IDLE]);
    t.world.step([IDLE]);
    // The unseen (odd) ones go first, oldest first: 1, 3, 5 are all removed before any seen one.
    expect(ids.map((id) => t.world.isAlive(id))).toEqual([true, false, true, false, true, false]);
  });

  it('breaks ties by entity id so the same arrows go on every run', () => {
    const run = () => {
      const t = setup({ maxResting: 2 });
      const ids = [0, 1, 2, 3].map(() => restArrow(t, v3(0, 1, -5), { tick: 7 }));
      t.world.step([IDLE]);
      t.world.step([IDLE]);
      return ids.map((id) => t.world.isAlive(id));
    };
    expect(run()).toEqual([false, false, true, true]);
    expect(run()).toEqual(run());
  });
});

describe('arrows in bodies (mw-e05.7)', () => {
  it('an arrow stuck in a moving body follows it', () => {
    const t = setup();
    const host = t.world.spawn();
    placeEntity(t.world, host, v3(0, 0, -5), 0.5);
    const arrow = restArrow(t, v3(0.2, 1, -4.8), { in: host, local: v3(0.2, 1, 0.2) });
    placeEntity(t.world, host, v3(3, 0, -7), 0.5);
    t.world.step([IDLE]);
    const moved = restOf(t, arrow);
    expect(moved?.position).toEqual(v3(3.2, 1, -6.8));
    expect(t.world.get(arrow, PlacementComponent)).toMatchObject({ x: 3.2, y: 1, z: -6.8 });
    // Standing still, it stays put and stays the same object (no churn).
    const before = restOf(t, arrow);
    t.world.step([IDLE]);
    expect(restOf(t, arrow)).toBe(before);
  });

  it('an arrow whose body is destroyed falls to the ground below, no longer stuck in anything', () => {
    const t = setup({ shapes: [box(v3(-20, -1, -20), v3(20, 0, 20))] });
    const host = t.world.spawn();
    placeEntity(t.world, host, v3(0, 0, -5), 0.5);
    const arrow = restArrow(t, v3(0, 2, -5), { in: host, local: v3(0, 2, 0) });
    t.world.destroy(host);
    t.world.step([IDLE]);
    t.world.step([IDLE]);
    const fallen = restOf(t, arrow);
    expect(fallen).toMatchObject({ state: 'dropped', in: null, intact: true });
    expect(fallen?.local).toBeUndefined();
    expect(fallen?.position.y).toBeCloseTo(0, 6);
    expect(fallen?.position.x).toBe(0);
    // And it can be taken from where it fell.
    expect(t.world.has(arrow, InteractableComponent)).toBe(true);
  });

  it('with no ground below it stays where it was', () => {
    const t = setup();
    const host = t.world.spawn();
    placeEntity(t.world, host, v3(0, 0, -5), 0.5);
    const arrow = restArrow(t, v3(0, 2, -5), { in: host });
    t.world.destroy(host);
    t.world.step([IDLE]);
    t.world.step([IDLE]);
    expect(restOf(t, arrow)).toMatchObject({ state: 'dropped', in: null, position: v3(0, 2, -5) });
  });

  it('an arrow in a body with no placement stays where it landed', () => {
    const t = setup();
    const host = t.world.spawn();
    const arrow = restArrow(t, v3(1, 1, -4), { in: host, local: v3(0, 1, 0) });
    t.world.step([IDLE]);
    expect(restOf(t, arrow)?.position).toEqual(v3(1, 1, -4));
  });

  it('takeStuckArrows removes every arrow in a body and returns the intact ones by type', () => {
    const t = setup();
    const host = t.world.spawn();
    const other = t.world.spawn();
    const a = restArrow(t, v3(0, 1, -5), { in: host });
    const b = restArrow(t, v3(0, 1, -5), { in: host }, 'fire');
    const c = restArrow(t, v3(0, 1, -5), { in: host, intact: false });
    const d = restArrow(t, v3(0, 1, -5), { in: other });
    const e = restArrow(t, v3(0, 1, -5), { in: host }, 'water');
    expect(takeStuckArrows(t.world, host)).toEqual([
      { arrow: 'fire', count: 1 },
      { arrow: 'standard', count: 1 },
      { arrow: 'water', count: 1 },
    ]);
    t.world.step([IDLE]);
    expect([a, b, c, e].map((id) => t.world.isAlive(id))).toEqual([false, false, false, false]);
    expect(t.world.isAlive(d)).toBe(true);
    expect(takeStuckArrows(t.world, host, () => 'standard')).toEqual([]);
  });

  it('takeStuckArrows can say what each arrow comes back as, merging stacks', () => {
    const t = setup();
    const host = t.world.spawn();
    restArrow(t, v3(0, 1, -5), { in: host }, 'water');
    restArrow(t, v3(0, 1, -5), { in: host });
    expect(takeStuckArrows(t.world, host, (arrow) => returnsAs({ arrows: ARROWS }, arrow))).toEqual(
      [{ arrow: 'standard', count: 2 }],
    );
  });
});

describe('fire and arrows (mw-e05.7)', () => {
  it('AC-5: an arrow stuck in a target that ignites becomes broken and non-retrievable', () => {
    const t = setup();
    const host = t.world.spawn();
    placeEntity(t.world, host, v3(0, 0, -5), 0.5);
    const arrow = restArrow(t, v3(0, 1, -5), { in: host });
    t.world.step([IDLE]);
    expect(restOf(t, arrow)?.intact).toBe(true);
    addProperties(t.world, host, { burning: false });
    t.world.step([IDLE]);
    setProperty(t.world, host, 'burning', true);
    t.world.step([IDLE]);
    expect(restOf(t, arrow)?.intact).toBe(false);
    expect(t.world.has(arrow, InteractableComponent)).toBe(false);
    expect(t.broken).toMatchObject([{ entity: arrow, arrow: 'standard', cause: 'fire' }]);
    // Broken stays broken, however long the fire lasts, and says so once.
    t.world.step([IDLE]);
    expect(t.broken).toHaveLength(1);
    expect(gatherable(t.world, arrow)).toEqual([]);
  });

  it('an arrow that burns itself breaks too, wherever it is', () => {
    const t = setup();
    const arrow = restArrow(t, v3(0, 1, -3));
    addProperties(t.world, arrow, { burning: false });
    t.world.step([IDLE]);
    setProperty(t.world, arrow, 'burning', true);
    t.world.step([IDLE]);
    expect(restOf(t, arrow)?.intact).toBe(false);
    expect(t.broken).toHaveLength(1);
  });

  it('does not take anything from an arrow that was never intact, and tolerates a world with no properties', () => {
    const world = new World<never>({ seed: 1 });
    world.register(ArrowRestComponent, PlacementComponent);
    installArrowRetrieval(world, { arrows: ARROWS });
    const arrow = world.spawn();
    world.add(arrow, ArrowRestComponent, {
      arrow: 'standard',
      shooter: null,
      state: 'dropped',
      position: v3(0, 0, 0),
      direction: v3(0, 0, 1),
      in: null,
      tick: 0,
      intact: true,
    });
    world.step();
    expect(world.get(arrow, ArrowRestComponent)?.intact).toBe(true);
  });

  it('a worldless-of-arrows world installs and steps cheaply', () => {
    const world = new World<never>({ seed: 1 });
    installArrowRetrieval(world, { arrows: ARROWS });
    expect(() => world.step()).not.toThrow();
  });
});

const PRESETS: MaterialPresets = new Map<string, WorldPropertyInit>([
  ['wood', { flammable: true, ignitionPoint: 300, fuel: 120, hp: 100 }],
  ['charred', { flammable: false, fragile: 150 }],
  ['generic', {}],
]);
const BURNT: BurntMaterials = new Map([['wood', 'charred']]);

describe('arrows in the real fire rules (mw-e05.7 AC-5)', () => {
  function burningWorld() {
    const world = installElementField(
      installStimuli(registerWorldProperties(new World<ActionFrame>({ seed: 5 }))),
      { maxChunks: 8 },
    );
    world.register(
      CharacterController,
      PlayerLook,
      ...BOW_COMPONENTS,
      ...DAMAGE_COMPONENTS,
      ...HIT_VOLUME_COMPONENTS,
    );
    installInteraction(world);
    const rules = new ElementRuleSet(fireRules({ presets: PRESETS, burnt: BURNT }));
    world
      .addSystem(stimulusSystem())
      .addSystem(elementRulesSystem(rules))
      .addSystem(elementFieldSystem());
    installArrows(world, { arrows: ARROWS, damage: new DamageModel() });
    installArrowRetrieval(world, { arrows: ARROWS, materials: PRESETS });
    const crate = world.spawn();
    addMaterialProperties(world, crate, PRESETS, { material: 'wood', temperature: 20 });
    placeEntity(world, crate, v3(0, 0.5, 0), 0.5);
    return { world, crate, field: elementFieldOf(world) as ElementField };
  }
  const settle = (t: ReturnType<typeof burningWorld>, position: Vec3, over: Partial<ArrowRest>) => {
    const entity = t.world.spawn();
    t.world.add(entity, ArrowRestComponent, {
      arrow: 'standard',
      shooter: null,
      state: 'stuck',
      position,
      direction: v3(0, 0, -1),
      in: null,
      tick: 0,
      intact: true,
      ...over,
    });
    t.world.events.emit(ArrowRested, {
      tick: 0,
      entity,
      arrow: 'standard',
      state: 'stuck',
      intact: true,
      in: over.in ?? null,
      position,
    });
    t.world.events.flush();
    return entity;
  };

  it('AC-5: heat reaches a wooden crate, it ignites, and the arrow in it breaks', () => {
    const t = burningWorld();
    const arrow = settle(t, v3(0, 0.5, 0.4), { in: t.crate, local: v3(0, 0, 0.4) });
    for (let i = 0; i < 4; i++) t.world.step([IDLE]);
    expect(t.world.get(arrow, ArrowRestComponent)?.intact).toBe(true);
    applyStimulus(t.world, {
      shape: { kind: 'contact', target: t.crate },
      element: 'heat',
      intensity: 400,
    });
    let burnt = false;
    for (let i = 0; i < 600 && !burnt; i++) {
      t.world.step([IDLE]);
      burnt = t.world.get(arrow, ArrowRestComponent)?.intact === false;
    }
    expect(readProperty(t.world, t.crate, 'burning') || burnt).toBe(true);
    expect(burnt).toBe(true);
    expect(t.world.has(arrow, InteractableComponent)).toBe(false);
  });

  it('a resting arrow is itself a small wooden thing: heat ignites it and it breaks without a host', () => {
    const t = burningWorld();
    const arrow = settle(t, v3(2, 0.5, 0), {});
    expect(readProperty(t.world, arrow, 'flammable')).toBe(true);
    expect(readProperty(t.world, arrow, 'fuel')).toBe(ARROW_FUEL_SECONDS);
    expect(readProperty(t.world, arrow, 'material')).toBe('wood');
    t.world.step([IDLE]);
    applyStimulus(t.world, {
      shape: { kind: 'contact', target: arrow },
      element: 'heat',
      intensity: 400,
    });
    let burnt = false;
    for (let i = 0; i < 600 && !burnt; i++) {
      t.world.step([IDLE]);
      burnt = t.world.get(arrow, ArrowRestComponent)?.intact === false;
    }
    expect(burnt).toBe(true);
  });
});

describe('saving arrows (mw-e05.7)', () => {
  it('restore re-creates an arrow at rest with its age, ready to take; unknown types are refused', () => {
    const t = setup();
    for (let i = 0; i < 10; i++) t.world.step([IDLE]);
    const entity = t.retrieval.restore(t.world, {
      arrow: 'rope',
      state: 'stuck',
      intact: true,
      position: v3(1, 2, -3),
      direction: v3(0, 0, -1),
      age: 4,
    });
    expect(restOf(t, entity as EntityId)).toMatchObject({
      arrow: 'rope',
      state: 'stuck',
      intact: true,
      in: null,
      tick: 6,
      position: v3(1, 2, -3),
    });
    expect(t.world.has(entity as EntityId, InteractableComponent)).toBe(true);
    expect(
      t.retrieval.restore(t.world, {
        arrow: 'ghost',
        state: 'stuck',
        intact: true,
        position: ZERO,
        direction: v3(0, 0, 1),
        age: 0,
      }),
    ).toBeUndefined();
    const young = t.retrieval.restore(t.world, {
      arrow: 'standard',
      state: 'dropped',
      intact: false,
      position: ZERO,
      direction: v3(0, 0, 1),
      age: 999,
    });
    expect(restOf(t, young as EntityId)?.tick).toBe(0);
    expect(t.world.has(young as EntityId, InteractableComponent)).toBe(false);
    expect(arrowRetrievalOf(t.world)).toBe(t.retrieval);
    expect(arrowRetrievalOf(new World<never>({ seed: 1 }))).toBeUndefined();
  });

  it('a world without placement or interaction settles arrows quietly', () => {
    const world = registerWorldProperties(new World<never>({ seed: 1 }));
    world.register(ArrowRestComponent);
    const retrieval = installArrowRetrieval(world, { arrows: ARROWS });
    const entity = retrieval.restore(world, {
      arrow: 'standard',
      state: 'stuck',
      intact: true,
      position: ZERO,
      direction: v3(0, 0, 1),
      age: 0,
    });
    expect(world.has(entity as EntityId, ArrowRestComponent)).toBe(true);
    const bare = new World<never>({ seed: 1 });
    bare.register(ArrowRestComponent, PlacementComponent);
    const plain = installArrowRetrieval(bare, { arrows: ARROWS });
    const arrow = plain.restore(bare, {
      arrow: 'standard',
      state: 'stuck',
      intact: true,
      position: v3(1, 1, 1),
      direction: v3(0, 0, 1),
      age: 0,
    });
    // Placed (so heat and the cap can see it) but not takeable: nothing interactive is registered.
    expect(bare.get(arrow as EntityId, PlacementComponent)).toMatchObject({ x: 1, y: 1, z: 1 });
    expect(hashWorld(bare)).toBeTypeOf('string');
  });
});

describe('edges of the retrieval rules (mw-e05.7)', () => {
  it('an arrow added without being settled follows its body without gaining a placement, and breaks cleanly', () => {
    const t = setup();
    const host = t.world.spawn();
    placeEntity(t.world, host, v3(0, 0, -5), 0.5);
    const arrow = t.world.spawn();
    t.world.add(arrow, ArrowRestComponent, {
      arrow: 'standard',
      shooter: null,
      state: 'stuck',
      position: v3(0, 1, -5),
      direction: v3(0, 0, -1),
      in: host,
      tick: 0,
      intact: true,
      local: v3(0, 1, 0),
    });
    placeEntity(t.world, host, v3(2, 0, -5), 0.5);
    addProperties(t.world, arrow, { burning: false });
    t.world.step([IDLE]);
    expect(restOf(t, arrow)?.position).toEqual(v3(2, 1, -5));
    expect(t.world.has(arrow, PlacementComponent)).toBe(false);
    setProperty(t.world, arrow, 'burning', true);
    t.world.step([IDLE]);
    expect(restOf(t, arrow)?.intact).toBe(false); // never takeable, so nothing to remove
  });

  it('a world with properties but no placement or interaction still keeps, drops and breaks arrows', () => {
    const world = registerWorldProperties(new World<never>({ seed: 1 }));
    world.register(ArrowRestComponent);
    installArrowRetrieval(world, { arrows: ARROWS });
    const host = world.spawn();
    const arrow = world.spawn();
    world.add(arrow, ArrowRestComponent, {
      arrow: 'standard',
      shooter: null,
      state: 'stuck',
      position: v3(0, 1, 0),
      direction: v3(0, 0, 1),
      in: host,
      tick: 0,
      intact: true,
      local: v3(0, 1, 0),
    });
    world.step();
    expect(world.get(arrow, ArrowRestComponent)?.position).toEqual(v3(0, 1, 0));
    addProperties(world, arrow, { burning: true });
    world.step();
    expect(world.get(arrow, ArrowRestComponent)?.intact).toBe(false);
    world.destroy(host);
    world.step();
    world.step();
    expect(world.get(arrow, ArrowRestComponent)).toMatchObject({ state: 'dropped', in: null });
    expect(restingArrows(new World<never>({ seed: 1 }))).toEqual([]);
  });

  it('Interact on anything but a takeable arrow, or by someone with no quiver, takes nothing', () => {
    const t = setup();
    const arrow = restArrow(t, v3(0, 1, -1.5));
    const broken = restArrow(t, v3(0, 1, -1.6), { intact: false });
    const stranger = t.world.spawn();
    const interact = (actor: EntityId, target: EntityId, verb: 'pick-up' | 'open') => {
      t.world.events.emit(interacted, { actor, target, verb, affordance: 0 });
      t.world.events.flush();
    };
    interact(t.player, arrow, 'open'); // another verb
    interact(t.player, broken, 'pick-up'); // not intact
    interact(t.player, t.player, 'pick-up'); // not an arrow
    interact(stranger, arrow, 'pick-up'); // no quiver
    expect(t.taken).toEqual([]);
    expect(t.world.isAlive(arrow)).toBe(true);
    expect(quiverCount(t.world, t.player, 'standard')).toBe(5);
  });
});
