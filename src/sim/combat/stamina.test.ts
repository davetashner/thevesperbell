import { describe, expect, it } from 'vitest';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { hashWorld } from '../snapshot';
import { ActionRejected, type ActionRejection } from './actions';
import {
  canSprint,
  DEFAULT_STAMINA_PROFILE,
  drainStamina,
  giveStamina,
  setBlocking,
  setSprintHeld,
  spendStamina,
  StaminaComponent,
  StaminaExhausted,
  staminaOf,
  StaminaRecovered,
  staminaSystem,
  validateStaminaProfile,
  type Stamina,
  type StaminaChange,
} from './stamina';

function setup(profile = DEFAULT_STAMINA_PROFILE) {
  const world = new World<string>({ seed: 1 }).register(StaminaComponent);
  world.addSystem(staminaSystem());
  const knight = world.spawn();
  giveStamina(world, knight, profile);
  const rejected: ActionRejection[] = [];
  const exhausted: StaminaChange[] = [];
  const recovered: StaminaChange[] = [];
  world.events.on(ActionRejected, (e) => rejected.push(e));
  world.events.on(StaminaExhausted, (e) => exhausted.push(e));
  world.events.on(StaminaRecovered, (e) => recovered.push(e));
  const pool = (): Stamina => {
    const value = staminaOf(world, knight);
    if (value === undefined) throw new Error('no pool');
    return value;
  };
  const steps = (n: number): void => {
    for (let i = 0; i < n; i++) world.step();
  };
  return { world, knight, pool, steps, rejected, exhausted, recovered };
}

/** Records `pool().sprinting` after each of `n` steps. */
function sprintTrace(s: ReturnType<typeof setup>, n: number): boolean[] {
  const trace: boolean[] = [];
  for (let i = 0; i < n; i++) {
    s.world.step();
    trace.push(s.pool().sprinting);
  }
  return trace;
}

