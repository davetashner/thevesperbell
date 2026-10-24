import { describe, expect, it } from 'vitest';
import type { SpellEntry } from '@content/index';
import { DAMAGE_COMPONENTS, Died, giveCombatant, PoiseBroken } from '../combat/damage';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { addProperties, registerWorldProperties } from '../properties/components';
import { PlacementComponent, placeEntity } from '../stimulus/placement';
import { installStimuli, stimulusSystem } from '../stimulus/stimulus';
import { learnSpell, StatusLedgerComponent, statusLedger } from './components';
import {
  ALREADY_CASTING,
  CastCancelled,
  CastLedgerComponent,
  castStateOf,
  CastStarted,
  ChannelEnded,
  ChannelTicked,
  installCasting,
  SpellInterrupted,
  type CancelCastCommand,
} from './casting';
import { CooldownsComponent, cooldownRemaining, ON_COOLDOWN, secondsToTicks } from './cooldown';
import { SpellCast, SpellEffectApplied, SpellFizzled } from './events';
import {
  DEFAULT_MANA_PROFILE,
  giveMana,
  installMana,
  ManaComponent,
  manaOf,
  MiscastRequested,
} from './mana';
import { installSpells, type CastCommand, type CastGate } from './pipeline';
import { makeSpell } from './testing';

type Input = CastCommand | CancelCastCommand;

const slow = makeSpell('t-slow', { castTime: 0.8, cost: { mana: 20 } });
const channel = (over: Partial<NonNullable<SpellEntry['channel']>> = {}) => ({
  interval: 0.25,
  manaPerSecond: 16,
  maxDuration: 1,
  ...over,
});
const beam = makeSpell('t-beam', { channel: channel() });
const beamCd = makeSpell('t-beam-cd', { channel: channel(), cooldown: 2 });
const windBeam = makeSpell('t-wind-beam', {
  castTime: 0.5,
  cost: { mana: 10 },
  channel: channel(),
});
const touchBeam = makeSpell('t-touch-beam', {
  delivery: { kind: 'touch', reach: 2 },
  channel: channel(),
});
const walker = makeSpell('t-walker', {
  castTime: 0.8,
  cost: { mana: 20 },
  flags: { tooUseful: false, castWhileMoving: true, allowOvercast: false },
});
const cd = makeSpell('t-cd', { cooldown: 5 });
const touch = makeSpell('t-touch', { castTime: 0.5, delivery: { kind: 'touch', reach: 2 } });
const free = makeSpell('t-free');
const freeBeam = makeSpell('t-free-beam', { channel: channel({ manaPerSecond: 0 }) });
const slowCd = makeSpell('t-slow-cd', { castTime: 0.5, cooldown: 5 });
const windFree = makeSpell('t-wind-free', { castTime: 0.8 });
const ALL = [
  windFree,
  freeBeam,
  slowCd,
  slow,
  beam,
  beamCd,
  windBeam,
  touchBeam,
  walker,
  cd,
  touch,
  free,
];

function fullPool(s: { world: World<Input>; caster: EntityId }) {
  const pool = manaOf(s.world, s.caster);
  if (pool === undefined) throw new Error('no pool');
  return pool;
}

