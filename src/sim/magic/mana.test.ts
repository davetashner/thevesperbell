import { describe, expect, it } from 'vitest';
import {
  availableMana,
  DEFAULT_MANA_PROFILE,
  giveMana,
  hashWorld,
  installMana,
  INSUFFICIENT_MANA,
  learnSpell,
  ManaChanged,
  manaGate,
  manaOf,
  ManaComponent,
  MiscastRequested,
  NO_MANA_POOL,
  refundInterrupted,
  releaseMana,
  reserveMana,
  restoreMana,
  SpellCast,
  SpellFizzled,
  spendMana,
  validateManaProfile,
  type ManaChangedInfo,
  type MiscastRequestedInfo,
  type SpellFizzledInfo,
  type Mana,
} from '@sim/index';
import { makeSpell, spellWorld } from './testing';

const bolt = makeSpell('t-bolt', { cost: { mana: 20 } });
const surge = makeSpell('t-surge', {
  cost: { mana: 20 },
  flags: { tooUseful: false, castWhileMoving: false, allowOvercast: true },
});
const cantrip = makeSpell('t-cantrip');

function setup(startMana = 100, profile = DEFAULT_MANA_PROFILE) {
  const s = spellWorld([bolt, surge, cantrip]);
  installMana(s.world, s.pipeline);
  const caster = s.spawn();
  giveMana(s.world, caster, profile);
  for (const id of ['t-bolt', 't-surge', 't-cantrip']) learnSpell(s.world, caster, id);
  s.world.set(caster, ManaComponent, {
    profile,
    current: startMana,
    reserved: 0,
    regenResumesAt: 1000,
  });
  const changed: ManaChangedInfo[] = [];
  const miscasts: MiscastRequestedInfo[] = [];
  const fizzled: SpellFizzledInfo[] = [];
  s.world.events.on(ManaChanged, (e) => changed.push(e));
  s.world.events.on(MiscastRequested, (e) => miscasts.push(e));
  s.world.events.on(SpellFizzled, (e) => fizzled.push(e));
  const mana = (): Mana => {
    const m = manaOf(s.world, caster);
    if (m === undefined) throw new Error('no pool');
    return m;
  };
  const cast = (spell: string) => {
    s.world.step([{ type: 'cast', caster, spell }]);
  };
  const steps = (n: number) => {
    for (let i = 0; i < n; i++) s.world.step();
  };
  return { ...s, caster, changed, miscasts, fizzled, mana, cast, steps };
}

