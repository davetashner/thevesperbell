import { describe, expect, expectTypeOf, it } from 'vitest';
import { Rng } from '../rng';
import { defineComponent, type EntityId } from './component';
import { defineEvent, EventCycleError } from './events';
import { World, type System, type TickContext, type WorldSnapshot } from './world';

interface Vec {
  x: number;
  y: number;
}
const Position = defineComponent<Vec>('Position');
const Velocity = defineComponent<Vec>('Velocity');
const Flammable = defineComponent<{ fuel: number; burning: boolean }>('Flammable');
const Health = defineComponent<number>('Health');

const system = <I = unknown>(name: string, run: (ctx: TickContext<I>) => void): System<I> => ({
  name,
  run,
});

const world = <I = unknown>(seed = 1): World<I> =>
  new World<I>({ seed }).register(Position, Velocity, Flammable, Health);

describe('World scheduler', () => {
  it('AC-1: systems registered A, B, C run in that order every tick', () => {
    const w = world();
    const log: string[] = [];
    for (const name of ['A', 'B', 'C']) {
      w.addSystem(system(name, ({ tick }) => log.push(`${name}${String(tick)}`)));
    }
    w.step();
    w.step();
    w.step();
    expect(log).toEqual(['A0', 'B0', 'C0', 'A1', 'B1', 'C1', 'A2', 'B2', 'C2']);
  });

  it('step(inputs) is the only way time advances; systems get the tick, inputs and a read-only clock', () => {
    const w = new World<string>({ seed: 7, hz: 30 });
    const seen: [number, readonly string[], number][] = [];
    w.addSystem(
      system<string>('probe', ({ tick, inputs, clock, world: self }) => {
        expect(self).toBe(w);
        seen.push([tick, inputs, clock.hz]);
      }),
    );
    expect(w.tick).toBe(0);
    w.step(['jump', 'crouch']);
    w.step(); // no inputs this tick
    expect(seen).toEqual([
      [0, ['jump', 'crouch'], 30],
      [1, [], 30],
    ]);
    expect(w.tick).toBe(2);
    expect(w.clock.elapsedMs()).toBe(66);
    expect(w.seed).toBe(7);
    expectTypeOf(w.clock).not.toHaveProperty('advance');
  });

  it('input filters decide which inputs the systems see, from world state (mw-e01.8)', () => {
    const world = new World<string>({ seed: 1 });
    const seen: string[][] = [];
    world.register(Health);
    const gate = world.spawn();
    world
      .addInputFilter({ name: 'gate', keep: (input, w) => input !== 'a' || !w.has(gate, Health) })
      .addInputFilter({ name: 'never', keep: (input) => input !== 'never' })
      .addSystem(
        system<string>('probe', ({ inputs, world: w }) => {
          seen.push([...inputs]);
          if (!w.has(gate, Health)) w.add(gate, Health, 1);
        }),
      );
    world.step(['a', 'b', 'never']);
    world.step(['a', 'b']);
    expect(seen).toEqual([['a', 'b'], ['b']]);
    expect(() => world.addInputFilter({ name: 'gate', keep: () => true })).toThrow(
      'input filter "gate" is already registered',
    );
  });

  it('mw-e03.23: an input filter may rewrite the inputs it keeps', () => {
    const seen: string[][] = [];
    const world = new World<string>({ seed: 1 })
      .addInputFilter({ name: 'plain', keep: () => true })
      .addInputFilter({
        name: 'shout',
        keep: (input) => input !== 'drop',
        map: (input) => input.toUpperCase(),
      })
      .addSystem(system<string>('probe', ({ inputs }) => void seen.push([...inputs])));
    world.step(['a', 'drop', 'b']);
    expect(seen).toEqual([['A', 'B']]);
  });

  it('defaults to 60 Hz', () => {
    expect(new World({ seed: 1 }).clock.hz).toBe(60);
  });

  it('rejects duplicate system and component names', () => {
    const w = world();
    w.addSystem(system('A', () => undefined));
    expect(() => w.addSystem(system('A', () => undefined))).toThrow(/already registered/);
    expect(() => w.register(defineComponent('Position'))).toThrow(/already registered/);
  });

  it('is not re-entrant, and snapshot/restore cannot run mid-step', () => {
    const w = world();
    const errors: string[] = [];
    w.addSystem(
      system('nested', ({ world: self }) => {
        for (const action of [
          () => {
            self.step();
          },
          () => self.snapshot(),
          () => {
            self.restore(snap);
          },
        ]) {
          try {
            action();
          } catch (e) {
            errors.push((e as Error).message);
          }
        }
      }),
    );
    const snap = w.snapshot();
    w.step();
    expect(errors).toEqual([
      'step() cannot be called during a step',
      'snapshot() cannot be called during a step',
      'restore() cannot be called during a step',
    ]);
  });

  it('a throwing system drops the tick’s queued changes and leaves the world steppable', () => {
    const w = world();
    let fail = true;
    let spawned: EntityId = 0;
    w.addSystem(
      system('flaky', ({ world: self }) => {
        spawned = self.spawn();
        if (fail) throw new Error('boom');
      }),
    );
    expect(() => {
      w.step();
    }).toThrow('boom');
    expect(w.isAlive(spawned)).toBe(false);
    expect(w.tick).toBe(0);
    fail = false;
    w.step();
    expect(w.isAlive(spawned)).toBe(true);
    expect(w.tick).toBe(1);
  });
});