function setup(opts: { mana?: boolean; startMana?: number; placed?: boolean } = {}) {
  const world = installStimuli(registerWorldProperties(new World<Input>({ seed: 3 })));
  world.register(...DAMAGE_COMPONENTS);
  const byId = new Map(ALL.map((s) => [s.id, s]));
  const pipeline = installSpells(world, { spells: (id) => byId.get(id) });
  const withMana = opts.mana ?? true;
  installMana(world, pipeline);
  const casting = installCasting(world, pipeline);
  world.addSystem(stimulusSystem());
  const caster = world.spawn();
  giveCombatant(world, caster, { health: 100 });
  addProperties(world, caster, { temperature: 20 });
  if (opts.placed ?? true) placeEntity(world, caster, { x: 0, y: 0, z: 0 }, 0.5);
  for (const spell of ALL) learnSpell(world, caster, spell.id);
  if (withMana) {
    giveMana(world, caster, DEFAULT_MANA_PROFILE);
    const pool = manaOf(world, caster);
    if (pool === undefined) throw new Error('no pool');
    world.set(caster, ManaComponent, {
      ...pool,
      current: opts.startMana ?? 100,
      regenResumesAt: 100000,
    });
  }
  const casts: number[] = [];
  const applied: number[] = [];
  const fizzled: string[] = [];
  const interrupts: { reason: string; miscast: boolean; progress: number; phase: string }[] = [];
  const miscasts: { cause?: string; severity: number }[] = [];
  const cancelled: string[] = [];
  const ticks: number[] = [];
  const ends: { reason: string; ticks: number; tick: number }[] = [];
  const started: string[] = [];
  world.events.on(SpellCast, (e) => casts.push(e.tick));
  world.events.on(SpellEffectApplied, (e) => applied.push(e.tick));
  world.events.on(SpellFizzled, (e) => fizzled.push(e.reason));
  world.events.on(SpellInterrupted, (e) => interrupts.push(e));
  world.events.on(MiscastRequested, (e) => miscasts.push(e));
  world.events.on(CastCancelled, (e) => cancelled.push(e.reason));
  world.events.on(ChannelTicked, (e) => ticks.push(e.tick));
  world.events.on(ChannelEnded, (e) => ends.push(e));
  world.events.on(CastStarted, (e) => started.push(e.phase));
  const cast = (spell: string, extra: Partial<CastCommand> = {}) => {
    world.step([{ type: 'cast', caster, spell, ...extra }]);
  };
  const steps = (n: number) => {
    for (let i = 0; i < n; i++) world.step();
  };
  const mana = () => manaOf(world, caster)?.current;
  const stand = (x: number) => {
    placeEntity(world, caster, { x, y: 0, z: 0 }, 0.5);
  };
  const status = (name: string) => {
    const [id, ledger] = statusLedger(world);
    world.set(id, StatusLedgerComponent, {
      entries: [
        ...ledger.entries,
        { target: caster, status: name, stacks: 1, expiresTick: 100000, source: caster },
      ],
    });
  };
  const hit = (target: EntityId) => ({ tick: world.tick, target, instigator: null, source: null });
  return {
    world,
    pipeline,
    casting,
    caster,
    casts,
    applied,
    fizzled,
    interrupts,
    miscasts,
    cancelled,
    ticks,
    ends,
    started,
    cast,
    steps,
    mana,
    stand,
    status,
    hit,
  };
}

describe('cast times', () => {
  it('AC-1: castTime 800 ms spawns no delivery before 800 ms and exactly one at 800 ms', () => {
    const s = setup();
    s.cast('t-slow');
    const start = s.world.tick - 1;
    s.steps(46);
    expect(s.casts).toEqual([]);
    expect(s.started).toEqual(['winding']);
    expect(castStateOf(s.world, s.caster)?.phase).toBe('winding');
    s.steps(1 + 5);
    expect(s.casts).toEqual([start + secondsToTicks(s.world, 0.8)]);
    expect(s.casts).toEqual([48]);
    expect(s.applied).toEqual([48]);
    expect(castStateOf(s.world, s.caster)).toBeUndefined();
    expect(s.mana()).toBe(80);
  });

  it('holds the mana during the wind-up so nothing else can spend it', () => {
    const s = setup({ startMana: 25 });
    s.cast('t-slow');
    expect(manaOf(s.world, s.caster)?.reserved).toBe(20);
    s.steps(60);
    expect(manaOf(s.world, s.caster)?.reserved).toBe(0);
    expect(s.mana()).toBe(5);
  });

  it('an instant spell casts at once without a cast state', () => {
    const s = setup();
    s.cast('t-free');
    expect(s.casts).toEqual([0]);
    expect(s.started).toEqual([]);
  });

  it('refuses a cast at once for a missing spell, a gate or a busy caster', () => {
    const s = setup({ startMana: 10 });
    s.cast('nope');
    s.cast('t-slow');
    expect(s.fizzled).toEqual(['unknown-spell', 'insufficient-mana']);
    s.world.set(s.caster, ManaComponent, { ...fullPool(s), current: 100 });
    s.cast('t-slow');
    s.cast('t-slow');
    expect(s.fizzled.at(-1)).toBe(ALREADY_CASTING);
    expect(s.started).toEqual(['winding']);
  });

  it('works without a mana pool or placement (nothing is held, no movement rule)', () => {
    const s = setup({ mana: false, placed: false });
    s.cast('t-wind-free');
    s.steps(60);
    expect(s.casts).toEqual([48]);
  });

  it('a spell that cannot reach anything fizzles at release and frees the held mana', () => {
    const s = setup();
    s.cast('t-touch');
    s.steps(40);
    expect(s.fizzled).toEqual(['no-target']);
    expect(s.casts).toEqual([]);
    expect(manaOf(s.world, s.caster)?.reserved).toBe(0);
  });

  it('a gate that refuses by release time fizzles a channel and ends the cast', () => {
    const s = setup();
    let refuse = false;
    const gate: CastGate = { name: 'late', check: () => (refuse ? 'late-no' : undefined) };
    s.pipeline.addGate(gate);
    s.cast('t-wind-beam');
    refuse = true;
    s.steps(40);
    expect(s.fizzled).toEqual(['late-no']);
    expect(castStateOf(s.world, s.caster)).toBeUndefined();
    expect(s.mana()).toBe(100);
  });
});

