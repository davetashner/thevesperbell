import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  LogicError,
  LogicRegistry,
  LogicRegistryError,
  MemoryLogicHost,
  applyLogicEffects,
  createLogicRegistry,
  describeCondition,
  describeConditionParts,
  describeText,
  compareNumbers,
  describeEffect,
  evaluateLogic,
  logicConditionSchema,
  logicEffectsSchema,
  logicRegistry,
  validateLogicCondition,
  validateLogicEffects,
  type LogicNode,
  type LogicRef,
} from './index';

function condition(data: unknown, registry = logicRegistry): LogicNode {
  const result = validateLogicCondition(data, { registry });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

function effects(data: unknown): readonly LogicNode[] {
  const result = validateLogicEffects(data);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

describe('evaluation', () => {
  it('AC-1: all[hasItem(key-a), not(fact(door.open))] holds with the key and the door closed', () => {
    const rule = condition({
      kind: 'all',
      of: [
        { kind: 'hasItem', item: 'key-a' },
        { kind: 'not', condition: { kind: 'fact', fact: 'door.open' } },
      ],
    });
    const host = new MemoryLogicHost({ items: { 'key-a': 1 }, facts: { 'door.open': false } });
    expect(evaluateLogic(rule, host)).toBe(true);
    host.setFact('door.open', true);
    expect(evaluateLogic(rule, host)).toBe(false);
  });

  it('AC-1: fact and factCmp delegate to the shared fact condition API', () => {
    const host = new MemoryLogicHost({ facts: { 'horn.rescues': 3, 'horn.fate': 'alive' } });
    const cmp = (op: string, value: unknown) =>
      evaluateLogic(condition({ kind: 'factCmp', fact: 'horn.rescues', op, value }), host);
    expect(cmp('gte', 3)).toBe(true);
    expect(cmp('gt', 3)).toBe(false);
    expect(cmp('lt', 4)).toBe(true);
    expect(cmp('lte', 2)).toBe(false);
    expect(cmp('eq', 3)).toBe(true);
    expect(cmp('neq', 3)).toBe(false);
    expect(
      evaluateLogic(
        condition({ kind: 'factCmp', fact: 'horn.fate', op: 'eq', value: 'alive' }),
        host,
      ),
    ).toBe(true);
    expect(evaluateLogic(condition({ kind: 'fact', fact: 'unset.flag' }), host)).toBe(false);
  });

  it('AC-1: any, hasCapability, playerClass, disposition, quests, gold and time of day', () => {
    const host = new MemoryLogicHost({
      capabilities: ['swim'],
      playerClass: 'mage',
      dispositions: { miller: 10 },
      gold: 50,
      minuteOfDay: 23 * 60,
    });
    host.startQuest('mill');
    host.completeObjective('mill', 'grain');
    const holds = (data: unknown) => evaluateLogic(condition(data), host);
    expect(
      holds({
        kind: 'any',
        of: [
          { kind: 'hasCapability', capability: 'fly' },
          { kind: 'hasCapability', capability: 'swim' },
        ],
      }),
    ).toBe(true);
    expect(holds({ kind: 'playerClass', class: 'mage' })).toBe(true);
    expect(holds({ kind: 'playerClass', class: 'rogue' })).toBe(false);
    expect(holds({ kind: 'disposition', npc: 'miller', op: 'gte', value: 10 })).toBe(true);
    expect(holds({ kind: 'disposition', npc: 'nobody', op: 'lt', value: 0 })).toBe(false);
    expect(holds({ kind: 'questState', quest: 'mill', state: 'active' })).toBe(true);
    expect(holds({ kind: 'questState', quest: 'other', state: 'unstarted' })).toBe(true);
    expect(
      holds({ kind: 'objectiveState', quest: 'mill', objective: 'grain', state: 'complete' }),
    ).toBe(true);
    expect(
      holds({ kind: 'objectiveState', quest: 'mill', objective: 'cart', state: 'inactive' }),
    ).toBe(true);
    expect(holds({ kind: 'gold', op: 'gte', value: 50 })).toBe(true);
    expect(holds({ kind: 'gold', op: 'gt', value: 50 })).toBe(false);
    expect(holds({ kind: 'hasItem', item: 'key-a', count: 2 })).toBe(false);
    // 22:00 to 04:00 wraps midnight; 23:00 is inside, 12:00 is not.
    expect(holds({ kind: 'timeOfDay', from: '22:00', to: '04:00' })).toBe(true);
    host.minute = 12 * 60;
    expect(holds({ kind: 'timeOfDay', from: '22:00', to: '04:00' })).toBe(false);
    expect(holds({ kind: 'timeOfDay', from: '08:00', to: '18:00' })).toBe(true);
    expect(holds({ kind: 'timeOfDay', from: '18:00', to: '19:00' })).toBe(false);
    host.minute = 18 * 60;
    expect(holds({ kind: 'timeOfDay', from: '08:00', to: '18:00' })).toBe(false);
  });

  it('AC-3: evaluating a kind nobody registered throws', () => {
    expect(() => evaluateLogic({ kind: 'mystery' }, new MemoryLogicHost())).toThrow(LogicError);
  });
});

describe('effects', () => {
  it('AC-2: a batch where takeItem fails applies neither effect and returns the reason', () => {
    const host = new MemoryLogicHost({ items: { y: 0 } });
    const result = applyLogicEffects(
      effects([
        { kind: 'giveItem', item: 'y' },
        { kind: 'takeItem', item: 'x' },
      ]),
      host,
    );
    expect(result).toEqual({ ok: false, index: 1, kind: 'takeItem', reason: 'missing-item:x' });
    expect(host.itemCount('y')).toBe(0);
  });

  it('AC-2: the written order [takeItem(x), giveItem(y)] fails at the first effect with nothing changed', () => {
    const host = new MemoryLogicHost();
    const result = applyLogicEffects(
      effects([
        { kind: 'takeItem', item: 'x' },
        { kind: 'giveItem', item: 'y' },
      ]),
      host,
    );
    expect(result).toMatchObject({ ok: false, index: 0, reason: 'missing-item:x' });
    expect(host.itemCount('y')).toBe(0);
  });

  it('AC-2: a refusal rolls back earlier facts, gold, quests and withholds events and rumors', () => {
    const host = new MemoryLogicHost({ gold: 5 });
    const result = applyLogicEffects(
      effects([
        { kind: 'setFact', fact: 'door.open', value: true },
        { kind: 'gold', delta: 3 },
        { kind: 'startQuest', quest: 'mill' },
        { kind: 'emit', event: 'door-opened' },
        { kind: 'revealRumor', rumor: 'cellar' },
        { kind: 'gold', delta: -100 },
      ]),
      host,
    );
    expect(result).toMatchObject({ ok: false, index: 5, reason: 'insufficient-gold' });
    expect(host.facts.get('door.open')).toBeUndefined();
    expect(host.gold()).toBe(5);
    expect(host.questState('mill')).toBe('unstarted');
    expect(host.emitted).toEqual([]);
    expect(host.rumors).toEqual([]);
  });

  it('AC-2: a successful batch applies every effect in order and publishes after commit', () => {
    const host = new MemoryLogicHost({ items: { coin: 1 }, gold: 10 });
    const result = applyLogicEffects(
      effects([
        { kind: 'takeItem', item: 'coin' },
        { kind: 'giveItem', item: 'key-a', count: 2 },
        { kind: 'setFact', fact: 'door.open', value: true },
        { kind: 'gold', delta: -4 },
        { kind: 'disposition', npc: 'miller', delta: 5 },
        { kind: 'startQuest', quest: 'mill' },
        { kind: 'completeObjective', quest: 'mill', objective: 'grain' },
        { kind: 'learnCapability', capability: 'swim' },
        { kind: 'emit', event: 'door-opened', data: { who: 'player', n: 2 } },
        { kind: 'revealRumor', rumor: 'cellar' },
        { kind: 'resolveQuest', quest: 'mill', resolution: 'paid' },
      ]),
      host,
    );
    expect(result).toEqual({ ok: true, applied: 11 });
    expect(host.itemCount('coin')).toBe(0);
    expect(host.itemCount('key-a')).toBe(2);
    expect(host.facts.get('door.open')).toBe(true);
    expect(host.gold()).toBe(6);
    expect(host.disposition('miller')).toBe(5);
    expect(host.objectiveState('mill', 'grain')).toBe('complete');
    expect(host.hasCapability('swim')).toBe(true);
    expect(host.questState('mill')).toBe('resolved');
    expect(host.resolution('mill')).toBe('paid');
    expect(host.emitted).toEqual([{ event: 'door-opened', data: { who: 'player', n: 2 } }]);
    expect(host.rumors).toEqual(['cellar']);
  });

  it('AC-2: failQuest, and quest transitions refused out of order', () => {
    const host = new MemoryLogicHost();
    const apply = (data: unknown) => applyLogicEffects(effects(data), host);
    expect(apply([{ kind: 'failQuest', quest: 'mill' }])).toMatchObject({
      reason: 'quest-not-active:mill',
    });
    expect(apply([{ kind: 'completeObjective', quest: 'mill', objective: 'a' }])).toMatchObject({
      ok: false,
    });
    expect(apply([{ kind: 'resolveQuest', quest: 'mill' }])).toMatchObject({ ok: false });
    expect(apply([{ kind: 'startQuest', quest: 'mill' }])).toMatchObject({ ok: true });
    expect(apply([{ kind: 'startQuest', quest: 'mill' }])).toMatchObject({
      reason: 'quest-already-started:mill',
    });
    expect(apply([{ kind: 'failQuest', quest: 'mill' }])).toMatchObject({ ok: true });
    expect(host.questState('mill')).toBe('failed');
  });

  it('AC-2: an effect that throws rolls the batch back and rethrows', () => {
    const registry = createLogicRegistry();
    registry.registerEffect({
      kind: 'explode',
      schema: z.strictObject({}),
      apply: () => {
        throw new Error('boom');
      },
    });
    const host = new MemoryLogicHost();
    const batch = [{ kind: 'setFact', fact: 'a.b', value: true }, { kind: 'explode' }];
    expect(() => applyLogicEffects(batch, host, registry)).toThrow('boom');
    expect(host.facts.get('a.b')).toBeUndefined();
  });

  it('AC-3: applying an unknown effect kind throws before changing anything', () => {
    const host = new MemoryLogicHost();
    expect(() =>
      applyLogicEffects([{ kind: 'setFact', fact: 'a.b', value: true }, { kind: 'nope' }], host),
    ).toThrow(LogicError);
    expect(host.facts.get('a.b')).toBeUndefined();
  });
});

describe('validation', () => {
  it('AC-3: an unknown condition kind fails naming the kind and path', () => {
    const result = validateLogicCondition({
      kind: 'all',
      of: [
        { kind: 'fact', fact: 'a.b' },
        { kind: 'not', condition: { kind: 'moonPhase' } },
      ],
    });
    expect(result).toEqual({
      ok: false,
      issues: [
        {
          path: 'of[1].condition',
          message: 'unknown condition kind "moonPhase" at of[1].condition',
        },
      ],
    });
    const root = validateLogicCondition({ kind: 'moonPhase' });
    expect(root).toMatchObject({
      ok: false,
      issues: [{ path: '', message: 'unknown condition kind "moonPhase" at the root' }],
    });
  });

  it('AC-3: an unknown effect kind fails naming the kind and path', () => {
    const result = validateLogicEffects([{ kind: 'giveItem', item: 'a' }, { kind: 'teleport' }]);
    expect(result).toEqual({
      ok: false,
      issues: [{ path: '[1]', message: 'unknown effect kind "teleport" at [1]' }],
    });
    expect(validateLogicEffects([{ kind: 'x' }]).ok).toBe(false);
  });

  it('AC-3: malformed data is reported with a path', () => {
    const issue = (data: unknown) => {
      const result = validateLogicCondition(data);
      if (result.ok) throw new Error('expected failure');
      return result.issues;
    };
    expect(issue(null)[0]?.message).toContain('"kind"');
    expect(issue([])[0]?.path).toBe('');
    expect(issue({ kind: 7 })[0]?.message).toContain('"kind"');
    expect(issue({ kind: 'all', of: [] })[0]).toMatchObject({ path: 'of' });
    expect(issue({ kind: 'all' })[0]).toMatchObject({ path: 'of' });
    expect(
      issue({ kind: 'any', of: [{ kind: 'fact', fact: 'a.b' }], extra: 1 })[0]?.message,
    ).toContain('"extra"');
    expect(
      issue({ kind: 'not', condition: { kind: 'fact', fact: 'a.b' }, extra: 1 })[0]?.message,
    ).toContain('"extra"');
    expect(issue({ kind: 'not' })[0]).toMatchObject({ path: 'condition' });
    expect(issue({ kind: 'hasItem', item: 'Bad Id' })[0]).toMatchObject({ path: 'item' });
    expect(issue({ kind: 'hasItem', item: 'a', count: 0 })[0]).toMatchObject({ path: 'count' });
    expect(issue({ kind: 'hasItem', item: 'a', stray: 1 })[0]?.message).toContain('hasItem');
    expect(issue({ kind: 'fact', fact: 'NOT A KEY' })[0]).toMatchObject({ path: 'fact' });
    expect(issue({ kind: 'factCmp', fact: 'a.b', op: 'gte', value: 'x' })[0]).toMatchObject({
      path: 'value',
    });
    expect(issue({ kind: 'timeOfDay', from: '25:00', to: '04:00' })[0]).toMatchObject({
      path: 'from',
    });
    expect(issue({ kind: 'questState', quest: 'q', state: 'done' })[0]).toMatchObject({
      path: 'state',
    });
    expect(
      issue({ kind: 'all', of: [{ kind: 'all', of: [{ kind: 'hasItem' }] }, { kind: 'x' }] }),
    ).toHaveLength(2);
    expect(validateLogicEffects('nope')).toEqual({
      ok: false,
      issues: [{ path: '', message: 'expected a list of effects' }],
    });
    const effectIssues = validateLogicEffects([
      5,
      { kind: 'gold', delta: 0 },
      { kind: 'resolveQuest', quest: 'q', resolution: 'X' },
    ]);
    expect(effectIssues).toMatchObject({ ok: false });
    if (!effectIssues.ok)
      expect(effectIssues.issues.map((i) => i.path)).toEqual([
        '[0]',
        '[1].delta',
        '[2].resolution',
      ]);
  });

  it('AC-3: nesting deeper than the shared condition limit is rejected with its path', () => {
    let deep: unknown = { kind: 'fact', fact: 'a.b' };
    for (let i = 0; i < 64; i += 1) deep = { kind: 'not', condition: deep };
    const result = validateLogicCondition(deep);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.issues[0]?.message).toContain('64 levels');
    let ok: unknown = { kind: 'fact', fact: 'a.b' };
    for (let i = 0; i < 63; i += 1) ok = { kind: 'not', condition: ok };
    expect(validateLogicCondition(ok).ok).toBe(true);
  });

  it('AC-3: validation fills defaults and is JSON-serializable', () => {
    const node = condition({ kind: 'hasItem', item: 'key-a' });
    expect(node).toEqual({ kind: 'hasItem', item: 'key-a', count: 1 });
    expect(JSON.parse(JSON.stringify(node))).toEqual(node);
  });

  it('AC-3: the reference hook reports content that does not exist', () => {
    const known = new Set(['item:key-a', 'quest:mill', 'objective:mill/grain', 'fact:door.open']);
    const references = (ref: LogicRef) =>
      known.has(`${ref.type}:${ref.id}`) ? undefined : `unknown ${ref.type} "${ref.id}"`;
    const bad = validateLogicCondition(
      {
        kind: 'all',
        of: [
          { kind: 'hasItem', item: 'key-b' },
          { kind: 'objectiveState', quest: 'mill', objective: 'cart', state: 'active' },
          { kind: 'fact', fact: 'door.open' },
          { kind: 'gold', op: 'gt', value: 1 },
        ],
      },
      { references },
    );
    expect(bad).toMatchObject({ ok: false });
    if (!bad.ok) {
      expect(bad.issues.map((i) => [i.path, i.message])).toEqual([
        ['of[0]', 'condition "hasItem": unknown item "key-b"'],
        ['of[1]', 'condition "objectiveState": unknown objective "mill/cart"'],
      ]);
    }
    expect(
      validateLogicEffects([{ kind: 'giveItem', item: 'key-b' }], { references }),
    ).toMatchObject({ ok: false });
    expect(validateLogicEffects([{ kind: 'giveItem', item: 'key-a' }], { references }).ok).toBe(
      true,
    );
  });

  it('AC-3: zod schemas wrap validation for content fields', () => {
    const schema = z.object({ when: logicConditionSchema(), then: logicEffectsSchema() });
    const good = schema.safeParse({
      when: { kind: 'hasItem', item: 'key-a' },
      then: [{ kind: 'giveItem', item: 'y' }],
    });
    expect(good.success).toBe(true);
    const bad = schema.safeParse({
      when: { kind: 'all', of: [{ kind: 'nope' }] },
      then: [{ kind: 'gold', delta: 0 }],
    });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues.map((i) => i.path)).toEqual([
        ['when', 'of', 0],
        ['then', 0, 'delta'],
      ]);
    }
    const references = () => 'nope';
    expect(
      logicConditionSchema(logicRegistry, references).safeParse({ kind: 'fact', fact: 'a.b' })
        .success,
    ).toBe(false);
  });
});