describe('World entities and deferred structural changes', () => {
  it('AC-2: an entity destroyed by system A in tick N is still visible to B in tick N and gone from N+1', () => {
    const w = world();
    const doomed = w.spawn();
    w.add(doomed, Position, { x: 0, y: 0 });
    const visibleToB: [number, boolean, EntityId[]][] = [];
    w.addSystem(
      system('A', ({ world: self, tick }) => {
        if (tick === 0) self.destroy(doomed);
      }),
    );
    w.addSystem(
      system('B', ({ world: self, tick }) => {
        visibleToB.push([tick, self.isAlive(doomed), [...self.query(Position).ids()]]);
      }),
    );
    w.step();
    w.step();
    expect(visibleToB).toEqual([
      [0, true, [doomed]],
      [1, false, []],
    ]);
    expect(w.get(doomed, Position)).toBeUndefined();
  });

  it('spawns and component changes during a tick become visible from the next tick', () => {
    const w = world();
    const existing = w.spawn();
    w.add(existing, Health, 3);
    const log: [number, number, boolean, boolean][] = [];
    let child: EntityId = 0;
    w.addSystem(
      system('act', ({ world: self, tick }) => {
        if (tick === 0) {
          child = self.spawn();
          self.add(child, Position, { x: 1, y: 1 });
          self.remove(existing, Health);
          self.add(existing, Velocity, { x: 0, y: 1 });
        }
      }),
    );
    w.addSystem(
      system('observe', ({ world: self, tick }) => {
        log.push([
          tick,
          self.entityCount,
          self.has(existing, Health),
          self.has(existing, Velocity),
        ]);
      }),
    );
    w.step();
    expect(w.isAlive(child)).toBe(true);
    w.step();
    expect(log).toEqual([
      [0, 1, true, false],
      [1, 2, false, true],
    ]);
    expect(w.get(child, Position)).toEqual({ x: 1, y: 1 });
  });

  it('applies queued changes in issue order: an add after a destroy in the same tick is dropped', () => {
    const w = world();
    const e = w.spawn();
    w.addSystem(
      system('act', ({ world: self, tick }) => {
        if (tick > 0) return;
        self.destroy(e);
        self.destroy(e); // twice is harmless
        self.add(e, Health, 1);
        self.remove(e, Health);
        const brief = self.spawn();
        self.add(brief, Health, 5);
        self.destroy(brief);
      }),
    );
    w.step();
    expect(w.isAlive(e)).toBe(false);
    expect(w.entityCount).toBe(0);
    expect(w.query(Health).count).toBe(0);
  });

  it('outside a step, changes apply immediately', () => {
    const w = world();
    const e = w.spawn();
    expect(w.isAlive(e)).toBe(true);
    w.add(e, Health, 10);
    expect(w.get(e, Health)).toBe(10);
    w.add(e, Health, 9); // add replaces
    expect(w.get(e, Health)).toBe(9);
    w.remove(e, Health);
    w.remove(e, Health); // absent: no-op
    expect(w.has(e, Health)).toBe(false);
    w.destroy(e);
    expect(w.isAlive(e)).toBe(false);
  });

  it('never reuses entity ids', () => {
    const w = world();
    const a = w.spawn();
    w.destroy(a);
    const b = w.spawn();
    expect(a).toBe(1);
    expect(b).toBe(2);
  });

  it('set() replaces a value immediately, even mid-tick, but only when present', () => {
    const w = world();
    const e = w.spawn();
    w.add(e, Health, 10);
    const seen: (number | undefined)[] = [];
    w.addSystem(
      system('hurt', ({ world: self }) => {
        self.set(e, Health, 4);
      }),
    );
    w.addSystem(system('read', ({ world: self }) => seen.push(self.get(e, Health))));
    w.step();
    expect(seen).toEqual([4]);
    expect(() => {
      w.set(e, Velocity, { x: 0, y: 0 });
    }).toThrow(/has no "Velocity"/);
  });

  it('rejects unknown entities and unregistered component types', () => {
    const w = world();
    const e = w.spawn();
    expect(() => {
      w.destroy(99);
    }).toThrow(/entity 99 does not exist/);
    expect(() => {
      w.add(99, Health, 1);
    }).toThrow(/does not exist/);
    expect(() => {
      w.remove(99, Health);
    }).toThrow(/does not exist/);
    const Stranger = defineComponent<number>('Stranger');
    expect(() => {
      w.add(e, Stranger, 1);
    }).toThrow(/"Stranger" is not registered/);
    const Impostor = defineComponent<number>('Health'); // same name, different definition
    expect(() => w.get(e, Impostor)).toThrow(/"Health" is not registered/);
    w.query(Health);
    expect(() => w.query(Impostor)).toThrow(/"Health" is not registered/);
  });

  it('isRegistered tells whether exactly this component type is registered', () => {
    const w = world();
    expect(w.isRegistered(Position)).toBe(true);
    expect(w.isRegistered(defineComponent<Vec>('Position'))).toBe(false);
    expect(w.isRegistered(defineComponent<Vec>('Unknown'))).toBe(false);
  });

  it('keeps named RNG streams persistent across calls and independent of each other', () => {
    const w = world(42);
    const a1 = w.random('ai').nextU32();
    const a2 = w.random('ai').nextU32();
    const fresh = Rng.create(42).stream('ai');
    expect([a1, a2]).toEqual([fresh.nextU32(), fresh.nextU32()]);
    expect(w.random('loot').nextU32()).toBe(Rng.create(42).stream('loot').nextU32());
  });
});