describe('channeling', () => {
  it('AC-2: a 250 ms channel at 4 mana/tick channelled for 1 s ticks 4 times and drains 16 mana', () => {
    const s = setup();
    s.cast('t-beam');
    s.steps(70);
    expect(s.ticks).toEqual([15, 30, 45, 60]);
    expect(s.applied).toEqual([15, 30, 45, 60]);
    expect(s.ends).toEqual([
      { reason: 'duration', ticks: 4, tick: 60, caster: s.caster, spell: 't-beam' },
    ]);
    expect(s.mana()).toBe(84);
    expect(castStateOf(s.world, s.caster)).toBeUndefined();
  });

  it('winds up, pays the cost once, then ticks', () => {
    const s = setup();
    s.cast('t-wind-beam');
    s.steps(30);
    expect(s.started).toEqual(['winding', 'channeling']);
    s.steps(100);
    expect(s.ticks).toHaveLength(4);
    expect(s.mana()).toBe(100 - 10 - 16);
  });

  it('the player ends a channel early; ticks so far stand', () => {
    const s = setup();
    s.cast('t-beam');
    s.steps(20);
    expect(s.casting.cancel(s.caster)).toBe(true);
    s.world.events.flush();
    expect(s.ends.map((e) => [e.reason, e.ticks])).toEqual([['cancelled', 1]]);
    expect(s.casting.cancel(s.caster)).toBe(false);
  });

  it('ends out-of-mana without ticking when the next tick cannot be paid', () => {
    const s = setup({ startMana: 6 });
    s.cast('t-beam');
    s.steps(70);
    expect(s.ticks).toEqual([15]);
    expect(s.ends.map((e) => e.reason)).toEqual(['out-of-mana']);
    expect(s.mana()).toBe(2);
  });

  it('a channel with a tick price and no mana pool ends out-of-mana', () => {
    const s = setup({ mana: false });
    s.cast('t-beam');
    s.steps(20);
    expect(s.ends.map((e) => e.reason)).toEqual(['out-of-mana']);
  });

  it('ends fizzled when a tick reaches nothing', () => {
    const s = setup();
    s.cast('t-touch-beam');
    s.steps(20);
    expect(s.ends.map((e) => e.reason)).toEqual(['fizzled']);
    expect(s.mana()).toBe(100);
  });

  it('a free channel (no mana per second) ticks without a pool', () => {
    const s = setup({ mana: false });
    s.cast('t-free-beam');
    s.steps(70);
    expect(s.ticks).toHaveLength(4);
    expect(s.ends.map((e) => e.reason)).toEqual(['duration']);
  });

  it('its cooldown starts when the channel ends', () => {
    const s = setup();
    s.cast('t-beam-cd');
    expect(cooldownRemaining(s.world, s.caster, 't-beam-cd')).toBe(119);
    s.steps(70);
    expect(s.ends).toHaveLength(1);
    expect(cooldownRemaining(s.world, s.caster, 't-beam-cd')).toBe(109);
    s.casting.begin({ caster: s.caster, spell: 't-beam-cd' });
    s.world.events.flush();
    expect(s.fizzled).toEqual([ON_COOLDOWN]);
  });
});

