import { describe, expect, it } from 'vitest';
import type { StatusEntry } from '@content/index';
import { healthOf } from '../combat/damage';
import type { EntityId } from '../core/component';
import { addProperties, setProperty } from '../properties/components';
import { installCasting } from './casting';
import { learnSpell, spellStatusesOf } from './components';
import { SpellFizzled } from './events';
import { installMana } from './mana';
import {
  applyStatus,
  dispelStatuses,
  hasStatusTag,
  modifiedStat,
  StatusEnded,
  StatusTicked,
  type StatusEndReason,
  type StatusLookup,
} from './statuses';
import { damageOp, makeSpell, spellWorld, statusOp } from './testing';

function def(id: string, over: Partial<StatusEntry> = {}): StatusEntry {
  return {
    id,
    name: id,
    description: id,
    stack: { rule: 'refresh' },
    tags: [],
    modifiers: [],
    sourceBound: false,
    breakWhen: [],
    ...over,
  };
}

const refresh = def('t-refresh');
const stacking = def('t-stack', { stack: { rule: 'stack', max: 3 } });
const keeper = def('t-keep', { stack: { rule: 'keep' } });
const rooted = def('t-rooted', {
  tags: ['magical'],
  sourceBound: true,
  modifiers: [{ stat: 'moveSpeed', mode: 'multiply', value: 0 }],
  breakWhen: [{ entity: 'source', property: 'burning', is: 'eq', value: true }],
});
const magicA = def('t-magic-a', { tags: ['magical'] });
const magicB = def('t-magic-b', { tags: ['magical', 'buff'] });
const mundane = def('t-mundane', { tags: ['mundane'] });
const silenced = def('silenced', { tags: ['magical'] });
const slowed = def('t-slowed', {
  stack: { rule: 'stack', max: 3 },
  modifiers: [
    { stat: 'moveSpeed', mode: 'multiply', value: 0.5 },
    { stat: 'visibility', mode: 'add', value: 0.1 },
  ],
});
const burn = def('t-burn', {
  tick: {
    interval: 1,
    ops: [
      {
        op: 'damage',
        amounts: { fire: 3 },
        poiseDamage: 0,
        staminaDamage: 0,
        impulse: { x: 0, y: 0, z: 0 },
        impactForce: 0,
        tags: [],
      },
    ],
  },
  breakWhen: [{ entity: 'target', property: 'wetness', is: 'gte', value: 0.5 }],
});
const frail = def('t-frail', {
  breakWhen: [
    { entity: 'target', property: 'material', is: 'ne', value: 'generic' },
    { entity: 'target', property: 'hp', is: 'lte', value: 0 },
  ],
});
const tether = def('t-tether', {
  breakWhen: [{ entity: 'source', property: 'burning', is: 'eq', value: true }],
});
const bare = def('t-bare', { stack: { rule: 'stack' } });
const DEFS = [
  frail,
  tether,
  bare,
  refresh,
  stacking,
  keeper,
  rooted,
  magicA,
  magicB,
  mundane,
  silenced,
  slowed,
  burn,
];

function setup(spells = [makeSpell('t-noop')]) {
  const s = spellWorld(spells, 3, DEFS);
  const lookup: StatusLookup = s.pipeline.statuses;
  const ended: [string, StatusEndReason][] = [];
  s.world.events.on(StatusEnded, (e) => ended.push([e.status, e.reason]));
  const apply = (d: StatusEntry, target: EntityId, source: EntityId, seconds = 5, stacks = 1) =>
    applyStatus(s.world, d, { target, status: d.id, source, seconds, stacks });
  const steps = (n: number) => {
    for (let i = 0; i < n; i++) s.world.step();
  };
  return { ...s, lookup, ended, apply, steps };
}

const names = (s: ReturnType<typeof setup>, target: EntityId) =>
  spellStatusesOf(s.world, target).map((e) => e.status);