describe('World events', () => {
  const Spotted = defineEvent<EntityId>('Spotted');

  it('flushes at phase boundaries: setup events at tick start, a system’s events before the next system', () => {
    const w = world();
    const log: string[] = [];
    w.events.on(Spotted, (id) => log.push(`spotted ${String(id)}`));
    w.addSystem(
      system('A', ({ world: self }) => {
        log.push('A');
        self.events.emit(Spotted, 2);
      }),
    );
    w.addSystem(system('B', () => log.push('B')));
    w.events.emit(Spotted, 1);
    w.step();
    expect(log).toEqual(['spotted 1', 'A', 'spotted 2', 'B']);
  });

  it('uses the configured cycle guard', () => {
    const w = new World({ seed: 1, maxEventsPerFlush: 5 });
    w.events.on(Spotted, (id) => {
      w.events.emit(Spotted, id);
    });
    w.addSystem(
      system('A', ({ world: self }) => {
        self.events.emit(Spotted, 1);
      }),
    );
    expect(() => {
      w.step();
    }).toThrow(EventCycleError);
  });
});

describe('World queries', () => {
  it('AC-5: a [Position, Flammable] query iterates in ascending entity id, whatever the add order', () => {
    const w = world();
    const ids = Array.from({ length: 200 }, () => w.spawn());
    const rng = Rng.create(2026);
    const withPosition = new Set(rng.shuffle(ids).slice(0, 150));
    const withFlammable = new Set(rng.shuffle(ids).slice(0, 150));
    // Add both components in (different) random orders, interleaved with unrelated churn.
    for (const id of rng.shuffle([...withFlammable])) {
      w.add(id, Flammable, { fuel: id, burning: false });
    }
    for (const id of rng.shuffle([...withPosition])) w.add(id, Position, { x: id, y: 0 });
    for (const id of rng.shuffle(ids).slice(0, 20)) w.remove(id, Position);
    for (const id of rng.shuffle(ids).slice(0, 20)) w.add(id, Position, { x: id, y: 0 });

    const expected = ids.filter((id) => w.has(id, Position) && w.has(id, Flammable));
    expect(expected.length).toBeGreaterThan(50);
    const visited: EntityId[] = [];
    w.query(Position, Flammable).forEach((id, pos, flammable) => {
      expect(pos.x).toBe(id);
      expect(flammable.fuel).toBe(id);
      visited.push(id);
    });
    expect(visited).toEqual(expected); // ids were spawned ascending
    expect([...w.query(Flammable, Position).ids()]).toEqual(expected);
  });

  it('AC-5: iteration stays ascending when components are added to old entities during a step', () => {
    const w = world();
    const ids = Array.from({ length: 10 }, () => w.spawn());
    for (const id of ids) w.add(id, Position, { x: 0, y: 0 });
    w.addSystem(
      system('flag', ({ world: self, tick }) => {
        if (tick === 0)
          for (const id of [...ids].reverse()) self.add(id, Flammable, { fuel: 1, burning: false });
      }),
    );
    w.step();
    expect([...w.query(Flammable, Position).ids()]).toEqual(ids);
  });

  it('caches one query per component list and refreshes it after structural changes', () => {
    const w = world();
    const q = w.query(Position, Velocity);
    expect(w.query(Position, Velocity)).toBe(q);
    expect(w.query(Velocity, Position)).not.toBe(q);
    expect(q.count).toBe(0);
    const e = w.spawn();
    w.add(e, Position, { x: 0, y: 0 });
    expect(q.count).toBe(0);
    w.add(e, Velocity, { x: 1, y: 0 });
    expect(q.ids()).toEqual([e]);
  });

  it('passes live values in query order, so in-place mutation persists', () => {
    const w = world();
    for (let i = 0; i < 3; i++) {
      const e = w.spawn();
      w.add(e, Position, { x: i, y: 0 });
      w.add(e, Velocity, { x: 1, y: 2 });
      w.add(e, Health, 5);
    }
    w.addSystem(
      system('move', ({ world: self }) => {
        self.query(Velocity, Position).forEach((_id, vel, pos) => {
          pos.x += vel.x;
          pos.y += vel.y;
        });
      }),
    );
    w.step();
    w.step();
    const out: [EntityId, number, number, number][] = [];
    w.query(Position, Velocity, Health).forEach((id, pos, _vel, hp) =>
      out.push([id, pos.x, pos.y, hp]),
    );
    expect(out).toEqual([
      [1, 2, 4, 5],
      [2, 3, 4, 5],
      [3, 4, 4, 5],
    ]);
  });

  it('supports any number of components per query (1 to 4+)', () => {
    const w = world();
    for (let i = 1; i <= 2; i++) {
      const e = w.spawn();
      w.add(e, Health, i);
      w.add(e, Position, { x: i, y: 0 });
      w.add(e, Velocity, { x: 0, y: i });
      w.add(e, Flammable, { fuel: i, burning: false });
    }
    const one: number[] = [];
    w.query(Health).forEach((_id, hp) => one.push(hp));
    const four: number[][] = [];
    w.query(Health, Position, Velocity, Flammable).forEach((id, hp, pos, vel, f) =>
      four.push([id, hp, pos.x, vel.y, f.fuel]),
    );
    expect(one).toEqual([1, 2]);
    expect(four).toEqual([
      [1, 1, 1, 1, 1],
      [2, 2, 2, 2, 2],
    ]);
  });

  it('types forEach values from the component list', () => {
    const w = world();
    expectTypeOf(w.query(Position, Health))
      .toHaveProperty('forEach')
      .parameter(0)
      .toEqualTypeOf<(id: EntityId, position: Vec, health: number) => void>();
  });
});

