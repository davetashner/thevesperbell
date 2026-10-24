import { describe, expect, it } from 'vitest';
import {
  builtInDeliveries,
  builtInOps,
  DeliveryRegistry,
  healthOf,
  installSpells,
  isCastCommand,
  knowsSpell,
  learnSpell,
  MAX_STATUS_STACKS,
  OpRegistry,
  pendingStimuli,
  readProperty,
  SpellCast,
  SpellDeliveryComponent,
  SpellEffectApplied,
  SpellFizzled,
  SpellHit,
  SpellPipeline,
  spellStatusesOf,
  StatusLedgerComponent,
  stimulusResolved,
  World,
  type CastCommand,
  type EntityId,
  type SpellEffectAppliedInfo,
} from '@sim/index';
import {
  damageOp,
  makeSpell,
  projectileDelivery,
  spellWorld,
  statusOp,
  stimulusOp,
} from './testing';

/** Names of the events a world emits, in delivery order, with their payloads. */
function record(world: ReturnType<typeof spellWorld>['world']) {
  const log: { name: string; payload: unknown }[] = [];
  world.events.on(SpellCast, (p) => log.push({ name: 'SpellCast', payload: p }));
  world.events.on(SpellHit, (p) => log.push({ name: 'SpellHit', payload: p }));
  world.events.on(SpellEffectApplied, (p) => log.push({ name: 'SpellEffectApplied', payload: p }));
  world.events.on(SpellFizzled, (p) => log.push({ name: 'SpellFizzled', payload: p }));
  return log;
}

const ward = makeSpell('t-ward');
const touchTrio = makeSpell('t-trio', {
  delivery: { kind: 'touch', reach: 1.5 },
  effects: [damageOp({ fire: 12 }), stimulusOp('heat', 200), statusOp('burning', 4, 2)],
});

describe('spell pipeline: cast → deliver → effect (mw-e06.2)', () => {
  it('AC-1: a self spell with a status op emits SpellCast then SpellEffectApplied in one tick and the caster has the status', () => {
    const { world, spawn } = spellWorld([ward]);
    const caster = spawn();
    learnSpell(world, caster, 't-ward');
    const log = record(world);
    world.step([{ type: 'cast', caster, spell: 't-ward' }]);
    expect(log.map((e) => e.name)).toEqual(['SpellCast', 'SpellHit', 'SpellEffectApplied']);
    const [cast, , applied] = log.map((e) => e.payload as { tick: number });
    expect(cast?.tick).toBe(0);
    expect(applied?.tick).toBe(0);
    const statuses = spellStatusesOf(world, caster);
    expect(statuses).toEqual([
      { target: caster, status: 'warded', stacks: 1, expiresTick: 600, source: caster },
    ]);
    // The delivery entity was removed once its effects landed.
    expect(world.query(SpellDeliveryComponent).ids()).toEqual([]);
  });

  it('AC-2: three effect ops apply in declared order, each emitting one SpellEffectApplied', () => {
    const { world, spawn } = spellWorld([touchTrio]);
    const caster = spawn(0);
    const target = spawn(1);
    learnSpell(world, caster, 't-trio');
    const applied: SpellEffectAppliedInfo[] = [];
    world.events.on(SpellEffectApplied, (e) => applied.push(e));
    const reached: EntityId[] = [];
    world.events.on(stimulusResolved, (e) => {
      e.hits.forEach((h) => reached.push(h.entity));
    });
    world.step([{ type: 'cast', caster, spell: 't-trio', target }]);
    expect(applied.map((e) => [e.op, e.index, e.target])).toEqual([
      ['damage', 0, target],
      ['stimulus', 1, target],
      ['status', 2, target],
    ]);
    expect(healthOf(world, target)?.current).toBe(88);
    expect(spellStatusesOf(world, target).map((s) => [s.status, s.stacks])).toEqual([
      ['burning', 2],
    ]);
    // The stimulus went through the one stimulus API and reached the target.
    expect(reached).toEqual([target]);
    world.step();
    expect(readProperty(world, target, 'temperature')).toBeGreaterThan(20);
  });

  it('AC-3: casting a spell the caster does not know is rejected with "unknown-spell" and spends nothing', () => {
    const { world, pipeline, spawn } = spellWorld([ward]);
    let spent = 0;
    pipeline.addGate({
      name: 'mana',
      check: () => undefined,
      spend: () => {
        spent++;
      },
    });
    const caster = spawn();
    const log = record(world);
    world.step([{ type: 'cast', caster, spell: 't-ward' }]);
    expect(pipeline.cast(world, { caster, spell: 'no-such-spell' })).toEqual({
      status: 'fizzled',
      reason: 'unknown-spell',
      stage: 'validate',
    });
    world.step();
    expect(log.map((e) => [e.name, (e.payload as { reason: string }).reason])).toEqual([
      ['SpellFizzled', 'unknown-spell'],
      ['SpellFizzled', 'unknown-spell'],
    ]);
    expect(spent).toBe(0);
    expect(spellStatusesOf(world, caster)).toEqual([]);
  });

  it('AC-5: registering an op or delivery under an existing name throws instead of overriding', () => {
    const ops = builtInOps();
    expect(() => ops.register('damage', () => undefined)).toThrow(/already registered/);
    expect(() => ops.register('nonsense' as 'damage', () => undefined)).toThrow(/unknown/);
    expect(ops.names()).toEqual(['damage', 'status', 'stimulus']);
    expect(() => ops.require('force')).toThrow(/no handler/);
    expect(() => builtInDeliveries().require('beam')).toThrow(/no handler/);
    const deliveries = builtInDeliveries();
    expect(() => deliveries.register('self', () => ({ kind: 'pending' }))).toThrow(
      /already registered/,
    );
    expect(() => deliveries.register('nonsense' as 'self', () => ({ kind: 'pending' }))).toThrow(
      /unknown/,
    );
    const { pipeline } = spellWorld([]);
    pipeline.addGate({ name: 'mana', check: () => undefined });
    expect(() => pipeline.addGate({ name: 'mana', check: () => undefined })).toThrow(
      /already registered/,
    );
  });
});

