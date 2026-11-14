// Fact persistence policies (mw-e27.7): permanent, reset-on-rest, reset-after, transient, decays-to.
import { describe, expect, it } from 'vitest';
import { settleSavedFacts } from './policy';
import { FactDeclarationError, FactStore, factWrittenKey, type FactChange } from './store';

/** A store on a clock the test moves. */
function setup() {
  const now = { tick: 0 };
  const changes: FactChange[] = [];
  const store = new FactStore({ emit: (c) => changes.push(c), tick: () => now.tick });
  return { store, now, changes };
}

const TIMER = 72_000;

describe('fact persistence policies', () => {
  it('AC-1: a resetAfter(72000) fact returns to its default when 72000 ticks pass', () => {
    const { store, now, changes } = setup();
    store.declare('camp.restocked', {
      type: 'bool',
      default: false,
      persistence: 'reset-after',
      resetAfter: TIMER,
    });
    now.tick = 100;
    store.set('camp.restocked', true);
    expect(store.get('camp.restocked')).toBe(true);
    now.tick = 100 + TIMER - 1;
    expect(store.get('camp.restocked')).toBe(true);
    expect(store.expired('camp.restocked')).toBe(false);
    now.tick = 100 + TIMER;
    // Loaded: reads see the default at once, a sweep clears it and announces the change.
    expect(store.get('camp.restocked')).toBe(false);
    expect(store.has('camp.restocked')).toBe(false);
    expect(store.applyResets('time')).toEqual(['camp.restocked']);
    expect(store.snapshot()).toEqual({});
    expect(changes.at(-1)).toMatchObject({ key: 'camp.restocked', old: true, new: false });
    expect(store.applyResets('time')).toEqual([]);
  });

  it('AC-1: a resetAfter fact also resets while not loaded (a save that waited out its time)', () => {
    const { store, now } = setup();
    store.declare('camp.restocked', {
      type: 'bool',
      default: false,
      persistence: 'reset-after',
      resetAfter: TIMER,
    });
    now.tick = 500;
    store.set('camp.restocked', true);
    const saved = store.persistentSnapshot();
    expect(saved).toEqual({
      'camp.restocked': true,
      [factWrittenKey('camp.restocked')]: 500,
    });
    // Loaded again before its time: kept, with its timer.
    expect(settleSavedFacts(store, saved, 500 + TIMER - 1).facts).toEqual(saved);
    // Loaded after its time: the default, and the timer is gone too.
    const late = settleSavedFacts(store, saved, 500 + TIMER);
    expect(late.facts).toEqual({});
    expect(late.expired).toEqual(['camp.restocked']);
  });

  it('writing a reset-after fact again restarts its timer, and a transaction undoes the timer too', () => {
    const { store, now } = setup();
    store.declare('camp.restocked', {
      type: 'int',
      default: 0,
      persistence: 'reset-after',
      resetAfter: 10,
    });
    store.set('camp.restocked', 1);
    now.tick = 8;
    store.set('camp.restocked', 2);
    now.tick = 17;
    expect(store.get('camp.restocked')).toBe(2);
    now.tick = 18;
    expect(store.get('camp.restocked')).toBe(0);
    // Writing the stale value again counts as a write.
    store.set('camp.restocked', 2);
    expect(store.get('camp.restocked')).toBe(2);
    expect(() =>
      store.transaction(() => {
        now.tick = 20;
        store.set('camp.restocked', 3);
        throw new Error('undo');
      }),
    ).toThrow('undo');
    expect(store.get('camp.restocked')).toBe(2);
    expect(store.snapshot()[factWrittenKey('camp.restocked')]).toBe(18);
    // Committed transactions announce the fact, not its timer.
    const changes: string[] = [];
    const watched = new FactStore({ emit: (c) => changes.push(c.key), tick: () => 0 });
    watched.declare('t', {
      type: 'bool',
      default: false,
      persistence: 'reset-after',
      resetAfter: 5,
    });
    watched.transaction(() => watched.set('t', true));
    expect(changes).toEqual(['t']);
  });

  it('reset-after applies to entity templates and renames its timer with it', () => {
    const { store, now } = setup();
    store.declare('entity:*.regrown', {
      type: 'bool',
      default: false,
      persistence: 'reset-after',
      resetAfter: 5,
      renamedFrom: ['entity:*.grown'],
    });
    const key = 'entity:meadow/herb-1.regrown';
    store.set(key, true);
    expect(store.snapshot()).toEqual({ [key]: true, [`${key}.written-at`]: 0 });
    expect(store.currentKey('entity:meadow/herb-1.grown.written-at')).toBe(`${key}.written-at`);
    now.tick = 5;
    expect(store.get(key)).toBe(false);
  });

  it('reset-on-rest facts return to their default on rest and not otherwise', () => {
    const { store, changes } = setup();
    store.declare('bell.lit', { type: 'bool', default: false, persistence: 'reset-on-rest' });
    store.declare('bell.rung', { type: 'bool', default: false });
    store.set('bell.lit', true);
    store.set('bell.rung', true);
    expect(store.applyResets('time')).toEqual([]);
    expect(store.applyResets('rest')).toEqual(['bell.lit']);
    expect(store.get('bell.lit')).toBe(false);
    expect(store.get('bell.rung')).toBe(true);
    expect(changes.at(-1)).toMatchObject({ key: 'bell.lit', old: true, new: false });
    // A fact already at its default has nothing to announce when it resets.
    store.set('bell.lit', false);
    const before = changes.length;
    expect(store.applyResets('rest')).toEqual(['bell.lit']);
    expect(changes).toHaveLength(before);
    // Saves hold it as written until the player rests.
    store.set('bell.lit', true);
    expect(settleSavedFacts(store, store.persistentSnapshot(), 0).facts).toEqual({
      'bell.lit': true,
      'bell.rung': true,
    });
  });

  it('AC-4: a looted chest with the permanent policy stays looted through ten rests', () => {
    const { store } = setup();
    store.declare('entity:*.looted', { type: 'bool', default: false, persistence: 'permanent' });
    store.declare('camp.fire-lit', { type: 'bool', default: false, persistence: 'reset-on-rest' });
    const chest = 'entity:mine/chest-3.looted';
    store.set(chest, true);
    store.set('camp.fire-lit', true);
    for (let rest = 0; rest < 10; rest++) store.applyResets('rest');
    expect(store.get(chest)).toBe(true);
    expect(store.get('camp.fire-lit')).toBe(false);
    expect(store.persistenceOf(chest)).toBe('permanent');
    expect(store.persistenceOf('never.declared')).toBe('permanent');
  });

  it('a rest cannot reset facts inside a transaction', () => {
    const { store } = setup();
    store.declare('bell.lit', { type: 'bool', default: false, persistence: 'reset-on-rest' });
    store.set('bell.lit', true);
    expect(() => store.transaction(() => store.applyResets('rest'))).toThrow(/transaction/);
    expect(store.get('bell.lit')).toBe(true);
  });

  it('AC-3 (facts): a transient fact is never saved and a save that holds one loads the default', () => {
    const { store } = setup();
    store.declare('player.alarmed', { type: 'bool', default: false, persistence: 'transient' });
    store.declare('player.class', { type: 'id' });
    store.set('player.alarmed', true);
    store.set('player.class', 'knight');
    expect(store.persistentSnapshot()).toEqual({ 'player.class': 'knight' });
    const settled = settleSavedFacts(store, store.snapshot(), 0);
    expect(settled.facts).toEqual({ 'player.class': 'knight' });
    expect(settled.transient).toEqual(['player.alarmed']);
  });

  it('AC-2 (facts): a decays-to fact loads a saved value in "from" as "to"', () => {
    const { store } = setup();
    store.declare('barn.state', {
      type: 'enum',
      values: ['standing', 'burning', 'burnt'],
      default: 'standing',
      persistence: 'decays-to',
      decaysTo: { from: ['burning'], to: 'burnt' },
    });
    store.set('barn.state', 'burning');
    const saved = store.persistentSnapshot();
    expect(saved).toEqual({ 'barn.state': 'burning' });
    const settled = settleSavedFacts(store, saved, 0);
    expect(settled.facts).toEqual({ 'barn.state': 'burnt' });
    expect(settled.decayed).toEqual([{ key: 'barn.state', from: 'burning', to: 'burnt' }]);
    // Other values load as saved.
    expect(settleSavedFacts(store, { 'barn.state': 'standing' }, 0).facts).toEqual({
      'barn.state': 'standing',
    });
  });

  it('AC-5: transient with a reset timer is an invalid combination the store refuses', () => {
    const { store } = setup();
    expect(() =>
      store.declare('x.y', {
        type: 'bool',
        default: false,
        persistence: 'transient',
        resetAfter: 10,
      }),
    ).toThrow(FactDeclarationError);
    expect(() =>
      store.declare('x.y', {
        type: 'bool',
        default: false,
        persistence: 'transient',
        resetAfter: 10,
      }),
    ).toThrow(/resetAfter needs persistence "reset-after"/);
  });

  it('refuses incomplete or contradictory policies', () => {
    const { store } = setup();
    const bad = (spec: Parameters<FactStore['declare']>[1], message: RegExp): void => {
      expect(() => store.declare('p.q', spec)).toThrow(message);
    };
    bad({ type: 'bool', default: false, persistence: 'reset-after' }, /needs resetAfter/);
    bad(
      { type: 'bool', default: false, persistence: 'reset-after', resetAfter: 0 },
      /positive whole number/,
    );
    bad({ type: 'bool', persistence: 'reset-on-rest' }, /needs a default/);
    bad({ type: 'bool', persistence: 'reset-after', resetAfter: 5 }, /needs a default/);
    bad(
      { type: 'bool', default: false, persistence: 'bogus' as 'permanent' },
      /unknown persistence/,
    );
    bad(
      { type: 'bool', default: false, decaysTo: { from: [true], to: false } },
      /decaysTo needs persistence "decays-to"/,
    );
    bad({ type: 'bool', default: false, persistence: 'decays-to' }, /needs decaysTo/);
    bad(
      { type: 'bool', default: false, persistence: 'decays-to', decaysTo: { from: [], to: true } },
      /at least one value/,
    );
    bad(
      {
        type: 'bool',
        default: false,
        persistence: 'decays-to',
        decaysTo: { from: ['no'], to: true },
      },
      /must be of type bool/,
    );
    // Nothing was declared by the refusals.
    expect(store.isDeclared('p.q')).toBe(false);
  });

  it('a timer key that is already declared blocks the reset-after fact', () => {
    const { store } = setup();
    store.declare('a.b.written-at', { type: 'tick' });
    expect(() =>
      store.declare('a.b', {
        type: 'bool',
        default: false,
        persistence: 'reset-after',
        resetAfter: 5,
      }),
    ).toThrow(/already declared/);
  });
});