describe('World snapshots', () => {
  interface Command {
    readonly spawnAt?: number;
    readonly ignite?: number;
  }
  const Burned = defineEvent<EntityId>('Burned');

  /** A small systemic world: spawns from inputs, wind-blown movement, spreading fire, burn-outs. */
  function scenario(seed: number): World<Command> {
    const w = world<Command>(seed);
    w.events.on(Burned, (id) => {
      w.destroy(id);
    });
    w.addSystem(
      system<Command>('spawn', ({ world: self, inputs }) => {
        for (const input of inputs) {
          if (input.spawnAt === undefined) continue;
          const e = self.spawn();
          self.add(e, Position, { x: input.spawnAt, y: 0 });
          self.add(e, Velocity, { x: 0, y: 0 });
          self.add(e, Flammable, { fuel: 30, burning: false });
        }
      }),
    );
    w.addSystem(
      system<Command>('ignite', ({ world: self, inputs }) => {
        const flammables = self.query(Flammable).ids();
        for (const input of inputs) {
          if (input.ignite === undefined || flammables.length === 0) continue;
          const target = flammables.at(input.ignite % flammables.length) ?? 0;
          const flammable = self.get(target, Flammable);
          if (flammable) flammable.burning = true;
        }
      }),
    );
    w.addSystem(
      system<Command>('wind', ({ world: self }) => {
        const gust = self.random('wind');
        self.query(Position, Velocity).forEach((_id, pos, vel) => {
          vel.x = gust.int(-2, 2);
          pos.x += vel.x;
        });
      }),
    );
    w.addSystem(
      system<Command>('fire', ({ world: self }) => {
        const spread = self.random('fire');
        const burning: Vec[] = [];
        self.query(Flammable, Position).forEach((_id, f, pos) => {
          if (f.burning) burning.push(pos);
        });
        self.query(Flammable, Position).forEach((id, f, pos) => {
          if (!f.burning && burning.some((b) => Math.abs(b.x - pos.x) <= 1) && spread.chance(0.3)) {
            f.burning = true;
          }
          if (f.burning && --f.fuel <= 0) self.events.emit(Burned, id);
        });
      }),
    );
    return w;
  }

  function inputsFor(ticks: number): Command[][] {
    const rng = Rng.create(99);
    return Array.from({ length: ticks }, () => {
      const cmds: Command[] = [];
      if (rng.chance(0.2)) cmds.push({ spawnAt: rng.int(-20, 20) });
      if (rng.chance(0.02)) cmds.push({ ignite: rng.int(0, 1000) });
      return cmds;
    });
  }

  it('AC-3: two worlds with the same seed and inputs for 1,000 ticks have deep-equal snapshots', () => {
    const inputs = inputsFor(1000);
    const a = scenario(123);
    const b = scenario(123);
    let peak = 0;
    for (const tickInputs of inputs) {
      a.step(tickInputs);
      b.step(tickInputs.map((c) => ({ ...c })));
      peak = Math.max(peak, a.entityCount);
    }
    const snapA = a.snapshot();
    expect(snapA.clock.tick).toBe(1000);
    expect(peak).toBeGreaterThan(20); // the scenario actually did something
    expect(snapA.nextEntity).toBeGreaterThan(a.entityCount + 1); // …including burn-outs
    expect(b.snapshot()).toEqual(snapA);
    // A different seed diverges (the wind and fire streams differ).
    const c = scenario(124);
    for (const tickInputs of inputs) c.step(tickInputs);
    expect(c.snapshot()).not.toEqual(snapA);
  });

  it('round-trips through JSON: a restored world continues identically', () => {
    const inputs = inputsFor(300);
    const original = scenario(5);
    for (const tickInputs of inputs.slice(0, 150)) original.step(tickInputs);
    const saved: WorldSnapshot = JSON.parse(JSON.stringify(original.snapshot())) as WorldSnapshot;
    const resumed = scenario(777); // seed comes from the snapshot
    resumed.restore(saved);
    expect(resumed.snapshot()).toEqual(original.snapshot());
    for (const tickInputs of inputs.slice(150)) {
      original.step(tickInputs);
      resumed.step(tickInputs);
    }
    expect(resumed.snapshot()).toEqual(original.snapshot());
    expect(resumed.seed).toBe(5);
  });

  it('snapshots are sorted, detached plain data', () => {
    const w = world(3);
    const late = w.spawn();
    const early = w.spawn();
    w.add(early, Position, { x: 1, y: 1 });
    w.add(late, Position, { x: 2, y: 2 });
    w.add(late, Health, 7);
    w.random('zeta');
    w.random('alpha');
    const snap = w.snapshot();
    expect(snap.entities).toEqual([1, 2]);
    expect(Object.keys(snap.components)).toEqual(['Flammable', 'Health', 'Position', 'Velocity']);
    expect(snap.components['Position']).toEqual([
      [1, { x: 2, y: 2 }],
      [2, { x: 1, y: 1 }],
    ]);
    expect(Object.keys(snap.rng)).toEqual(['alpha', 'zeta']);
    w.set(early, Position, { x: 50, y: 50 });
    expect(snap.components['Position']?.[1]).toEqual([2, { x: 1, y: 1 }]);
  });

  it('restore replaces all state, drops pending events and invalidates cached queries', () => {
    const w = world();
    const empty = w.snapshot();
    const e = w.spawn();
    w.add(e, Health, 1);
    const q = w.query(Health);
    expect(q.count).toBe(1);
    w.random('ai').nextU32();
    const log: EntityId[] = [];
    const Ping = defineEvent<EntityId>('Ping');
    w.events.on(Ping, (id) => log.push(id));
    w.events.emit(Ping, e);
    w.restore(empty);
    expect(q.count).toBe(0);
    expect(w.entityCount).toBe(0);
    expect(w.snapshot()).toEqual(empty);
    w.step();
    expect(log).toEqual([]);
    expect(w.spawn()).toBe(1);
  });

  const base = (): WorldSnapshot => {
    const w = world();
    const e = w.spawn();
    w.add(e, Health, 1);
    return w.snapshot();
  };

  it.each<[string, (s: WorldSnapshot) => WorldSnapshot, RegExp]>([
    ['nextEntity 0', (s) => ({ ...s, nextEntity: 0 }), /nextEntity/],
    ['fractional nextEntity', (s) => ({ ...s, nextEntity: 2.5 }), /nextEntity/],
    ['an id at nextEntity', (s) => ({ ...s, entities: [2] }), /ascend/],
    ['id 0', (s) => ({ ...s, entities: [0] }), /ascend/],
    ['duplicate ids', (s) => ({ ...s, nextEntity: 5, entities: [1, 1] }), /ascend/],
    ['fractional id', (s) => ({ ...s, nextEntity: 5, entities: [1.5] }), /ascend/],
    ['an unregistered component', (s) => ({ ...s, components: { Mana: [] } }), /"Mana"/],
    ['a row for a dead entity', (s) => ({ ...s, components: { Health: [[3, 1]] } }), /not alive/],
    ['a bad seed', (s) => ({ ...s, seed: -1 }), /seed/],
    ['a bad clock', (s) => ({ ...s, clock: { tick: -1, hz: 60 } }), /tick/],
    [
      'a bad rng stream',
      (s) => ({ ...s, rng: { ai: { seed: 1, state: [0, 0, 0, 0] } } }),
      /RngState/,
    ],
  ])('rejects a snapshot with %s and leaves the world untouched', (_label, corrupt, message) => {
    const w = world();
    const keep = w.spawn();
    const before = w.snapshot();
    expect(() => {
      w.restore(corrupt(base()));
    }).toThrow(message);
    expect(w.snapshot()).toEqual(before);
    expect(w.isAlive(keep)).toBe(true);
  });
});