describe('spell pipeline: validation and fizzles', () => {
  it('refuses a dead or missing caster, a failing gate, and spells needing unregistered deliveries or ops', () => {
    const projectile = makeSpell('t-bolt', {
      delivery: projectileDelivery({ speed: 10, maxRange: 20 }),
    });
    const forceful = makeSpell('t-shove', {
      effects: [{ op: 'force', mode: 'push', impulse: 5, duration: 0 }],
    });
    const { world, pipeline, spawn } = spellWorld([ward, projectile, forceful]);
    const caster = spawn();
    for (const id of ['t-ward', 't-bolt', 't-shove']) learnSpell(world, caster, id);
    const reasons = (spell: string, who: EntityId = caster) => {
      const result = pipeline.cast(world, { caster: who, spell });
      return result.status === 'fizzled' ? result.reason : 'cast';
    };
    expect(reasons('t-ward', 999)).toBe('unknown-caster');
    expect(reasons('t-bolt')).toBe('unsupported-delivery');
    expect(reasons('t-shove')).toBe('unsupported-op');
    pipeline.addGate({ name: 'closed', check: ({ spell }) => `closed-for-${spell.school}` });
    expect(reasons('t-ward')).toBe('closed-for-arcane');
  });

  it('a free cast (a scroll) needs no learning and skips every gate and its cost', () => {
    const { world, pipeline, spawn } = spellWorld([ward]);
    const spent: string[] = [];
    pipeline.addGate({
      name: 'mana',
      check: () => 'not-enough-mana',
      spend: () => void spent.push('mana'),
    });
    const caster = spawn();
    learnSpell(world, caster, 't-ward');
    expect(pipeline.cast(world, { caster, spell: 't-ward' })).toMatchObject({
      reason: 'not-enough-mana',
    });
    const result = pipeline.cast(world, { caster, spell: 't-ward', source: 'free' });
    expect(result.status).toBe('cast');
    expect(spent).toEqual([]);
    world.step();
    expect(spellStatusesOf(world, caster)).toHaveLength(1);
  });

  it('charges every gate once, in order, only after the delivery started', () => {
    const { world, pipeline, spawn } = spellWorld([ward, touchTrio]);
    const order: string[] = [];
    pipeline.addGate({
      name: 'a',
      check: () => undefined,
      spend: ({ spell }) => void order.push(`a:${spell.id}`),
    });
    pipeline.addGate({ name: 'b', check: () => undefined });
    const caster = spawn();
    const far = spawn(50);
    learnSpell(world, caster, 't-ward');
    learnSpell(world, caster, 't-trio');
    expect(pipeline.cast(world, { caster, spell: 't-trio', target: far }).status).toBe('fizzled');
    expect(order).toEqual([]);
    expect(pipeline.cast(world, { caster, spell: 't-ward' }).status).toBe('cast');
    expect(order).toEqual(['a:t-ward']);
  });

  it('touch fizzles without spending when there is no target, it is out of reach or unplaced', () => {
    const { world, pipeline, spawn } = spellWorld([touchTrio]);
    const caster = spawn(0);
    learnSpell(world, caster, 't-trio');
    const gone = spawn(1);
    world.destroy(gone);
    const unplaced = world.spawn();
    const reason = (target?: EntityId) => {
      const r = pipeline.cast(world, {
        caster,
        spell: 't-trio',
        ...(target === undefined ? {} : { target }),
      });
      return r.status === 'fizzled' ? [r.reason, r.stage] : r;
    };
    expect(reason()).toEqual(['no-target', 'deliver']);
    expect(reason(gone)).toEqual(['no-target', 'deliver']);
    expect(reason(spawn(5))).toEqual(['out-of-reach', 'deliver']);
    expect(reason(spawn(1.9))).toMatchObject({ status: 'cast' }); // reach 1.5 + radius 0.5
    expect(reason(unplaced)).toEqual(['no-position', 'deliver']);
    const nowhere = world.spawn();
    expect(pipeline.cast(world, { caster: nowhere, spell: 't-trio', target: gone }).status).toBe(
      'fizzled',
    );
    world.step();
    expect(world.query(SpellDeliveryComponent).ids()).toEqual([]);
  });

  it('self delivery from an unplaced caster lands at the origin', () => {
    const { world, pipeline } = spellWorld([ward]);
    const caster = world.spawn();
    const hits: unknown[] = [];
    world.events.on(SpellHit, (h) => hits.push(h.point));
    pipeline.cast(world, { caster, spell: 't-ward', source: 'free' });
    world.step();
    expect(hits).toEqual([{ x: 0, y: 0, z: 0 }]);
  });
});