describe('extension registry', () => {
  function withShop() {
    const registry = createLogicRegistry();
    registry.registerCondition({
      kind: 'shop.stocked',
      schema: z.strictObject({ shop: z.string(), item: z.string() }),
      evaluate: (node, context) =>
        (
          (context.services?.['stock'] as Record<string, string[]> | undefined)?.[node.shop] ?? []
        ).includes(node.item),
    });
    return registry;
  }

  it('AC-4: a registered extension condition validates and evaluates like a built-in', () => {
    const registry = withShop();
    const rule = condition(
      {
        kind: 'all',
        of: [
          { kind: 'shop.stocked', shop: 'smith', item: 'sword' },
          { kind: 'gold', op: 'gte', value: 1 },
        ],
      },
      registry,
    );
    const host = new MemoryLogicHost({ gold: 3, services: { stock: { smith: ['sword'] } } });
    expect(evaluateLogic(rule, host, registry)).toBe(true);
    expect(evaluateLogic(rule, new MemoryLogicHost({ gold: 3 }), registry)).toBe(false);
    expect(describeCondition(rule)).toBe(
      'logic.condition.all(logic.condition.shop.stocked(shop=smith,item=sword),logic.condition.gold(op=gte,value=1))',
    );
    expect(registry.conditionNames()).toContain('shop.stocked');
    // The shared registry is untouched, and the extension's own validator rejects bad fields.
    expect(validateLogicCondition({ kind: 'shop.stocked', shop: 'smith', item: 'sword' }).ok).toBe(
      false,
    );
    expect(
      validateLogicCondition({ kind: 'shop.stocked', shop: 1, item: 'x' }, { registry }),
    ).toMatchObject({ ok: false, issues: [{ path: 'shop' }] });
  });

  it('AC-4: extension effects apply atomically with built-ins', () => {
    const registry = createLogicRegistry();
    registry.registerEffect({
      kind: 'shop.restock',
      schema: z.strictObject({ shop: z.string() }),
      apply: (node, host) => host.setFact(`shop.${node.shop}.restocked`, true),
      refs: (node) => [{ type: 'shop', id: node.shop }],
    });
    const result = validateLogicEffects([{ kind: 'shop.restock', shop: 'smith' }], {
      registry,
      references: () => undefined,
    });
    expect(result.ok).toBe(true);
    const host = new MemoryLogicHost();
    if (result.ok) applyLogicEffects(result.value, host, registry);
    expect(host.facts.get('shop.smith.restocked')).toBe(true);
    expect(registry.effectNames()).toContain('shop.restock');
  });

  it('AC-4: duplicate, reserved and malformed kind names are refused', () => {
    const registry = createLogicRegistry();
    const schema = z.strictObject({});
    const evaluate = () => true;
    expect(() => {
      registry.registerCondition({ kind: 'fact', schema, evaluate });
    }).toThrow(LogicRegistryError);
    expect(() => {
      registry.registerCondition({ kind: 'all', schema, evaluate });
    }).toThrow(/already registered/);
    expect(() => {
      registry.registerCondition({ kind: 'Bad Kind', schema, evaluate });
    }).toThrow(/invalid condition kind/);
    expect(() => {
      registry.registerEffect({ kind: 'gold', schema, apply: () => undefined });
    }).toThrow(LogicRegistryError);
    expect(() => {
      new LogicRegistry().registerEffect({ kind: 'all', schema, apply: () => undefined });
    }).not.toThrow();
  });
});