describe('shared snapshots', () => {
  it('reference live values for default-hook components but still run custom hooks', () => {
    const Plain = defineComponent<{ v: number }>('Plain');
    const Custom = defineComponent<{ v: number }>('Custom', {
      serialize: (value) => ({ doubled: value.v * 2 }),
    });
    const w = new World({ seed: 1 }).register(Plain, Custom);
    const e = w.spawn();
    const live = { v: 1 };
    w.add(e, Plain, live);
    w.add(e, Custom, { v: 3 });

    const shared = w.snapshot({ shared: true });
    expect(shared.components['Plain']?.[0]?.[1]).toBe(live);
    expect(shared.components['Custom']?.[0]?.[1]).toEqual({ doubled: 6 });
    expect(shared).toEqual(w.snapshot());
    expect(w.snapshot({ shared: false }).components['Plain']?.[0]?.[1]).not.toBe(live);
  });
});

describe('World remove listeners (mw-e03.41)', () => {
  it('AC-1: tells listeners what a component held when it is removed or its entity destroyed', () => {
    const w = world();
    const seen: string[] = [];
    w.onRemove(Health, (id, hp) => seen.push(`a${String(id)}:${String(hp)}`));
    w.onRemove(Health, (id) => seen.push(`b${String(id)}`));
    const [x, y, z] = [w.spawn(), w.spawn(), w.spawn()];
    w.add(x, Health, 5);
    w.add(y, Health, 7);
    w.add(z, Position, { x: 0, y: 0 });
    w.remove(x, Health);
    expect(seen).toEqual(['a1:5', 'b1']);
    w.destroy(y);
    w.destroy(z); // no Health: nothing to tell
    w.remove(x, Health); // already gone
    expect(seen).toEqual(['a1:5', 'b1', 'a2:7', 'b2']);
  });

  it('AC-1: during a step, listeners run when the change applies at the end of the tick', () => {
    const w = world();
    const id = w.spawn();
    w.add(id, Health, 3);
    const seen: [number, number][] = [];
    w.onRemove(Health, (_id, hp) => seen.push([w.tick, hp]));
    w.addSystem(
      system('destroyer', () => {
        w.destroy(id);
        expect(seen).toEqual([]);
      }),
    );
    w.step();
    expect(seen).toEqual([[0, 3]]);
  });

  it('never calls listeners on restore, and refuses unregistered types', () => {
    const w = world();
    const id = w.spawn();
    w.add(id, Health, 1);
    const empty = world().snapshot();
    let calls = 0;
    w.onRemove(Health, () => calls++);
    w.restore(empty);
    expect(calls).toBe(0);
    expect(w.isAlive(id)).toBe(false);
    const Unregistered = defineComponent<number>('Unregistered');
    expect(() => w.onRemove(Unregistered, () => undefined)).toThrow('is not registered');
  });

  it('structureVersion counts structural changes, so watchers can skip scans', () => {
    const w = new World({ seed: 1 }).register(Position);
    const start = w.structureVersion;
    const e = w.spawn();
    w.add(e, Position, { x: 1, y: 0 });
    const added = w.structureVersion;
    expect(added).toBeGreaterThan(start);
    w.set(e, Position, { x: 2, y: 0 }); // a value write is not structural
    expect(w.structureVersion).toBe(added);
    w.remove(e, Position);
    expect(w.structureVersion).toBeGreaterThan(added);
  });
});