describe('spell pipeline: ops', () => {
  it('stimulus ops use a sphere at the hit, the contact, or a point; zero intensity is not an effect', () => {
    const spells = [
      makeSpell('t-ball', {
        effects: [stimulusOp('cold', 50, 2)],
      }),
      makeSpell('t-cloud', {
        effects: [stimulusOp('gas', 5, 0, 'smoke')],
      }),
      makeSpell('t-nothing', {
        effects: [stimulusOp('heat', 0)],
      }),
    ];
    const { world, pipeline, spawn } = spellWorld(spells);
    const caster = spawn();
    const applied: string[] = [];
    world.events.on(SpellEffectApplied, (e) => applied.push(e.op));
    for (const spell of ['t-ball', 't-cloud', 't-nothing']) {
      pipeline.cast(world, { caster, spell, source: 'free' });
    }
    expect(
      pendingStimuli(world)
        .map((s) => s.stimulus.shape.kind)
        .sort(),
    ).toEqual(['contact', 'sphere']);
    world.step();
    expect(applied).toEqual(['stimulus', 'stimulus']);
    // A bare point (no target) is a point shape.
    const point = new SpellPipeline({ spells: () => spells[1] });
    const ctx = {
      world,
      caster,
      target: null,
      point: { x: 1, y: 2, z: 3 },
      delivery: caster,
      damage: pipeline.damage,
    };
    const op = spells[1]?.effects[0];
    if (op?.op !== 'stimulus') throw new Error('fixture');
    expect(point.ops.require('stimulus')(ctx, op)).toBeDefined();
    expect(pendingStimuli(world).map((s) => s.stimulus.shape.kind)).toEqual(['point']);
  });

  it('damage and status ops have no effect without a target or a health pool', () => {
    const { world, pipeline, spawn } = spellWorld([touchTrio]);
    const caster = spawn();
    const ctx = {
      world,
      caster,
      target: null,
      point: { x: 0, y: 0, z: 0 },
      delivery: caster,
      damage: pipeline.damage,
    };
    const [damage, , status] = touchTrio.effects;
    if (damage?.op !== 'damage' || status?.op !== 'status') throw new Error('fixture');
    expect(pipeline.ops.require('damage')(ctx, damage)).toBeUndefined();
    expect(pipeline.ops.require('status')(ctx, status)).toBeUndefined();
    const stone = world.spawn();
    expect(pipeline.ops.require('damage')({ ...ctx, target: stone }, damage)).toBeUndefined();
    world.step();
    expect(healthOf(world, caster)?.current).toBe(100);
  });

  it('a status refreshes: stacks add up to the cap and the longest expiry wins; statuses then expire', () => {
    const quick = makeSpell('t-quick', {
      effects: [statusOp('warded', 1, 60)],
    });
    const hasted = makeSpell('t-hasted', {
      effects: [statusOp('hasted', 1)],
    });
    const { world, pipeline, spawn } = spellWorld([ward, quick, hasted]);
    const caster = spawn();
    for (const spell of ['t-ward', 't-hasted', 't-quick', 't-quick']) {
      pipeline.cast(world, { caster, spell, source: 'free' });
    }
    world.step();
    const held = () =>
      spellStatusesOf(world, caster).map((s) => [s.status, s.stacks, s.expiresTick]);
    expect(held()).toEqual([
      ['warded', MAX_STATUS_STACKS, 600],
      ['hasted', 1, 60],
    ]);
    for (let i = 0; i < 59; i++) world.step();
    expect(held()).toHaveLength(2);
    world.step();
    expect(held()).toEqual([['warded', MAX_STATUS_STACKS, 600]]);
    for (let i = 0; i < 539; i++) world.step();
    expect(held()).toHaveLength(1);
    world.step();
    expect(held()).toEqual([]);
  });

  it('effects hit the same target in order even if an earlier op kills it', () => {
    const lethal = makeSpell('t-lethal', {
      delivery: { kind: 'touch', reach: 2 },
      effects: [damageOp({ fire: 500 }), statusOp('charred', 2)],
    });
    const { world, pipeline, spawn } = spellWorld([lethal]);
    const caster = spawn();
    const victim = spawn(1);
    const ops: string[] = [];
    world.events.on(SpellEffectApplied, (e) => ops.push(e.op));
    pipeline.cast(world, { caster, spell: 't-lethal', target: victim, source: 'free' });
    world.step();
    expect(ops).toEqual(['damage', 'status']);
    expect(healthOf(world, victim)?.current).toBe(0);
  });
});

