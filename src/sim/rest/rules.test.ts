import { describe, expect, it } from 'vitest';
import { DAMAGE_COMPONENTS, giveCombatant, HealthComponent } from '../combat/damage/components';
import { giveStamina, StaminaComponent } from '../combat/stamina';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { fireRules, type BurntMaterials } from '../elements/fire';
import { ElementRuleSet, elementRulesSystem } from '../elements/rules';
import { elementFieldSystem, installElementField } from '../field/install';
import { installGameClock, totalMinutes, type GameClock } from '../gametime/clock';
import { DEFAULT_CLOCK_CONFIG } from '../gametime/config';
import { LightSourceComponent } from '../light/components';
import { LightField } from '../light/field';
import { installLightField, lightFieldSystem } from '../light/install';
import { spawnLightSource } from '../light/sources';
import { giveMana, manaOf, ManaComponent } from '../magic/mana';
import {
  registerWorldProperties,
  setProperty,
  type WorldPropertyInit,
} from '../properties/components';
import { applyStimulus, installStimuli, stimulusSystem } from '../stimulus/stimulus';
import { registerPersistence } from '../deltas/persistence';
import { installRestPolicies } from '../deltas/rest';
import { DAY_CLOCK_FACTS, factDayClock, type TimeOfDay } from './day-clock';
import { makeRestPoint, restPointOf, RestPointComponent } from './points';
import { restCompleted, type RestCompleted } from './rest';
import {
  durationMinutes,
  REST_INTERRUPT_PREFIX,
  restInterrupted,
  RestRules,
  type RestInterrupted,
  type RestKindSpec,
} from './rules';

const CAMPFIRE: RestKindSpec = {
  id: 'campfire',
  name: 'Campfire',
  needsFire: true,
  fullRestHours: 8,
  restores: { health: 1, stamina: 1, mana: 1 },
  durations: [
    { kind: 'dawn' },
    { kind: 'dusk' },
    { kind: 'hours', hours: 2 },
    { kind: 'hours', hours: 8 },
  ],
  interrupts: [],
};
const INN: RestKindSpec = {
  id: 'inn',
  name: 'Inn bed',
  needsFire: false,
  fullRestHours: 8,
  restores: { health: 1, stamina: 1, mana: 0.5 },
  durations: [{ kind: 'dawn' }],
  interrupts: [],
};

const PRESETS = new Map<string, WorldPropertyInit>();
const BURNT: BurntMaterials = new Map();

function setup(start: TimeOfDay = { day: 1, minute: 22 * 60 }, kinds = [CAMPFIRE, INN]) {
  const world = installElementField(
    installStimuli(registerWorldProperties(new World<never>({ seed: 5 }))),
    { maxChunks: 8 },
  );
  const field = new LightField();
  installLightField(world, field);
  world
    .addSystem(stimulusSystem())
    .addSystem(
      elementRulesSystem(
        new ElementRuleSet(
          fireRules({
            presets: PRESETS,
            burnt: BURNT,
            keepWhenSpent: (w, e) => w.has(e, LightSourceComponent),
          }),
        ),
      ),
    )
    .addSystem(elementFieldSystem())
    .addSystem(lightFieldSystem(field));
  const clock: GameClock = installGameClock(world, DEFAULT_CLOCK_CONFIG);
  clock.setTime(start);
  world.register(...DAMAGE_COMPONENTS, StaminaComponent, ManaComponent);
  const actor = world.spawn();
  giveCombatant(world, actor, { health: 100 });
  world.set(actor, HealthComponent, { max: 100, current: 20 });
  giveStamina(world, actor);
  giveMana(world, actor);
  const rules = new RestRules(kinds);
  const completed: RestCompleted[] = [];
  const interrupted: RestInterrupted[] = [];
  world.events.on(restCompleted, (e) => completed.push(e));
  world.events.on(restInterrupted, (e) => interrupted.push(e));
  const camp = spawnLightSource(world, 'campfire', { x: 0, y: 0, z: 0 }, { unlit: true });
  makeRestPoint(world, camp, 'campfire', 'camp-1');
  world.step();
  return { world, clock, actor, rules, camp, completed, interrupted };
}

const hours = (n: number) => ({ kind: 'hours', hours: n }) as const;
const heat = (world: World<never>, target: EntityId) =>
  applyStimulus(world, {
    shape: { kind: 'contact', target },
    element: 'heat',
    intensity: 600,
  });

