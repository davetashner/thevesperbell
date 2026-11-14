import { describe, expect, it, vi } from 'vitest';
import { World } from '../core/world';
import { declareFacts, factSpecFromDef, type FactDeclaration } from './registry';
import {
  FactDeclarationError,
  factChanged,
  FactKeyError,
  factTemplateOf,
  FactTypeError,
  isFactTemplate,
  UndeclaredFactError,
  type FactChange,
} from './store';

const common = { description: 'Test fact.', owner: 'quest', persistence: 'permanent' } as const;

function recorded(): { world: World; changes: FactChange[] } {
  const world = new World({ seed: 5 });
  const changes: FactChange[] = [];
  world.events.on(factChanged, (change) => changes.push(change));
  return { world, changes };
}

describe('fact templates', () => {
  it('recognises templates and maps entity keys to theirs', () => {
    expect(isFactTemplate('entity:*.looted')).toBe(true);
    expect(isFactTemplate('entity:*.lid.open')).toBe(true);
    expect(isFactTemplate('entity:mine/chest-3.looted')).toBe(false);
    expect(isFactTemplate('horn.fate')).toBe(false);
    expect(factTemplateOf('entity:mine/chest-3.looted')).toBe('entity:*.looted');
    expect(factTemplateOf('entity:mine/chest-3.lid.open')).toBe('entity:*.lid.open');
    expect(factTemplateOf('horn.fate')).toBeUndefined();
  });

  it('AC-4: "entity:mine/chest-3.looted" validates against the "entity:*.looted" template type', () => {
    const { world } = recorded();
    world.facts.declare('entity:*.looted', { type: 'bool', default: false });
    const key = 'entity:mine/chest-3.looted';
    expect(world.facts.get(key)).toBe(false);
    expect(world.facts.isDeclared(key)).toBe(true);
    expect(world.facts.typeOf(key)).toBe('bool');
    expect(world.facts.set(key, true)).toBe(true);
    expect(world.facts.get(key)).toBe(true);
    expect(() => world.facts.set('entity:mine/chest-4.looted', 3)).toThrow(FactTypeError);
    expect(world.facts.has('entity:mine/chest-4.looted')).toBe(false);
  });

  it('an exact declaration wins over its template', () => {
    const { world } = recorded();
    world.facts.declare('entity:*.opened', { type: 'bool', default: false });
    world.facts.declare('entity:mine/vault.opened', { type: 'int', default: 0 });
    expect(world.facts.spec('entity:mine/vault.opened')).toEqual({ type: 'int', default: 0 });
    expect(world.facts.spec('entity:mine/door.opened')).toEqual({ type: 'bool', default: false });
    world.facts.set('entity:mine/vault.opened', 2);
    expect(world.facts.get('entity:mine/vault.opened')).toBe(2);
  });

  it('declaring a template checks the set facts it governs, not ones with their own declaration', () => {
    const { world } = recorded();
    world.facts.set('entity:mine/chest-1.looted', 1);
    expect(() => world.facts.declare('entity:*.looted', { type: 'bool' })).toThrow(
      /"entity:mine\/chest-1\.looted" takes type bool/,
    );
    const other = recorded().world;
    other.facts.declare('entity:mine/chest-1.looted', { type: 'int' });
    other.facts.set('entity:mine/chest-1.looted', 1);
    other.facts.set('entity:mine/chest-2.looted', true);
    other.facts.set('horn.fate', 'alive');
    other.facts.declare('entity:*.looted', { type: 'bool' });
    expect(other.facts.typeOf('entity:mine/chest-2.looted')).toBe('bool');
  });

  it('rejects a template declared twice and malformed templates', () => {
    const { world } = recorded();
    world.facts.declare('entity:*.looted', { type: 'bool' });
    expect(() => world.facts.declare('entity:*.looted', { type: 'bool' })).toThrow(
      FactDeclarationError,
    );
    expect(() => world.facts.declare('entity:*', { type: 'bool' })).toThrow(FactKeyError);
    expect(() => world.facts.declare('town:*.looted', { type: 'bool' })).toThrow(FactKeyError);
  });

  it('template defaults and types survive restore; restored values are checked against them', () => {
    const { world } = recorded();
    world.facts.declare('entity:*.looted', { type: 'bool', default: false });
    world.facts.set('entity:mine/chest-3.looted', true);
    const snapshot = world.snapshot();
    const copy = new World({ seed: 5 });
    copy.facts.declare('entity:*.looted', { type: 'bool', default: false });
    copy.restore(snapshot);
    expect(copy.facts.get('entity:mine/chest-3.looted')).toBe(true);
    const bad = { ...snapshot, facts: { 'entity:mine/chest-3.looted': 4 } };
    expect(() => {
      copy.restore(bad);
    }).toThrow(FactTypeError);
  });
});