describe('spell pipeline: extension points', () => {
  it('a registered delivery can hold a cast pending and land it later, or cancel it', () => {
    const ops = builtInOps();
    const deliveries = builtInDeliveries().register('projectile', () => ({ kind: 'pending' }));
    const bolt = makeSpell('t-bolt', {
      delivery: projectileDelivery({ speed: 10, maxRange: 20 }),
      effects: [damageOp({ fire: 7 })],
    });
    const { world, spawn } = spellWorld([bolt]);
    const pipeline = new SpellPipeline({ spells: () => bolt, ops, deliveries });
    const caster = spawn();
    const victim = spawn(8);
    const log = record(world);
    const result = pipeline.cast(world, { caster, spell: 't-bolt', source: 'free' });
    if (result.status !== 'cast') throw new Error('expected a cast');
    world.step();
    // Pending: cast announced, delivery entity still alive, nothing applied yet.
    expect(log.map((e) => e.name)).toEqual(['SpellCast']);
    expect(world.has(result.delivery, SpellDeliveryComponent)).toBe(true);
    pipeline.land(world, result.delivery, [{ target: victim, point: { x: 8, y: 0, z: 0 } }]);
    world.step();
    expect(log.map((e) => e.name)).toEqual(['SpellCast', 'SpellHit', 'SpellEffectApplied']);
    expect(healthOf(world, victim)?.current).toBe(93);
    expect(world.isAlive(result.delivery)).toBe(false);
    expect(() => {
      pipeline.land(world, result.delivery, []);
    }).toThrow(/not a spell delivery/);

    const second = pipeline.cast(world, { caster, spell: 't-bolt', source: 'free' });
    if (second.status !== 'cast') throw new Error('expected a cast');
    world.step();
    pipeline.cancel(world, second.delivery);
    world.step();
    expect(log.at(-1)).toMatchObject({
      name: 'SpellFizzled',
      payload: { reason: 'delivery-ended', stage: 'deliver' },
    });
    expect(() => {
      pipeline.cancel(world, second.delivery);
    }).toThrow(/not a spell delivery/);

    const orphan = new SpellPipeline({ spells: () => undefined, ops, deliveries });
    const third = pipeline.cast(world, { caster, spell: 't-bolt', source: 'free' });
    if (third.status !== 'cast') throw new Error('expected a cast');
    world.step();
    expect(() => {
      orphan.land(world, third.delivery, []);
    }).toThrow(/unknown spell/);
  });

  it('a new op registered once serves every spell that names it, with no spell id in sight', () => {
    const ops = new OpRegistry().register('light', (ctx, op) => ({
      intensity: op.intensity,
      at: ctx.target,
    }));
    const glow = makeSpell('t-glow', {
      effects: [{ op: 'light', intensity: 90, radius: 5, duration: 0, attach: 'delivery' }],
    });
    const { world, spawn } = spellWorld([glow]);
    const pipeline = new SpellPipeline({
      spells: () => glow,
      ops,
      deliveries: new DeliveryRegistry().register('self', () => ({
        kind: 'hits',
        hits: [{ target: null, point: { x: 0, y: 0, z: 0 } }],
      })),
    });
    const applied: SpellEffectAppliedInfo[] = [];
    world.events.on(SpellEffectApplied, (e) => applied.push(e));
    pipeline.cast(world, { caster: spawn(), spell: 't-glow', source: 'free' });
    world.step();
    expect(applied.map((e) => [e.op, e.detail])).toEqual([['light', { intensity: 90, at: null }]]);
  });
});