describe('interruption', () => {
  it('AC-3: a poise-breaking hit on a winding caster interrupts it, spawns no delivery and refunds half', () => {
    const s = setup();
    s.cast('t-slow');
    s.steps(10);
    s.world.events.emit(PoiseBroken, { ...s.hit(s.caster) });
    s.steps(60);
    expect(s.interrupts).toEqual([
      expect.objectContaining({ reason: 'poise-broken', miscast: false, phase: 'winding' }),
    ]);
    expect(s.interrupts[0]?.progress).toBeCloseTo(10 / 48, 1);
    expect(s.casts).toEqual([]);
    expect(s.miscasts).toEqual([]);
    expect(castStateOf(s.world, s.caster)).toBeUndefined();
    expect(s.mana()).toBe(90);
  });

  it('a poise break on someone not casting does nothing', () => {
    const s = setup();
    s.world.events.emit(PoiseBroken, { ...s.hit(s.caster) });
    s.steps(1);
    expect(s.interrupts).toEqual([]);
    expect(s.casting.interrupt(s.caster, 'died')).toBe(false);
  });

  it('AC-6: interruption in the last 20% of the wind-up requests a miscast and keeps the mana spent', () => {
    const s = setup();
    s.cast('t-slow');
    s.steps(40);
    s.world.events.emit(PoiseBroken, { ...s.hit(s.caster) });
    s.steps(1);
    expect(s.interrupts).toEqual([
      expect.objectContaining({ miscast: true, reason: 'poise-broken' }),
    ]);
    expect(s.miscasts).toHaveLength(1);
    expect(s.miscasts[0]).toMatchObject({ cause: 'interrupted' });
    expect(s.miscasts[0]?.severity).toBeCloseTo(41 / 48, 2);
    expect(s.casts).toEqual([]);
    expect(s.mana()).toBe(80);
  });

  it('AC-6: just before the last 20% it is a clean fizzle', () => {
    const s = setup();
    s.cast('t-slow');
    s.steps(36);
    s.world.events.emit(PoiseBroken, { ...s.hit(s.caster) });
    s.steps(1);
    expect(s.miscasts).toEqual([]);
    expect(s.interrupts[0]?.miscast).toBe(false);
  });

  it('a channel interrupted by a poise break ends and is never miscast eligible', () => {
    const s = setup();
    s.cast('t-beam');
    s.steps(20);
    s.world.events.emit(PoiseBroken, { ...s.hit(s.caster) });
    s.steps(1);
    expect(s.interrupts).toEqual([
      expect.objectContaining({ phase: 'channeling', miscast: false, progress: 1 }),
    ]);
    expect(s.ends.map((e) => e.reason)).toEqual(['interrupted']);
    expect(s.miscasts).toEqual([]);
  });

  it.each(['silenced', 'grappled', 'restrained'])('a %s status interrupts a wind-up', (name) => {
    const s = setup();
    s.cast('t-slow');
    s.steps(5);
    s.status(name);
    s.steps(2);
    expect(s.interrupts.map((i) => i.reason)).toEqual([name]);
    expect(s.casts).toEqual([]);
  });

  it('and refuses a new cast while it lasts', () => {
    const s = setup();
    s.status('silenced');
    s.cast('t-slow');
    expect(s.fizzled).toEqual(['silenced']);
  });

  it('death frees the held mana without a refund or a miscast', () => {
    const s = setup();
    s.cast('t-slow');
    s.steps(45);
    s.world.events.emit(Died, {
      tick: s.world.tick,
      target: s.caster,
      killer: null,
      source: null,
      tags: [],
    });
    s.steps(1);
    expect(s.interrupts.map((i) => [i.reason, i.miscast])).toEqual([['died', false]]);
    expect(s.mana()).toBe(100);
    expect(s.miscasts).toEqual([]);
  });
});