describe('World.restores (mw-e15.3)', () => {
  it('counts restores, and is not part of the state', () => {
    const world = new World<never>({ seed: 1 });
    const before = world.snapshot();
    expect(world.restores).toBe(0);
    world.restore(before);
    world.restore(before);
    expect(world.restores).toBe(2);
    expect(world.snapshot()).toEqual(before);
  });
});

describe('unregisterIfEmpty (mw-e22.15)', () => {
  const Tag = defineComponent<number>('Tag');
  it('drops an unused type so the snapshot is as if it was never registered, and allows registering again', () => {
    const w = new World<never>({ seed: 1 });
    const bare = JSON.stringify(w.snapshot());
    w.register(Tag);
    w.query(Tag);
    expect(w.unregisterIfEmpty(Tag)).toBe(true);
    expect(JSON.stringify(w.snapshot())).toBe(bare);
    expect(w.isRegistered(Tag)).toBe(false);
    w.register(Tag);
    const e = w.spawn();
    w.add(e, Tag, 1);
    expect(w.query(Tag).count).toBe(1);
  });

  it('refuses when the type is unknown, in use, or the world is mid-step', () => {
    const w = new World<never>({ seed: 1 });
    expect(w.unregisterIfEmpty(Tag)).toBe(false);
    w.register(Tag);
    const e = w.spawn();
    w.add(e, Tag, 1);
    expect(w.unregisterIfEmpty(Tag)).toBe(false);
    w.remove(e, Tag);
    let midStep: boolean | undefined;
    w.addSystem({
      name: 'probe',
      run: () => {
        midStep = w.unregisterIfEmpty(Tag);
      },
    });
    w.step();
    expect(midStep).toBe(false);
    expect(w.isRegistered(Tag)).toBe(true);
  });
});