describe('mana pool', () => {
  it('AC-1: casting a 20-cost spell from 50/100 leaves 30 and emits ManaChanged', () => {
    const s = setup(50);
    s.changed.length = 0;
    s.cast('t-bolt');
    expect(s.mana().current).toBe(30);
    expect(s.changed).toEqual([
      { entity: s.caster, tick: 0, current: 30, max: 100, delta: -20, reason: 'spend' },
    ]);
  });

  it('AC-2: regen 5/s after a 1.5 s delay gives exactly 10 mana 3.5 s after a cast', () => {
    const s = setup(50);
    s.cast('t-bolt');
    s.steps(210);
    expect(s.mana().current).toBe(40);
    // Nothing regenerates inside the delay.
    const t = setup(50);
    t.cast('t-bolt');
    t.steps(90);
    expect(t.mana().current).toBe(30);
  });

  it('AC-2: a second cast restarts the delay, and regen stops at max', () => {
    const s = setup(50);
    s.cast('t-bolt');
    s.steps(60);
    s.cast('t-bolt');
    s.steps(90);
    expect(s.mana().current).toBe(10);
    s.steps(60 * 30);
    expect(s.mana().current).toBe(100);
    const events = s.changed.length;
    s.steps(10);
    expect(s.changed.length).toBe(events);
  });

  it('AC-3: a 20-cost spell that disallows over-cast is refused at 10 mana, unchanged', () => {
    const s = setup(10);
    s.changed.length = 0;
    s.cast('t-bolt');
    expect(s.fizzled).toMatchObject([{ reason: INSUFFICIENT_MANA, stage: 'validate' }]);
    expect(s.mana().current).toBe(10);
    expect(s.changed).toEqual([]);
    expect(s.miscasts).toEqual([]);
  });

  it('AC-4: an over-cast with 10 mana requests a miscast for the 10 deficit and empties the pool', () => {
    const s = setup(10);
    s.cast('t-surge');
    expect(s.mana().current).toBe(0);
    expect(s.miscasts).toEqual([
      { tick: 0, caster: s.caster, spell: 't-surge', deficit: 10, severity: 0.5 },
    ]);
    expect(s.fizzled).toEqual([]);
    expect(s.changed.at(-1)).toMatchObject({ delta: -10, reason: 'overcast' });
  });

  it('AC-4: an over-cast at 0 mana has severity 1, and a covered over-cast spell is a plain spend', () => {
    const s = setup(0);
    s.cast('t-surge');
    expect(s.miscasts).toMatchObject([{ deficit: 20, severity: 1 }]);
    const full = setup(100);
    full.cast('t-surge');
    expect(full.miscasts).toEqual([]);
    expect(full.mana().current).toBe(80);
  });

  it('AC-5: an interrupted cast refunds 50% of what it spent, configurable', () => {
    const s = setup(50);
    s.cast('t-bolt');
    expect(refundInterrupted(s.world, s.caster, 20)).toBe(10);
    expect(s.mana().current).toBe(40);
    s.steps(1);
    expect(s.changed.find((e) => e.reason === 'refund')).toMatchObject({ delta: 10 });
    const custom = setup(50, { ...DEFAULT_MANA_PROFILE, interruptRefund: 0.25 });
    expect(refundInterrupted(custom.world, custom.caster, 20)).toBe(5);
  });

  it('free casts neither check nor spend', () => {
    const s = setup(5);
    const result = s.pipeline.cast(s.world, { caster: s.caster, spell: 't-bolt', source: 'free' });
    expect(result.status).toBe('cast');
    expect(s.mana().current).toBe(5);
  });

  it('zero-cost spells need no pool; costed spells need one', () => {
    const s = setup();
    const bare = s.spawn();
    learnSpell(s.world, bare, 't-cantrip');
    learnSpell(s.world, bare, 't-bolt');
    expect(s.pipeline.cast(s.world, { caster: bare, spell: 't-cantrip' }).status).toBe('cast');
    expect(s.pipeline.cast(s.world, { caster: bare, spell: 't-bolt' })).toMatchObject({
      reason: NO_MANA_POOL,
    });
    s.cast('t-cantrip');
    expect(s.mana().current).toBe(100);
  });

  it('reservations hold mana from casts and regen, and release frees or pays it', () => {
    const s = setup(50);
    expect(reserveMana(s.world, s.caster, 40)).toBe(true);
    expect(availableMana(s.world, s.caster)).toBe(10);
    expect(reserveMana(s.world, s.caster, 11)).toBe(false);
    s.cast('t-bolt');
    expect(s.fizzled).toMatchObject([{ reason: INSUFFICIENT_MANA }]);
    expect(releaseMana(s.world, s.caster, 15, false)).toBe(15);
    expect(s.mana()).toMatchObject({ reserved: 25, current: 50 });
    expect(releaseMana(s.world, s.caster, 100, true)).toBe(25);
    expect(s.mana()).toMatchObject({ reserved: 0, current: 25 });
    s.steps(1);
    expect(s.changed.find((e) => e.reason === 'release')).toMatchObject({ delta: -25 });
    expect(availableMana(s.world, 9999)).toBe(0);
  });

  it('restoreMana clamps at max without touching the regen delay; spendMana(0) is a no-op', () => {
    const s = setup(50);
    expect(spendMana(s.world, s.caster, 0)).toBe(0);
    expect(restoreMana(s.world, s.caster, 80)).toBe(50);
    expect(s.mana().current).toBe(100);
    expect(spendMana(s.world, s.caster, 500)).toBe(100);
    expect(s.mana().current).toBe(0);
  });

  it('rejects invalid amounts and missing pools', () => {
    const s = setup();
    expect(() => spendMana(s.world, s.caster, -1)).toThrow(RangeError);
    expect(() => refundInterrupted(s.world, s.caster, Number.NaN)).toThrow(RangeError);
    expect(() => reserveMana(s.world, s.caster, -1)).toThrow(RangeError);
    expect(() => spendMana(s.world, s.spawn(), 1)).toThrow(/no mana pool/);
  });

  it('validates profiles', () => {
    expect(validateManaProfile(DEFAULT_MANA_PROFILE)).toBeUndefined();
    expect(validateManaProfile(null)).toMatch(/object/);
    expect(validateManaProfile({ ...DEFAULT_MANA_PROFILE, max: 0 })).toMatch(/max/);
    expect(validateManaProfile({ ...DEFAULT_MANA_PROFILE, regenPerSecond: -1 })).toMatch(/regen/);
    expect(validateManaProfile({ ...DEFAULT_MANA_PROFILE, regenDelayTicks: 1.5 })).toMatch(/ticks/);
    expect(validateManaProfile({ ...DEFAULT_MANA_PROFILE, interruptRefund: 2 })).toMatch(/≤ 1/);
    expect(() => {
      giveMana(setup().world, 1, { ...DEFAULT_MANA_PROFILE, max: 0 });
    }).toThrow(RangeError);
  });

  it('the gate is a plain CastGate named mana', () => {
    expect(manaGate().name).toBe('mana');
  });

  it('round-trips through a snapshot deterministically and rejects invalid saved pools', () => {
    const run = () => {
      const s = setup(50);
      s.cast('t-bolt');
      s.steps(100);
      return s;
    };
    const a = run();
    expect(hashWorld(a.world)).toBe(hashWorld(run().world));
    const copy = setup().world;
    copy.restore(a.world.snapshot());
    expect(copy.snapshot()).toEqual(a.world.snapshot());
    const row = a.world.snapshot().components['magic.mana']?.[0]?.[1] as Mana;
    const bad = (value: unknown) => () => {
      copy.restore({ ...a.world.snapshot(), components: { 'magic.mana': [[1, value]] } });
    };
    expect(bad(null)).toThrow(/must be an object/);
    expect(bad({ ...row, profile: { ...row.profile, max: -1 } })).toThrow(/max/);
    expect(bad({ ...row, current: 101 })).toThrow(/current/);
    expect(bad({ ...row, reserved: 99 })).toThrow(/reserved/);
    expect(bad({ ...row, regenResumesAt: 0.5 })).toThrow(/regenResumesAt/);
    expect(ManaComponent.name).toBe('magic.mana');
    expect(SpellCast.name).toBe('SpellCast');
  });
});