describe('describe', () => {
  const conditions: unknown[] = [
    { kind: 'all', of: [{ kind: 'fact', fact: 'a.b' }] },
    { kind: 'any', of: [{ kind: 'fact', fact: 'a.b' }] },
    { kind: 'not', condition: { kind: 'fact', fact: 'a.b' } },
    { kind: 'fact', fact: 'door.open' },
    { kind: 'factCmp', fact: 'a.b', op: 'gte', value: 3 },
    { kind: 'hasItem', item: 'key-a' },
    { kind: 'hasCapability', capability: 'swim' },
    { kind: 'playerClass', class: 'mage' },
    { kind: 'disposition', npc: 'miller', op: 'gte', value: 1 },
    { kind: 'questState', quest: 'mill', state: 'active' },
    { kind: 'objectiveState', quest: 'mill', objective: 'grain', state: 'active' },
    { kind: 'gold', op: 'gte', value: 5 },
    { kind: 'timeOfDay', from: '08:00', to: '18:00' },
  ];

  it('AC-5: every built-in condition kind describes as a non-empty localized key', () => {
    const kinds = new Set<string>();
    for (const data of conditions) {
      const node = condition(data);
      kinds.add(node.kind);
      const text = describeCondition(node);
      expect(text.length).toBeGreaterThan(0);
      expect(text.startsWith(`logic.condition.${node.kind}`)).toBe(true);
    }
    expect([...kinds].sort()).toEqual(logicRegistry.conditionNames());
  });

  it('AC-5: every built-in effect kind describes as a non-empty localized key', () => {
    const batch = effects([
      { kind: 'setFact', fact: 'a.b', value: true },
      { kind: 'giveItem', item: 'a' },
      { kind: 'takeItem', item: 'a' },
      { kind: 'gold', delta: 2 },
      { kind: 'disposition', npc: 'miller', delta: 1 },
      { kind: 'startQuest', quest: 'mill' },
      { kind: 'completeObjective', quest: 'mill', objective: 'grain' },
      { kind: 'resolveQuest', quest: 'mill' },
      { kind: 'failQuest', quest: 'mill' },
      { kind: 'learnCapability', capability: 'swim' },
      { kind: 'emit', event: 'rang', data: { n: 1 } },
      { kind: 'revealRumor', rumor: 'cellar' },
    ]);
    expect(new Set(batch.map((e) => e.kind))).toEqual(new Set(logicRegistry.effectNames()));
    for (const effect of batch) {
      const text = describeEffect(effect);
      expect(text.startsWith(`logic.effect.${effect.kind}`)).toBe(true);
    }
    expect(batch.map(describeEffect)[3]).toBe('logic.effect.gold(delta=2)');
  });

  it('AC-5: parts keep the key, parameters and nesting for UI to localize', () => {
    const parts = describeConditionParts(
      condition({ kind: 'not', condition: { kind: 'hasItem', item: 'key-a', count: 2 } }),
    );
    expect(parts).toEqual({
      key: 'logic.condition.not',
      params: {},
      children: [
        { key: 'logic.condition.hasItem', params: { item: 'key-a', count: 2 }, children: [] },
      ],
    });
    expect(describeCondition(condition({ kind: 'fact', fact: 'a.b' }))).toBe(
      'logic.condition.fact(fact=a.b)',
    );
  });
});