describe('statuses (mw-e06.9)', () => {
  it('AC-1: stack rule "refresh" applied twice 2 s apart with 5 s duration expires 7 s after the first', () => {
    const s = setup();
    const a = s.spawn();
    s.apply(refresh, a, a);
    s.steps(120);
    s.apply(refresh, a, a);
    expect(spellStatusesOf(s.world, a)[0]?.stacks).toBe(1);
    expect(spellStatusesOf(s.world, a)[0]?.expiresTick).toBe(7 * 60);
    s.steps(7 * 60 - 120 - 1); // tick 419 still runs with the status on
    expect(names(s, a)).toEqual(['t-refresh']);
    s.steps(1);
    expect(names(s, a)).toEqual(['t-refresh']);
    s.steps(1); // the tick-420 pass removes it
    expect(names(s, a)).toEqual([]);
    expect(s.ended).toEqual([['t-refresh', 'expired']]);
  });

  it('AC-2: stack rule "stack(max 3)" applied 4 times gives a stack count of 3', () => {
    const s = setup();
    const a = s.spawn();
    for (let i = 0; i < 4; i++) s.apply(stacking, a, a);
    expect(spellStatusesOf(s.world, a)).toHaveLength(1);
    expect(spellStatusesOf(s.world, a)[0]?.stacks).toBe(3);
  });

  it('rule "keep" leaves the first application standing; no definition adds stacks and keeps the longest expiry', () => {
    const s = setup();
    const a = s.spawn();
    s.apply(keeper, a, a, 5);
    s.apply(keeper, a, a, 50);
    expect(spellStatusesOf(s.world, a)[0]?.expiresTick).toBe(300);
    applyStatus(s.world, undefined, { target: a, status: 'raw', source: a, seconds: 5 });
    applyStatus(s.world, undefined, { target: a, status: 'raw', source: a, seconds: 2, stacks: 2 });
    const raw = spellStatusesOf(s.world, a).find((e) => e.status === 'raw');
    expect([raw?.stacks, raw?.expiresTick]).toEqual([3, 300]);
  });

  it('AC-3: a rooted status whose source entity is destroyed ends in the same tick', () => {
    const s = setup();
    const vine = s.spawn();
    const victim = s.spawn(2);
    s.apply(rooted, victim, vine, 30);
    s.steps(3);
    expect(names(s, victim)).toEqual(['t-rooted']);
    s.world.destroy(vine);
    s.world.step();
    expect(names(s, victim)).toEqual([]);
    expect(s.ended).toEqual([['t-rooted', 'source-gone']]);
  });

  it('a destroyed target loses its statuses', () => {
    const s = setup();
    const a = s.spawn();
    const b = s.spawn();
    s.apply(refresh, b, a);
    s.world.destroy(b);
    s.world.step();
    expect(s.ended).toEqual([['t-refresh', 'target-gone']]);
  });

  it('a property-driven break ends rooted when the source entity gains the burning property', () => {
    const s = setup();
    const vine = s.spawn();
    addProperties(s.world, vine, { burning: false });
    const victim = s.spawn(2);
    s.apply(rooted, victim, vine, 30);
    s.steps(2);
    expect(names(s, victim)).toEqual(['t-rooted']);
    setProperty(s.world, vine, 'burning', true);
    s.steps(1);
    expect(names(s, victim)).toEqual([]);
    expect(s.ended).toEqual([['t-rooted', 'broken']]);
  });

  it('a break test on the target (wetness at or above 0.5 puts burning out)', () => {
    const s = setup();
    const a = s.spawn();
    addProperties(s.world, a, { wetness: 0 });
    s.apply(burn, a, a, 30);
    s.steps(1);
    setProperty(s.world, a, 'wetness', 0.4);
    s.steps(1);
    expect(names(s, a)).toEqual(['t-burn']);
    setProperty(s.world, a, 'wetness', 0.6);
    s.steps(1);
    expect(s.ended).toEqual([['t-burn', 'broken']]);
  });

  it('ne and lte break tests; a stack rule without a max stays at one stack; gte ignores non-numbers', () => {
    const s = setup();
    const a = s.spawn();
    addProperties(s.world, a, { material: 'generic', hp: 5 });
    s.apply(frail, a, a, 30);
    s.apply(bare, a, a, 30, 4);
    s.steps(1);
    expect(spellStatusesOf(s.world, a).map((e) => [e.status, e.stacks])).toEqual([
      ['t-frail', 1],
      ['t-bare', 1],
    ]);
    setProperty(s.world, a, 'hp', 0);
    s.steps(1);
    expect(s.ended).toEqual([['t-frail', 'broken']]);
    const b = s.spawn();
    addProperties(s.world, b, { material: 'iron' });
    s.apply(frail, b, b, 30);
    s.steps(1);
    expect(s.ended.at(-1)).toEqual(['t-frail', 'broken']);
    const c = s.spawn();
    s.apply(burn, c, c, 30);
    s.steps(1);
    expect(names(s, c)).toEqual(['t-burn']);
  });

  it('tick ops carry on after the source is gone and skip a target that cannot be hurt', () => {
    const s = setup();
    const source = s.spawn();
    const a = s.spawn();
    const ghost = s.world.spawn();
    s.world.step();
    const ticks: number[] = [];
    s.world.events.on(StatusTicked, (e) => ticks.push(e.total));
    s.apply(burn, a, source, 30);
    s.apply(burn, ghost, source, 30);
    s.world.destroy(source);
    s.steps(61);
    expect(ticks.sort()).toEqual([0, 3]);
    expect(healthOf(s.world, a)?.current).toBe(97);
  });

  it('a break test on a source that no longer exists never holds', () => {
    const s = setup();
    const source = s.spawn();
    const a = s.spawn();
    s.apply(tether, a, source, 30);
    s.world.destroy(source);
    s.steps(2);
    expect(names(s, a)).toEqual(['t-tether']);
  });

  it('statuses applied without a definition carry no modifiers and no tick schedule', () => {
    const s = setup();
    const a = s.spawn();
    applyStatus(s.world, undefined, { target: a, status: 'unknown', source: a, seconds: 5 });
    applyStatus(s.world, undefined, { target: a, status: 't-burn', source: a, seconds: 5 });
    s.steps(70);
    expect(modifiedStat(s.world, s.lookup, a, 'moveSpeed', 4)).toBe(4);
    expect(healthOf(s.world, a)?.current).toBe(100);
  });

  it('AC-4: dispelling tag "magical" from 2 magical and 1 mundane status removes only the 2 magical', () => {
    const s = setup();
    const a = s.spawn();
    const other = s.spawn();
    s.apply(magicA, a, a);
    s.apply(mundane, a, a);
    s.apply(magicB, a, a);
    s.apply(magicA, other, other);
    expect(hasStatusTag(s.world, s.lookup, a, 'magical')).toBe(true);
    const removed = dispelStatuses(s.world, s.lookup, a, 'magical');
    expect(removed.map((e) => e.status)).toEqual(['t-magic-a', 't-magic-b']);
    expect(names(s, a)).toEqual(['t-mundane']);
    expect(names(s, other)).toEqual(['t-magic-a']);
    s.steps(1);
    expect(s.ended).toEqual([
      ['t-magic-a', 'dispelled'],
      ['t-magic-b', 'dispelled'],
    ]);
    expect(hasStatusTag(s.world, s.lookup, a, 'magical')).toBe(false);
  });

  it('modifiers fold per stack: adds first, then multiplies', () => {
    const s = setup();
    const a = s.spawn();
    expect(modifiedStat(s.world, s.lookup, a, 'moveSpeed', 4)).toBe(4);
    const other = s.spawn();
    s.apply(slowed, other, other);
    s.apply(slowed, a, a, 5, 2);
    expect(modifiedStat(s.world, s.lookup, a, 'castSpeed', 1)).toBe(1);
    expect(modifiedStat(s.world, s.lookup, a, 'moveSpeed', 4)).toBe(1);
    expect(modifiedStat(s.world, s.lookup, a, 'visibility', 1)).toBeCloseTo(1.2);
    s.apply(rooted, a, a, 5);
    expect(modifiedStat(s.world, s.lookup, a, 'moveSpeed', 4)).toBe(0);
  });

  it('tick ops deal damage every interval and a refresh keeps the schedule', () => {
    const s = setup();
    const a = s.spawn();
    const ticks: number[] = [];
    s.world.events.on(StatusTicked, (e) => ticks.push(e.total));
    s.apply(burn, a, a, 3.5);
    s.steps(61);
    expect(ticks).toEqual([3]);
    expect(healthOf(s.world, a)?.current).toBe(97);
    s.apply(burn, a, a, 3.5);
    s.steps(60);
    expect(ticks).toEqual([3, 3]);
    expect(healthOf(s.world, a)?.current).toBe(94);
  });

  it('the status op follows the definition: a spell applies stacks up to the cap', () => {
    const spell = makeSpell('t-slow-spell', { effects: [statusOp('t-stack', 5, 2)] });
    const s = setup([spell, makeSpell('t-bolt', { effects: [damageOp({ fire: 1 })] })]);
    const a = s.spawn();
    learnSpell(s.world, a, 't-slow-spell');
    s.world.step([{ type: 'cast', caster: a, spell: 't-slow-spell' }]);
    s.world.step([{ type: 'cast', caster: a, spell: 't-slow-spell' }]);
    expect(spellStatusesOf(s.world, a)[0]?.stacks).toBe(3);
  });

  it('AC-6: a silenced caster attempting a cast is rejected with reason "silenced"', () => {
    const hush = makeSpell('t-hush', { effects: [statusOp('silenced', 5)] });
    const bolt = makeSpell('t-bolt', { effects: [damageOp({ fire: 1 })] });
    const s = setup([hush, bolt]);
    installMana(s.world, s.pipeline);
    installCasting(s.world, s.pipeline);
    const caster = s.spawn();
    learnSpell(s.world, caster, 't-hush');
    learnSpell(s.world, caster, 't-bolt');
    const reasons: string[] = [];
    s.world.events.on(SpellFizzled, (e) => reasons.push(e.reason));
    s.world.step([{ type: 'cast', caster, spell: 't-hush' }]);
    expect(names(s, caster)).toEqual(['silenced']);
    s.world.step([{ type: 'cast', caster, spell: 't-bolt' }]);
    expect(reasons).toEqual(['silenced']);
    s.steps(5 * 60);
    expect(names(s, caster)).toEqual([]);
    s.world.step([{ type: 'cast', caster, spell: 't-bolt' }]);
    expect(reasons).toEqual(['silenced']);
  });
});