describe('undeclared fact policy', () => {
  it('AC-3: in strict mode a write of an undeclared fact throws and changes nothing', () => {
    const { world, changes } = recorded();
    world.facts.declare('horn.befriended', { type: 'bool', default: false });
    world.facts.setUndeclaredPolicy({ mode: 'throw' });
    expect(() => world.facts.set('horn.befirended', true)).toThrow(UndeclaredFactError);
    expect(() => world.facts.set('horn.befirended', true)).toThrow(
      'fact "horn.befirended" is not declared',
    );
    expect(() => world.facts.increment('horn.rescues')).toThrow(UndeclaredFactError);
    expect(() => world.facts.stamp('bell.last-rung')).toThrow(UndeclaredFactError);
    expect(world.facts.set('horn.befriended', true)).toBe(true);
    world.events.flush();
    expect(world.facts.entries()).toEqual([['horn.befriended', true]]);
    expect(changes).toHaveLength(1);
  });

  it('AC-3 (edge): in production mode an undeclared write logs a warning and is ignored', () => {
    const { world, changes } = recorded();
    const warn = vi.fn<(error: UndeclaredFactError) => void>();
    world.facts.declare('horn.rescues', { type: 'int', default: 0 });
    world.facts.setUndeclaredPolicy({ mode: 'ignore', warn });
    expect(world.facts.set('horn.befirended', true)).toBe(false);
    expect(world.facts.increment('horn.rescuse', 2)).toBe(0);
    expect(world.facts.increment('horn.rescues', 2)).toBe(2);
    world.events.flush();
    expect(world.facts.entries()).toEqual([['horn.rescues', 2]]);
    expect(changes.map((c) => c.key)).toEqual(['horn.rescues']);
    expect(warn.mock.calls.map(([error]) => error.key)).toEqual([
      'horn.befirended',
      'horn.rescuse',
    ]);
  });

  it('a strict-mode throw inside a transaction undoes the whole batch', () => {
    const { world } = recorded();
    world.facts.declare('horn.spared', { type: 'bool', default: false });
    world.facts.setUndeclaredPolicy({ mode: 'throw' });
    expect(() => {
      world.facts.transaction(() => {
        world.facts.set('horn.spared', true);
        world.facts.set('horn.sparred', true);
      });
    }).toThrow(UndeclaredFactError);
    expect(world.facts.get('horn.spared')).toBe(false);
  });

  it('the policy is configuration: restore keeps it and still loads undeclared saved facts', () => {
    const { world } = recorded();
    world.facts.set('old.fact', true);
    const snapshot = world.snapshot();
    world.facts.setUndeclaredPolicy({ mode: 'throw' });
    world.restore(snapshot);
    expect(world.facts.get('old.fact')).toBe(true);
    expect(() => world.facts.set('old.fact', false)).toThrow(UndeclaredFactError);
    world.facts.setUndeclaredPolicy({ mode: 'infer' });
    expect(world.facts.set('old.fact', false)).toBe(true);
  });
});

describe('declareFacts', () => {
  const defs: FactDeclaration[] = [
    { ...common, key: 'tansy.saved', type: 'bool', default: false },
    { ...common, key: 'horn.rescues', type: 'int', default: 0 },
    { ...common, key: 'horn.fate', type: 'enum', values: ['alive', 'dead'], default: 'alive' },
    { ...common, key: 'bell.rung-by', type: 'id', default: null },
    { ...common, key: 'bell.cast-by', type: 'id', default: 'npc-horn' },
    { ...common, key: 'bell.last-rung', type: 'tick', default: null },
    { ...common, key: 'entity:*.looted', type: 'bool', default: false },
    { ...common, key: 'vault.open', type: 'bool', default: false, renamedFrom: ['vault_open'] },
  ];

  it('maps registry declarations to store specs; null defaults mean unset', () => {
    expect(defs.map(factSpecFromDef)).toEqual([
      { type: 'bool', default: false },
      { type: 'int', default: 0 },
      { type: 'enum', values: ['alive', 'dead'], default: 'alive' },
      { type: 'id' },
      { type: 'id', default: 'npc-horn' },
      { type: 'tick' },
      { type: 'bool', default: false },
      { type: 'bool', default: false, renamedFrom: ['vault_open'] },
    ]);
  });

  it('declares every group fact on the store and applies the policy', () => {
    const { world } = recorded();
    const groups = [
      { id: 'a', name: 'A', notes: 'A.', facts: defs.slice(0, 3) },
      { id: 'b', name: 'B', notes: 'B.', facts: defs.slice(3) },
    ];
    expect(declareFacts(world.facts, groups, { mode: 'throw' })).toBe(world.facts);
    expect(world.facts.get('horn.fate')).toBe('alive');
    expect(world.facts.get('bell.rung-by')).toBeUndefined();
    expect(world.facts.typeOf('bell.last-rung')).toBe('tick');
    expect(world.facts.get('entity:mine/chest-3.looted')).toBe(false);
    expect(() => world.facts.set('horn.fate', 'lost')).toThrow(FactTypeError);
    expect(() => world.facts.set('miller.found', true)).toThrow(UndeclaredFactError);
  });
});

describe('registry persistence policies (mw-e27.7)', () => {
  it('carries a declaration’s persistence policy into its store spec', () => {
    const base = { ...common, key: 'a.b', type: 'bool', default: false } as const;
    expect(factSpecFromDef(base as FactDeclaration)).toEqual({ type: 'bool', default: false });
    expect(
      factSpecFromDef({
        ...base,
        persistence: 'reset-after',
        resetAfter: 72_000,
      }),
    ).toEqual({ type: 'bool', default: false, persistence: 'reset-after', resetAfter: 72_000 });
    expect(factSpecFromDef({ ...base, persistence: 'reset-on-rest' })).toEqual({
      type: 'bool',
      default: false,
      persistence: 'reset-on-rest',
    });
    expect(
      factSpecFromDef({
        ...base,
        persistence: 'decays-to',
        decaysTo: { from: [true], to: false },
      }),
    ).toEqual({
      type: 'bool',
      default: false,
      persistence: 'decays-to',
      decaysTo: { from: [true], to: false },
    });
    const { world } = recorded();
    declareFacts(
      world.facts,
      [{ id: 'g', facts: [{ ...base, persistence: 'transient' } as FactDeclaration] }] as never,
      { mode: 'throw' },
    );
    expect(world.facts.persistenceOf('a.b')).toBe('transient');
  });
});
