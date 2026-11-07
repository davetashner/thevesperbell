import {
  ACTION_TIMELINE_COMPONENTS,
  GuardComponent,
  MELEE_COMPONENTS,
  applyHitReaction,
  giveHitReactions,
  HitReactionComponent,
  CharacterLocomotion,
  giveLocomotion,
  interruptAction,
  requestMove,
  setTimeScale,
  World,
  type EntityId,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import { characterLocomotion, LOWERING_TICKS, simAnimReader } from './sim-params';
import { timelineWorld } from './testing';

describe('simAnimReader guard phase (mw-ju8.24)', () => {
  const shield = Object.freeze({
    id: 'board',
    kind: 'weapon' as const,
    absorption: Object.freeze({}),
    stability: 100,
    raiseTicks: 12,
    arcDegrees: 110,
    moveSpeedScale: 0.5,
  });
  const guardPhase = (read: ReturnType<typeof simAnimReader>, w: World<never>, e: EntityId) =>
    read(w, e)?.values.guard;

  it('AC-2: reads raising, held and lowering from the guard component, and none once it is long down', () => {
    const world = new World({ seed: 1 }).register(
      ...ACTION_TIMELINE_COMPONENTS,
      ...MELEE_COMPONENTS,
    );
    const entity = world.spawn();
    world.add(entity, GuardComponent, { shield, held: false, raisedAt: null });
    const read = simAnimReader({ moves: new Map(), guard: true });
    expect(guardPhase(read, world, entity)).toBe('none');
    world.set(entity, GuardComponent, { shield, held: true, raisedAt: world.tick });
    expect(guardPhase(read, world, entity)).toBe('raising');
    for (let i = 0; i < 12; i++) world.step();
    expect(guardPhase(read, world, entity)).toBe('held');
    world.set(entity, GuardComponent, { shield, held: false, raisedAt: null });
    expect(guardPhase(read, world, entity)).toBe('lowering');
    for (let i = 0; i < LOWERING_TICKS + 1; i++) world.step();
    expect(guardPhase(read, world, entity)).toBe('none');
    expect(guardPhase(read, world, entity)).toBe('none');
  });

  it('AC-2: reads none without the opt-in, a guard component or a registered one', () => {
    const world = new World({ seed: 1 }).register(
      ...ACTION_TIMELINE_COMPONENTS,
      ...MELEE_COMPONENTS,
    );
    const entity = world.spawn();
    world.add(entity, GuardComponent, { shield, held: true, raisedAt: world.tick });
    expect(guardPhase(simAnimReader({ moves: new Map() }), world, entity)).toBe('none');
    const bare = world.spawn();
    expect(guardPhase(simAnimReader({ moves: new Map(), guard: true }), world, bare)).toBe('none');
    const plain = new World({ seed: 1 }).register(...ACTION_TIMELINE_COMPONENTS);
    const other = plain.spawn();
    expect(guardPhase(simAnimReader({ moves: new Map(), guard: true }), plain, other)).toBe('none');
  });
});

describe('simAnimReader', () => {
  it('reads an idle entity without a timeline or locomotion as standing still at normal speed', () => {
    const world = new World({ seed: 1 }).register(...ACTION_TIMELINE_COMPONENTS);
    const entity = world.spawn();
    const read = simAnimReader({ moves: new Map() });
    expect(read(world, entity)).toEqual({
      values: {
        speed: 0,
        turnRate: 0,
        grounded: true,
        locomotion: 'none',
        verticalSpeed: 0,
        acting: false,
        actionPhase: 'none',
        actionVerb: 'none',
        hitReact: false,
        hitReaction: 'none',
        hitDirection: 'none',
        guard: 'none',
      },
      timeScale: 1,
      action: null,
    });
    world.destroy(entity);
    expect(read(world, entity)).toBeUndefined();
  });

  it('reads locomotion, the running move, its phase and the time scale from the sim', () => {
    const { world, entity, moves } = timelineWorld();
    const read = simAnimReader({
      moves,
      locomotion: () => ({ speed: 2, turnRate: -1, grounded: false }),
    });
    requestMove(world, entity, 'swing');
    for (let i = 0; i < 13; i++) world.step();
    setTimeScale(world, entity, 0);
    expect(read(world, entity)).toEqual({
      values: {
        speed: 2,
        turnRate: -1,
        grounded: false,
        locomotion: 'none',
        verticalSpeed: 0,
        acting: true,
        actionPhase: 'active',
        actionVerb: 'attack',
        hitReact: false,
        hitReaction: 'none',
        hitDirection: 'none',
        guard: 'none',
      },
      timeScale: 0,
      action: {
        move: 'swing',
        clip: 'anim-swing',
        key: 0,
        tick: 12,
        activeFrom: 12,
        totalTicks: 34,
        phase: 'active',
        verb: 'attack',
      },
    });
  });

  it('reads an interrupt lock as a hit reaction, and a move it cannot look up as none', () => {
    const { world, entity, moves } = timelineWorld();
    const read = simAnimReader({ moves });
    requestMove(world, entity, 'swing');
    world.step();
    expect(simAnimReader({ moves: new Map() })(world, entity)?.action).toBeNull();
    interruptAction(world, entity, 10);
    expect(read(world, entity)?.values).toMatchObject({ hitReact: true, acting: false });
  });

  it('mw-e04.7: reads the sim-chosen hit reaction and its side when asked to', () => {
    const { world, entity, moves } = timelineWorld();
    world.register(HitReactionComponent);
    giveHitReactions(world, entity);
    const read = simAnimReader({ moves, reactions: true });
    expect(read(world, entity)?.values).toMatchObject({
      hitReaction: 'none',
      hitDirection: 'none',
    });
    applyHitReaction(world, entity, { kind: 'stagger', direction: 'back' }, { moves });
    expect(read(world, entity)?.values).toMatchObject({
      hitReact: true,
      hitReaction: 'stagger',
      hitDirection: 'back',
    });
    expect(simAnimReader({ moves })(world, entity)?.values).toMatchObject({
      hitReaction: 'none',
      hitDirection: 'none',
    });
  });

  it('mw-e02.6: reads a world without the action timeline as never acting; publishes the sim’s locomotion', () => {
    const world = new World({ seed: 1 }).register(CharacterLocomotion);
    const entity = world.spawn();
    giveLocomotion(world, entity);
    const read = simAnimReader({
      moves: new Map(),
      locomotion: characterLocomotion,
      timeline: false,
    });
    expect(read(world, entity)).toEqual({
      values: {
        speed: 0,
        turnRate: 0,
        grounded: true,
        locomotion: 'idle',
        verticalSpeed: 0,
        acting: false,
        actionPhase: 'none',
        actionVerb: 'none',
        hitReact: false,
        hitReaction: 'none',
        hitDirection: 'none',
        guard: 'none',
      },
      timeScale: 1,
      action: null,
    });
    expect(characterLocomotion(world, world.spawn())).toBeUndefined();
  });
});