describe('stamina pool', () => {
  it('gives a full pool with the knight defaults', () => {
    const { pool } = setup();
    expect(pool()).toEqual({
      profile: DEFAULT_STAMINA_PROFILE,
      current: 100,
      exhausted: false,
      regenResumesAt: 0,
      blocking: false,
      sprintHeld: false,
      sprinting: false,
    });
    expect(Object.isFrozen(pool())).toBe(true);
    expect(DEFAULT_STAMINA_PROFILE).toEqual({
      max: 100,
      regenPerSecond: 40,
      regenDelayTicks: 30,
      exhaustedRegenDelayTicks: 72,
      blockingRegenMultiplier: 0.35,
      sprintDrainPerSecond: 10,
      sprintRecoverThreshold: 20,
    });
  });

  it('AC-1: a 12-cost attack leaves 88, pauses regen 30 ticks, then regenerates 40/s', () => {
    const { world, knight, pool, steps } = setup();
    expect(spendStamina(world, knight, 'attack', 12)).toBe(true);
    expect(pool().current).toBe(88);
    steps(30); // ticks 0–29: the regen pause
    expect(pool().current).toBe(88);
    steps(15); // ticks 30–44: 15 ticks at 40/s
    expect(pool().current).toBeCloseTo(98, 9);
    steps(10);
    expect(pool().current).toBe(100);
  });

  it('AC-1: the regen pause is the same whether the spend runs before or after the stamina system', () => {
    const resumes = (before: boolean): number => {
      const world = new World<string>({ seed: 1 }).register(StaminaComponent);
      const knight = world.spawn();
      giveStamina(world, knight);
      const attack = {
        name: before ? 'attack-before' : 'attack-after',
        run: ({ inputs }: { inputs: readonly string[] }) => {
          if (inputs.includes('attack')) spendStamina(world, knight, 'attack', 12);
        },
      };
      if (before) world.addSystem(attack).addSystem(staminaSystem());
      else world.addSystem(staminaSystem()).addSystem(attack);
      world.step(['attack']);
      let tick = 1;
      while (staminaOf(world, knight)?.current === 88) {
        world.step();
        tick++;
      }
      return tick;
    };
    expect(resumes(true)).toBe(31);
    expect(resumes(false)).toBe(31);
  });

  it('AC-2: a 20-cost dodge on 5 stamina executes, stops at 0 and sets Exhausted', () => {
    const { world, knight, pool, exhausted, steps } = setup();
    expect(drainStamina(world, knight, 95)).toBe(95);
    expect(pool().current).toBe(5);
    expect(spendStamina(world, knight, 'dodge', 20)).toBe(true);
    expect(pool().current).toBe(0);
    expect(pool().exhausted).toBe(true);
    world.events.flush();
    expect(exhausted).toEqual([{ entity: knight, tick: 0 }]);
    steps(72); // Exhausted: the regen pause is 72 ticks
    expect(pool().current).toBe(0);
    steps(1);
    expect(pool().current).toBeGreaterThan(0);
  });

  it('AC-3: at 0 stamina an attack is refused with one ActionRejected per press', () => {
    const { world, knight, pool, rejected } = setup();
    spendStamina(world, knight, 'attack', 100);
    expect(spendStamina(world, knight, 'attack', 12)).toBe(false);
    world.events.flush();
    expect(rejected).toEqual([{ entity: knight, action: 'attack', reason: 'stamina', tick: 0 }]);
    world.step();
    expect(spendStamina(world, knight, 'attack', 12)).toBe(false);
    world.events.flush();
    expect(rejected).toHaveLength(2);
    expect(rejected[1]?.tick).toBe(1);
    expect(pool().current).toBe(0);
  });

  it('AC-4: an Exhausted knight holding sprint is refused until stamina reaches 20', () => {
    const s = setup();
    const { world, knight, pool, rejected, recovered } = s;
    spendStamina(world, knight, 'dodge', 100);
    expect(setSprintHeld(world, knight, true)).toBe(false);
    expect(setSprintHeld(world, knight, true)).toBe(false); // still held: not a new press
    world.events.flush();
    expect(rejected).toEqual([{ entity: knight, action: 'sprint', reason: 'stamina', tick: 0 }]);
    // 72-tick pause, then 30 ticks at 40/s reach 20 on tick 101.
    const trace = sprintTrace(s, 102);
    expect(trace.slice(0, 102).every((sprinting) => !sprinting)).toBe(true);
    expect(pool().current).toBeCloseTo(20, 9);
    expect(pool().exhausted).toBe(false);
    expect(recovered).toEqual([{ entity: knight, tick: 101 }]);
    world.step();
    expect(pool().sprinting).toBe(true);
    expect(pool().current).toBeLessThan(20);
  });

  it('AC-5: holding block regenerates at 14/s (40 × 0.35) after the pause', () => {
    const { world, knight, pool, steps } = setup();
    spendStamina(world, knight, 'attack', 50);
    setBlocking(world, knight, true);
    steps(30);
    expect(pool().current).toBe(50);
    steps(60);
    expect(pool().current).toBeCloseTo(64, 9);
    setBlocking(world, knight, true); // unchanged
    setBlocking(world, knight, false);
    expect(pool().blocking).toBe(false);
    steps(30);
    expect(pool().current).toBeCloseTo(84, 9);
  });

  it('sprint drains 10/s and pauses regen until 30 ticks after it stops', () => {
    const s = setup();
    const { world, knight, pool, steps } = s;
    expect(setSprintHeld(world, knight, true)).toBe(true);
    steps(60);
    expect(pool().current).toBeCloseTo(90, 9);
    expect(pool().sprinting).toBe(true);
    setSprintHeld(world, knight, false);
    steps(1);
    expect(pool().sprinting).toBe(false);
    const stopped = pool().current;
    steps(28); // last sprint tick 59 → regen resumes on tick 89, like a spend on tick 59
    expect(pool().current).toBe(stopped);
    steps(1);
    expect(pool().current).toBeGreaterThan(stopped);
  });

  it('sprinting to 0 exhausts the knight and stops the sprint', () => {
    const s = setup();
    const { world, knight, pool, exhausted } = s;
    drainStamina(world, knight, 99);
    setSprintHeld(world, knight, true);
    const trace = sprintTrace(s, 7); // 1 stamina at 1/6 per tick lasts 6 ticks
    expect(trace).toEqual([true, true, true, true, true, true, false]);
    expect(pool().current).toBe(0);
    expect(pool().exhausted).toBe(true);
    expect(exhausted).toHaveLength(1);
  });

  it('spends while Exhausted use the long pause; blocked-hit drain reports its shortfall', () => {
    const { world, knight, pool, steps, exhausted } = setup();
    spendStamina(world, knight, 'attack', 100);
    steps(90); // 72-tick pause, then 18 ticks → 12 stamina, still Exhausted
    expect(pool().exhausted).toBe(true);
    spendStamina(world, knight, 'attack', 1);
    expect(pool().regenResumesAt).toBe(90 + 72);
    expect(drainStamina(world, knight, 20)).toBeCloseTo(11, 9); // shortfall 9 → guard break
    world.events.flush();
    expect(exhausted).toHaveLength(1); // already Exhausted: no second event
  });

  it('a zero cost is always allowed and changes nothing', () => {
    const { world, knight, pool, rejected } = setup();
    spendStamina(world, knight, 'attack', 100);
    const before = pool();
    expect(spendStamina(world, knight, 'block', 0)).toBe(true);
    expect(drainStamina(world, knight, 0)).toBe(0);
    world.events.flush();
    expect(pool()).toBe(before);
    expect(rejected).toEqual([]);
  });

  it('rejects invalid amounts and entities without a pool', () => {
    const { world, knight } = setup();
    expect(() => spendStamina(world, knight, 'attack', -1)).toThrow(RangeError);
    expect(() => spendStamina(world, knight, 'attack', Number.NaN)).toThrow(RangeError);
    expect(() => drainStamina(world, knight, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    const other: EntityId = world.spawn();
    expect(staminaOf(world, other)).toBeUndefined();
    expect(() => spendStamina(world, other, 'attack', 1)).toThrow(/no stamina pool/);
    expect(() => {
      setBlocking(world, other, true);
    }).toThrow(/no stamina pool/);
  });

  it('only allows sprint when not Exhausted and not empty', () => {
    const base = setup().pool();
    expect(canSprint(base)).toBe(true);
    expect(canSprint({ ...base, exhausted: true })).toBe(false);
    expect(canSprint({ ...base, current: 0 })).toBe(false);
  });

  it('validates profiles', () => {
    const ok = DEFAULT_STAMINA_PROFILE;
    expect(validateStaminaProfile(ok)).toBeUndefined();
    expect(validateStaminaProfile(null)).toMatch(/must be an object/);
    expect(validateStaminaProfile(5)).toMatch(/must be an object/);
    expect(validateStaminaProfile({ ...ok, max: '100' })).toMatch(/max must be a finite number/);
    expect(validateStaminaProfile({ ...ok, regenPerSecond: -1 })).toMatch(/regenPerSecond/);
    expect(validateStaminaProfile({ ...ok, sprintDrainPerSecond: Number.NaN })).toMatch(/sprint/);
    expect(validateStaminaProfile({ ...ok, max: 0 })).toMatch(/max must be > 0/);
    expect(validateStaminaProfile({ ...ok, regenDelayTicks: 1.5 })).toMatch(/whole ticks/);
    expect(validateStaminaProfile({ ...ok, exhaustedRegenDelayTicks: 1.5 })).toMatch(/whole/);
    expect(validateStaminaProfile({ ...ok, blockingRegenMultiplier: 1.1 })).toMatch(/≤ 1/);
    expect(validateStaminaProfile({ ...ok, sprintRecoverThreshold: 0 })).toMatch(/\(0, max]/);
    expect(validateStaminaProfile({ ...ok, sprintRecoverThreshold: 101 })).toMatch(/\(0, max]/);
    const world = new World({ seed: 1 }).register(StaminaComponent);
    expect(() => {
      giveStamina(world, world.spawn(), { ...ok, max: 0 });
    }).toThrow(RangeError);
  });

  it('uses a custom profile', () => {
    const { world, knight, pool, steps } = setup({
      ...DEFAULT_STAMINA_PROFILE,
      max: 60,
      regenPerSecond: 60,
      regenDelayTicks: 0,
    });
    expect(pool().current).toBe(60);
    spendStamina(world, knight, 'attack', 30);
    steps(10);
    expect(pool().current).toBeCloseTo(40, 9);
  });

  it('AC-3 (mw-e04.16): a noSprint profile never sprints, survives a snapshot and is validated', () => {
    const profile = { ...DEFAULT_STAMINA_PROFILE, noSprint: true as const };
    expect(validateStaminaProfile(profile)).toBeUndefined();
    expect(validateStaminaProfile({ ...profile, noSprint: false })).toMatch(/noSprint/);
    const s = setup(profile);
    expect(canSprint(s.pool())).toBe(false);
    expect(setSprintHeld(s.world, s.knight, true)).toBe(false);
    s.world.events.flush();
    expect(s.rejected.map((r) => [r.action, r.reason])).toEqual([['sprint', 'overloaded']]);
    s.steps(3);
    expect(s.pool().sprinting).toBe(false);
    const copy = setup().world;
    copy.restore(s.world.snapshot());
    expect(staminaOf(copy, s.knight)?.profile.noSprint).toBe(true);
  });

  it('round-trips through a snapshot deterministically and rejects invalid saved pools', () => {
    const run = () => {
      const s = setup();
      spendStamina(s.world, s.knight, 'attack', 30);
      setBlocking(s.world, s.knight, true);
      s.steps(50);
      return s;
    };
    const a = run();
    expect(hashWorld(a.world)).toBe(hashWorld(run().world));
    const copy = setup().world;
    copy.restore(a.world.snapshot());
    expect(copy.snapshot()).toEqual(a.world.snapshot());
    const row = a.world.snapshot().components['combat.stamina']?.[0]?.[1] as Stamina;
    const bad = (value: unknown) => () => {
      copy.restore({ ...a.world.snapshot(), components: { 'combat.stamina': [[1, value]] } });
    };
    expect(bad(null)).toThrow(/must be an object/);
    expect(bad({ ...row, profile: { ...row.profile, max: -1 } })).toThrow(/max/);
    expect(bad({ ...row, current: 101 })).toThrow(/current/);
    expect(bad({ ...row, current: '5' })).toThrow(/current/);
    expect(bad({ ...row, regenResumesAt: 0.5 })).toThrow(/regenResumesAt/);
    expect(bad({ ...row, regenResumesAt: '1' })).toThrow(/regenResumesAt/);
    expect(bad({ ...row, sprinting: 1 })).toThrow(/sprinting/);
  });

  it('recovers a restored pool that is Exhausted at or above the threshold, and idles when full', () => {
    const { world, knight, pool, recovered } = setup();
    world.set(knight, StaminaComponent, { ...pool(), exhausted: true });
    world.step();
    expect(pool().exhausted).toBe(false);
    expect(recovered).toEqual([{ entity: knight, tick: 0 }]);
    const idle = pool();
    world.step();
    expect(pool()).toBe(idle);
  });
});