describe('helpers', () => {
  it('AC-1: compareNumbers implements every operator', () => {
    const table = {
      eq: [false, true, false],
      neq: [true, false, true],
      gt: [false, false, true],
      gte: [false, true, true],
      lt: [true, false, false],
      lte: [true, true, false],
    } as const;
    for (const [op, expected] of Object.entries(table)) {
      expect([1, 2, 3].map((n) => compareNumbers(op as 'eq', n, 2))).toEqual([...expected]);
    }
    // disposition and gold use the same comparison
    const host = new MemoryLogicHost({ gold: 2, dispositions: { a: 2 } });
    expect(evaluateLogic(condition({ kind: 'gold', op: 'eq', value: 2 }), host)).toBe(true);
    expect(
      evaluateLogic(condition({ kind: 'disposition', npc: 'a', op: 'neq', value: 2 }), host),
    ).toBe(false);
    expect(
      evaluateLogic(condition({ kind: 'disposition', npc: 'a', op: 'lte', value: 2 }), host),
    ).toBe(true);
    expect(evaluateLogic(condition({ kind: 'gold', op: 'lt', value: 2 }), host)).toBe(false);
  });

  it('AC-5: a bare key describes as itself', () => {
    expect(describeText({ key: 'logic.condition.x', params: {}, children: [] })).toBe(
      'logic.condition.x',
    );
  });

  it('AC-4: extension schemas report nested paths', () => {
    const registry = createLogicRegistry();
    registry.registerCondition({
      kind: 'many',
      schema: z.strictObject({ ids: z.array(z.string()) }),
      evaluate: () => true,
    });
    expect(validateLogicCondition({ kind: 'many', ids: ['a', 2] }, { registry })).toMatchObject({
      ok: false,
      issues: [{ path: 'ids[1]' }],
    });
  });

  it('AC-1: the memory host lists facts by prefix in key order', () => {
    const host = new MemoryLogicHost({ facts: { 'b.x': 1, 'a.y': 2, 'a.x': 3 } });
    expect(host.facts.entries('a.')).toEqual([
      ['a.x', 3],
      ['a.y', 2],
    ]);
    expect(host.facts.entries().map(([k]) => k)).toEqual(['a.x', 'a.y', 'b.x']);
  });
});