describe('rest points (mw-e27.13)', () => {
  it('AC-1: a campfire that is not burning refuses with no-fire; a heat stimulus lights it and the same request succeeds', () => {
    const s = setup();
    const before = s.clock.total();
    const refused = s.rules.rest(s.world, s.actor, { point: s.camp, duration: hours(2) });
    expect(refused).toEqual({ ok: false, reason: 'no-fire', detail: 'The fire is out' });
    expect(s.clock.total()).toBe(before);
    heat(s.world, s.camp);
    s.world.step();
    s.world.step();
    const rested = s.rules.rest(s.world, s.actor, { point: s.camp, duration: hours(2) });
    expect(rested).toMatchObject({ ok: true, hours: 2 });
  });

  it('AC-1: a snuffed (wet) fire refuses again', () => {
    const s = setup();
    setProperty(s.world, s.camp, 'burning', true);
    expect(s.rules.rest(s.world, s.actor, { point: s.camp, duration: hours(2) }).ok).toBe(true);
    setProperty(s.world, s.camp, 'burning', false);
    expect(s.rules.rest(s.world, s.actor, { point: s.camp, duration: hours(2) })).toMatchObject({
      ok: false,
      reason: 'no-fire',
    });
  });

  it('AC-2: an unsafe veto refuses with reason unsafe and the clock does not move', () => {
    const s = setup();
    setProperty(s.world, s.camp, 'burning', true);
    const before = s.clock.total();
    const refused = s.rules.rest(
      s.world,
      s.actor,
      { point: s.camp, duration: { kind: 'dawn' } },
      () => 'Enemies are searching for you',
    );
    expect(refused).toEqual({
      ok: false,
      reason: 'unsafe',
      detail: 'Enemies are searching for you',
    });
    expect(s.clock.total()).toBe(before);
    expect(s.completed).toEqual([]);
    s.world.events.flush();
    expect(s.completed).toEqual([]);
    expect(
      s.rules.rest(s.world, s.actor, { point: s.camp, duration: hours(2) }, () => null).ok,
    ).toBe(true);
  });

  it('AC-3: rest until dawn at 22:00 reads 06:00 next day, completes once and restores per the kind’s table', () => {
    const s = setup();
    setProperty(s.world, s.camp, 'burning', true);
    s.world.facts.declare('camp.rested', {
      type: 'bool',
      default: false,
      persistence: 'reset-on-rest',
    });
    s.world.facts.declare('camp.found', { type: 'bool', default: false });
    registerPersistence(s.world);
    installRestPolicies(s.world);
    s.world.facts.set('camp.rested', true);
    s.world.facts.set('camp.found', true);
    const out = s.rules.rest(s.world, s.actor, { point: s.camp, duration: { kind: 'dawn' } });
    expect(out).toMatchObject({ ok: true, hours: 8, wakes: { day: 2, minute: 360 } });
    expect(s.clock.time()).toEqual({ day: 2, minute: 360 });
    s.world.events.flush();
    expect(s.completed).toHaveLength(1);
    expect(s.completed[0]).toMatchObject({
      kind: 'campfire',
      hours: 8,
      point: 'camp-1',
      wakes: { day: 2, minute: 360 },
    });
    expect(s.completed[0]).not.toHaveProperty('interrupted');
    expect(s.interrupted).toEqual([]);
    // The rest-reset fact went back to its default; the permanent one did not.
    expect(s.world.facts.get('camp.rested')).toBe(false);
    expect(s.world.facts.get('camp.found')).toBe(true);
    expect(s.world.get(s.actor, HealthComponent)?.current).toBe(100);
    expect(manaOf(s.world, s.actor)?.current).toBe(manaOf(s.world, s.actor)?.profile.max);
  });

  it('AC-3: a kind’s table sets how much comes back (an inn bed gives half the mana)', () => {
    const s = setup({ day: 1, minute: 22 * 60 });
    const bed = s.world.spawn();
    makeRestPoint(s.world, bed, 'inn', 'bed-1');
    s.world.step();
    const mana = manaOf(s.world, s.actor);
    s.world.set(s.actor, ManaComponent, { ...mana!, current: 0 });
    s.rules.rest(s.world, s.actor, { point: bed, duration: { kind: 'dawn' } });
    expect(manaOf(s.world, s.actor)?.current).toBeCloseTo(mana!.profile.max / 2, 3);
    expect(s.world.get(s.actor, HealthComponent)?.current).toBe(100);
  });

  it('dusk waits for 18:00, and a rest started at exactly dawn lasts a whole day', () => {
    expect(durationMinutes({ kind: 'dusk' }, { day: 1, minute: 6 * 60 })).toBe(12 * 60);
    expect(durationMinutes({ kind: 'dawn' }, { day: 1, minute: 6 * 60 })).toBe(24 * 60);
    expect(durationMinutes(hours(3), { day: 4, minute: 7 })).toBe(180);
  });

  it('AC-5: an interrupt scheduled at 02:00 stops an 8 h rest from 22:00 there, pro-rated 4/8, and fires once', () => {
    const s = setup();
    setProperty(s.world, s.camp, 'burning', true);
    s.clock.schedule.at(totalMinutes({ day: 2, minute: 120 }), `${REST_INTERRUPT_PREFIX}wolves`, {
      message: 'Wolves.',
    });
    const out = s.rules.rest(s.world, s.actor, { point: s.camp, duration: hours(8) });
    expect(out).toMatchObject({
      ok: true,
      hours: 4,
      wakes: { day: 2, minute: 120 },
      interrupted: { id: `${REST_INTERRUPT_PREFIX}wolves`, message: 'Wolves.' },
    });
    expect(s.clock.time()).toEqual({ day: 2, minute: 120 });
    // Half of the 100 health, from 20: +50.
    expect(s.world.get(s.actor, HealthComponent)?.current).toBe(70);
    s.world.events.flush();
    expect(s.interrupted).toHaveLength(1);
    expect(s.interrupted[0]).toMatchObject({
      kind: 'campfire',
      point: 'camp-1',
      hours: 4,
      at: { day: 2, minute: 120 },
    });
    expect(s.completed).toHaveLength(1);
    expect(s.completed[0]).toMatchObject({ interrupted: `${REST_INTERRUPT_PREFIX}wolves` });
  });

  it('a scheduled interrupt outside the rest, or other entries, are ignored', () => {
    const s = setup();
    setProperty(s.world, s.camp, 'burning', true);
    s.clock.schedule.at(totalMinutes({ day: 2, minute: 7 * 60 }), `${REST_INTERRUPT_PREFIX}late`);
    s.clock.schedule.at(totalMinutes({ day: 2, minute: 60 }), 'market.opens');
    const out = s.rules.rest(s.world, s.actor, { point: s.camp, duration: hours(8) });
    expect(out).toMatchObject({ ok: true, hours: 8 });
    expect(out).not.toHaveProperty('interrupted');
  });

  it('a kind’s own interrupts are rolled once an hour on the seeded rest stream: same seed, same night', () => {
    const risky: RestKindSpec = {
      ...CAMPFIRE,
      interrupts: [{ id: 'prowler', chancePerHour: 0.5, message: 'Something prowls.' }],
    };
    const night = () => {
      const s = setup(undefined, [risky]);
      setProperty(s.world, s.camp, 'burning', true);
      return s.rules.rest(s.world, s.actor, { point: s.camp, duration: hours(8) });
    };
    const first = night();
    expect(first).toMatchObject({ ok: true, interrupted: { id: 'prowler' } });
    expect(night()).toEqual(first);
    // A sure thing stops it at the first hour; a sure miss never does.
    const sure = setup(undefined, [
      { ...risky, interrupts: [{ id: 'x', chancePerHour: 1, message: 'm' }] },
    ]);
    setProperty(sure.world, sure.camp, 'burning', true);
    expect(
      sure.rules.rest(sure.world, sure.actor, { point: sure.camp, duration: hours(8) }),
    ).toMatchObject({
      hours: 1,
      interrupted: { id: 'x' },
    });
    const calm = setup(undefined, [
      { ...risky, interrupts: [{ id: 'x', chancePerHour: 0, message: 'm' }] },
    ]);
    setProperty(calm.world, calm.camp, 'burning', true);
    expect(
      calm.rules.rest(calm.world, calm.actor, { point: calm.camp, duration: hours(8) }),
    ).toMatchObject({
      hours: 8,
    });
  });

  it('a scheduled interrupt before the first rolled hour wins; one after it does not', () => {
    const sure: RestKindSpec = {
      ...CAMPFIRE,
      interrupts: [{ id: 'x', chancePerHour: 1, message: 'm' }],
    };
    const early = setup(undefined, [sure]);
    setProperty(early.world, early.camp, 'burning', true);
    early.clock.schedule.at(
      totalMinutes({ day: 1, minute: 22 * 60 + 30 }),
      `${REST_INTERRUPT_PREFIX}a`,
    );
    expect(
      early.rules.rest(early.world, early.actor, { point: early.camp, duration: hours(8) }),
    ).toMatchObject({
      hours: 0.5,
      interrupted: { id: `${REST_INTERRUPT_PREFIX}a`, message: '' },
    });
    const late = setup(undefined, [sure]);
    setProperty(late.world, late.camp, 'burning', true);
    late.clock.schedule.at(totalMinutes({ day: 2, minute: 60 }), `${REST_INTERRUPT_PREFIX}b`);
    expect(
      late.rules.rest(late.world, late.actor, { point: late.camp, duration: hours(8) }),
    ).toMatchObject({
      hours: 1,
      interrupted: { id: 'x' },
    });
  });

  it('refuses what is not a rest point and durations a kind does not offer', () => {
    const s = setup();
    const stone = s.world.spawn();
    expect(s.rules.rest(s.world, s.actor, { point: stone, duration: hours(2) })).toMatchObject({
      reason: 'not-a-rest-point',
    });
    const odd = s.world.spawn();
    makeRestPoint(s.world, odd, 'mystery', 'odd-1');
    s.world.step();
    setProperty(s.world, s.camp, 'burning', true);
    expect(s.rules.rest(s.world, s.actor, { point: odd, duration: hours(2) })).toMatchObject({
      reason: 'not-a-rest-point',
    });
    expect(s.rules.rest(s.world, s.actor, { point: s.camp, duration: hours(5) })).toMatchObject({
      ok: false,
      reason: 'duration-not-offered',
    });
    expect(
      s.rules.rest(s.world, s.actor, { point: s.camp, duration: { kind: 'hours', hours: 2 } }).ok,
    ).toBe(true);
  });

  it('blocked() tells a prompt why, and kind/kindOf/restPointOf read the data', () => {
    const s = setup();
    expect(s.rules.blocked(s.world, s.camp)).toMatchObject({ reason: 'no-fire' });
    setProperty(s.world, s.camp, 'burning', true);
    expect(s.rules.blocked(s.world, s.camp)).toBeNull();
    expect(s.rules.blocked(s.world, s.camp, () => 'busy')).toEqual({
      reason: 'unsafe',
      detail: 'busy',
    });
    expect(s.rules.blocked(s.world, s.world.spawn())).toMatchObject({ reason: 'not-a-rest-point' });
    expect(s.rules.kind('inn')).toBe(INN);
    expect(s.rules.kindOf(s.world, s.camp)).toBe(CAMPFIRE);
    expect(restPointOf(s.world, s.camp)).toEqual({ kind: 'campfire', id: 'camp-1' });
  });

  it('restPointOf is undefined in a world with no rest points, and a rest point needs a kind and an id', () => {
    const world = new World<never>({ seed: 1 });
    expect(restPointOf(world, world.spawn())).toBeUndefined();
    expect(() => makeRestPoint(world, world.spawn(), '', 'x')).toThrow(RangeError);
    expect(() => makeRestPoint(world, world.spawn(), 'x', '')).toThrow(RangeError);
    expect(world.isRegistered(RestPointComponent)).toBe(false);
  });

  it('an actor with no health, stamina or mana pool rests without restoring anything', () => {
    const s = setup();
    setProperty(s.world, s.camp, 'burning', true);
    const bare = s.world.spawn();
    expect(s.rules.rest(s.world, bare, { point: s.camp, duration: hours(2) })).toMatchObject({
      ok: true,
      restored: { health: 0, stamina: 0, mana: 0 },
    });
  });

  it('without a game clock the bare day clock moves, and pools the actor lacks restore nothing', () => {
    const world = registerWorldProperties(new World<never>({ seed: 1 }));
    for (const [key, spec] of Object.entries(DAY_CLOCK_FACTS)) world.facts.declare(key, spec);
    const clock = factDayClock(world.facts);
    clock.set({ day: 1, minute: 22 * 60 });
    const bed = world.spawn();
    makeRestPoint(world, bed, 'inn', 'bed-1');
    world.step();
    const actor = world.spawn();
    const rules = new RestRules([INN]);
    const out = rules.rest(world, actor, { point: bed, duration: { kind: 'dawn' } });
    expect(out).toEqual({
      ok: true,
      hours: 8,
      wakes: { day: 2, minute: 360 },
      restored: { health: 0, stamina: 0, mana: 0 },
    });
    expect(clock.now()).toEqual({ day: 2, minute: 360 });
  });
});