describe('spell state and commands', () => {
  it('learning is idempotent; the command guard only accepts cast commands', () => {
    const { world, spawn } = spellWorld([ward]);
    const caster = spawn();
    expect(knowsSpell(world, caster, 't-ward')).toBe(false);
    learnSpell(world, caster, 't-ward');
    learnSpell(world, caster, 't-ward');
    learnSpell(world, caster, 't-other');
    expect(knowsSpell(world, caster, 't-ward')).toBe(true);
    expect(isCastCommand({ type: 'cast' })).toBe(true);
    expect(isCastCommand({ type: 'jump' })).toBe(false);
    expect(isCastCommand(null)).toBe(false);
    expect(isCastCommand('cast')).toBe(false);
  });

  it('cast commands carry their target and aim into the request; other commands are ignored', () => {
    const { world, spawn } = spellWorld([touchTrio]);
    const caster = spawn();
    const victim = spawn(1);
    learnSpell(world, caster, 't-trio');
    const got: unknown[] = [];
    world.events.on(SpellHit, (h) => got.push(h.target));
    world.step([
      { type: 'cast', caster, spell: 't-trio', target: victim, aim: { x: 1, y: 0, z: 0 } },
    ]);
    expect(got).toEqual([victim]);
    expect(() => {
      world.step([{ type: 'jump' } as never]);
    }).not.toThrow();
  });

  it('spells need stimuli installed first, and statuses can only be read once spells are installed', () => {
    const bare = new World<CastCommand>({ seed: 1 });
    expect(() => installSpells(bare, { spells: () => undefined })).toThrow(/install stimuli/);
    bare.register(StatusLedgerComponent);
    expect(() => spellStatusesOf(bare, 1)).toThrow(/not installed/);
    const { world } = spellWorld([]);
    expect(world.entityCount).toBe(2); // the stimulus queue and the status ledger
  });
});