describe('cooldowns', () => {
  it('AC-4: a 5 s cooldown refuses a recast at 4.9 s and allows it at 5.0 s', () => {
    const s = setup();
    s.cast('t-cd');
    expect(s.casts).toEqual([0]);
    s.steps(293);
    s.cast('t-cd');
    expect(s.world.tick).toBe(295);
    expect(s.fizzled).toEqual([ON_COOLDOWN]);
    s.steps(4);
    s.cast('t-cd');
    expect(s.world.tick).toBe(300);
    expect(s.casts).toEqual([0]);
    s.cast('t-cd');
    expect(s.casts).toEqual([0, 300]);
  });

  it('is per spell and per caster, and forgets finished cooldowns', () => {
    const s = setup();
    s.cast('t-cd');
    s.cast('t-free');
    expect(s.casts).toHaveLength(2);
    expect(cooldownRemaining(s.world, s.caster, 't-free')).toBe(0);
    expect(cooldownRemaining(s.world, s.caster, 't-cd')).toBe(298);
  });

  it('does not start when a wind-up is interrupted', () => {
    const s = setup();
    s.cast('t-slow-cd');
    s.steps(5);
    s.world.events.emit(PoiseBroken, { ...s.hit(s.caster) });
    s.steps(1);
    expect(cooldownRemaining(s.world, s.caster, 't-slow-cd')).toBe(0);
    s.cast('t-slow-cd');
    s.steps(40);
    expect(s.casts).toHaveLength(1);
    expect(cooldownRemaining(s.world, s.caster, 't-slow-cd')).toBeGreaterThan(250);
    expect(secondsToTicks(s.world, 0)).toBe(0);
    expect(secondsToTicks(s.world, 0.001)).toBe(1);
  });
});

describe('cancelling and moving', () => {
  it('player cancel calls off a wind-up with a full refund and no miscast', () => {
    const s = setup();
    s.cast('t-slow');
    s.steps(45);
    expect(s.casting.cancel(s.caster)).toBe(true);
    s.world.events.flush();
    expect(s.cancelled).toEqual(['player']);
    expect(s.mana()).toBe(100);
    expect(s.miscasts).toEqual([]);
    s.steps(10);
    expect(s.casts).toEqual([]);
  });

  it('a cancel-cast command does the same', () => {
    const s = setup();
    s.cast('t-slow');
    s.world.step([{ type: 'cancel-cast', caster: s.caster }]);
    expect(s.cancelled).toEqual(['player']);
    s.world.step([{ type: 'cancel-cast', caster: s.caster }]);
    expect(s.cancelled).toEqual(['player']);
  });

  it('AC-5: moving more than 0.5 m during wind-up cancels it without miscast and with a refund', () => {
    const s = setup();
    s.cast('t-slow');
    s.steps(10);
    s.stand(0.4);
    s.steps(2);
    expect(s.cancelled).toEqual([]);
    s.stand(0.6);
    s.steps(1);
    expect(s.cancelled).toEqual(['moved']);
    expect(s.miscasts).toEqual([]);
    expect(s.interrupts).toEqual([]);
    expect(s.mana()).toBe(100);
    s.steps(60);
    expect(s.casts).toEqual([]);
  });

  it('AC-5: castWhileMoving keeps the cast going', () => {
    const s = setup();
    s.cast('t-walker');
    s.stand(3);
    s.steps(60);
    expect(s.casts).toEqual([48]);
  });

  it('moving ends a channel', () => {
    const s = setup();
    s.cast('t-beam');
    s.steps(5);
    s.stand(2);
    s.steps(1);
    expect(s.ends.map((e) => e.reason)).toEqual(['moved']);
  });

  it('a caster whose placement is removed is not treated as moving', () => {
    const s = setup();
    s.cast('t-slow');
    s.world.remove(s.caster, PlacementComponent);
    s.steps(60);
    expect(s.casts).toEqual([48]);
  });
});