describe('the rest-action registry (mw-e27.13)', () => {
  function withActions() {
    const s = setup();
    const done: string[] = [];
    s.rules.registerAction({
      id: 'recharge',
      label: 'Recharge artifacts',
      priority: 20,
      perform: () => done.push('recharge'),
    });
    s.rules.registerAction({
      id: 'assemble',
      label: 'Assemble arrows',
      priority: 10,
      unavailable: ({ kind }) => (kind === 'campfire' ? undefined : 'No workbench'),
      perform: ({ kind }) => done.push(`assemble@${kind}`),
    });
    return { ...s, done };
  }

  it('AC-4: the menu lists both actions in priority order at a rest point; away from one it is empty and invoking fails not-at-rest', () => {
    const s = withActions();
    expect(s.rules.menu(s.world, s.actor)).toEqual([]);
    expect(s.rules.invoke(s.world, s.actor, 'assemble')).toEqual({
      ok: false,
      reason: 'not-at-rest',
      detail: 'Only at a rest point',
    });
    expect(s.rules.invoke(s.world, s.actor, 'recharge')).toMatchObject({ reason: 'not-at-rest' });
    const menu = s.rules.enter(s.world, s.actor, s.camp);
    expect(menu.map((a) => a.id)).toEqual(['assemble', 'recharge']);
    expect(menu.every((a) => a.available)).toBe(true);
    expect(s.rules.at(s.actor)).toBe(s.camp);
    expect(s.rules.invoke(s.world, s.actor, 'assemble')).toEqual({ ok: true });
    expect(s.done).toEqual(['assemble@campfire']);
    s.rules.leave(s.actor);
    expect(s.rules.at(s.actor)).toBeUndefined();
    expect(s.rules.invoke(s.world, s.actor, 'assemble')).toMatchObject({ reason: 'not-at-rest' });
  });

  it('an action can be unavailable at a kind of point, unknown, or removed again; ids are unique', () => {
    const s = withActions();
    const bed = s.world.spawn();
    makeRestPoint(s.world, bed, 'inn', 'bed-1');
    s.world.step();
    expect(s.rules.enter(s.world, s.actor, bed)[0]).toEqual({
      id: 'assemble',
      label: 'Assemble arrows',
      available: false,
      reason: 'No workbench',
    });
    expect(s.rules.invoke(s.world, s.actor, 'assemble')).toEqual({
      ok: false,
      reason: 'unavailable',
      detail: 'No workbench',
    });
    expect(s.rules.invoke(s.world, s.actor, 'nope')).toMatchObject({ reason: 'unknown-action' });
    expect(() =>
      s.rules.registerAction({ id: 'assemble', label: 'x', priority: 0, perform: () => undefined }),
    ).toThrow(RangeError);
    expect(() =>
      s.rules.registerAction({ id: '', label: 'x', priority: 0, perform: () => undefined }),
    ).toThrow(RangeError);
    const off = s.rules.registerAction({
      id: 'extra',
      label: 'Extra',
      priority: 5,
      perform: () => undefined,
    });
    expect(s.rules.enter(s.world, s.actor, s.camp).map((a) => a.id)).toEqual([
      'extra',
      'assemble',
      'recharge',
    ]);
    off();
    off();
    expect(s.rules.menu(s.world, s.actor).map((a) => a.id)).toEqual(['assemble', 'recharge']);
  });

  it('equal priorities sort by id, and an actor at a point that stopped being one has no menu', () => {
    const s = setup();
    for (const id of ['b', 'a']) {
      s.rules.registerAction({ id, label: id, priority: 1, perform: () => undefined });
    }
    expect(s.rules.enter(s.world, s.actor, s.camp).map((a) => a.id)).toEqual(['a', 'b']);
    const stone = s.world.spawn();
    s.rules.enter(s.world, s.actor, stone);
    expect(s.rules.menu(s.world, s.actor)).toEqual([]);
  });
});