describe('several casters and requests', () => {
  it('keeps each casters casts apart, and carries the target and aim to release', () => {
    const s = setup();
    const other = s.world.spawn();
    learnSpell(s.world, other, 't-wind-free');
    learnSpell(s.world, other, 't-touch');
    placeEntity(s.world, other, { x: -5, y: 0, z: 0 }, 0.5);
    const target = s.world.spawn();
    placeEntity(s.world, target, { x: 1, y: 0, z: 0 }, 0.5);
    s.cast('t-wind-free');
    expect(
      s.casting.begin({ caster: other, spell: 't-touch', target, aim: { x: 0, y: 0, z: 1 } }),
    ).toEqual({
      status: 'started',
    });
    expect(castStateOf(s.world, other)).toMatchObject({ target, aim: { x: 0, y: 0, z: 1 } });
    s.steps(60);
    expect(s.casts).toHaveLength(1);
    expect(s.fizzled).toEqual(['out-of-reach']);
    expect(s.casting.cancel(other)).toBe(false);
    s.casting.begin({ caster: other, spell: 't-wind-free' });
    s.casting.begin({ caster: s.caster, spell: 't-wind-free' });
    expect(s.casting.cancel(s.caster)).toBe(true);
    expect(castStateOf(s.world, other)?.spell).toBe('t-wind-free');
    expect(s.casting.cancel(other)).toBe(true);
  });

  it('ticks two channels side by side', () => {
    const s = setup();
    const other = s.world.spawn();
    learnSpell(s.world, other, 't-free-beam');
    s.cast('t-free-beam');
    s.casting.begin({ caster: other, spell: 't-free-beam' });
    s.steps(20);
    expect(s.ticks).toEqual([15, 16]);
    expect(castStateOf(s.world, other)?.ticks).toBe(1);
    expect(castStateOf(s.world, s.caster)?.ticks).toBe(1);
  });

  it('refuses a spell the caster has not learned', () => {
    const s = setup();
    const other = s.world.spawn();
    expect(s.pipeline.check(s.world, { caster: other, spell: 't-free' })).toBe('unknown-spell');
  });
});

describe('wiring', () => {
  it('needs the mana component, and its ledgers are installed', () => {
    const world = installStimuli(registerWorldProperties(new World<CastCommand>({ seed: 3 })));
    const pipeline = installSpells(world, { spells: () => undefined });
    expect(() => installCasting(world, pipeline)).toThrow('install mana before casting');
    world.register(CastLedgerComponent, CooldownsComponent);
    expect(() => castStateOf(world, 1)).toThrow('casting is not installed');
    expect(() => cooldownRemaining(world, 1, 'x')).toThrow('casting is not installed');
  });

  it('routes cast commands once, and checks a spell and its caster', () => {
    const s = setup();
    expect(() => s.pipeline.handleCommands(() => undefined)).toThrow('already have a handler');
    expect(s.pipeline.check(s.world, { caster: s.caster, spell: 'nope' })).toBe('unknown-spell');
    const other = s.world.spawn();
    learnSpell(s.world, other, 't-free');
    s.world.destroy(other);
    s.world.step();
    expect(s.pipeline.check(s.world, { caster: other, spell: 't-free' })).toBe('unknown-caster');
    expect(() => {
      s.pipeline.spend(s.world, { caster: s.caster, spell: 'nope' });
    }).toThrow('unknown spell');
  });

  it('without the cast phase a cast command still casts at once', () => {
    const world = installStimuli(registerWorldProperties(new World<CastCommand>({ seed: 3 })));
    world.register(...DAMAGE_COMPONENTS);
    const pipeline = installSpells(world, { spells: (id) => (id === 't-slow' ? slow : undefined) });
    const caster = world.spawn();
    learnSpell(world, caster, 't-slow');
    const casts: number[] = [];
    world.events.on(SpellCast, (e) => casts.push(e.tick));
    world.step([{ type: 'cast', caster, spell: 't-slow' }]);
    expect(casts).toEqual([0]);
    expect(pipeline.check(world, { caster, spell: 't-slow' })).toBeUndefined();
  });
});
