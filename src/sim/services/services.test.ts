import { describe, expect, it } from 'vitest';
import type { ServiceDef } from '../../content/types/service';
import { z } from 'zod';
import { createLogicRegistry } from '../logic/builtins';
import { applyLogicEffects } from '../logic/apply';
import { dialogueLogicRegistry } from '../logic/dialogue-kinds';
import { MemoryLogicHost } from '../logic/memory-host';
import {
  createServiceCatalog,
  listServices,
  SERVICE_PURCHASED_EVENT,
  SERVICES_SERVICE,
  servicePrice,
  validateServiceLogic,
} from './index';

const registry = dialogueLogicRegistry();
const def = (extra: Record<string, unknown>): ServiceDef =>
  ({
    id: 'x',
    notes: 'n',
    name: 'X',
    providerNpcId: { id: 'npc-a' },
    price: 40,
    conditions: [],
    showWhenLocked: false,
    effects: [],
    ...extra,
  }) as unknown as ServiceDef;

const translate = def({
  id: 'translate-book',
  conditions: [{ kind: 'hasItem', item: 'book-untranslated' }],
  effects: [
    { kind: 'takeItem', item: 'book-untranslated' },
    { kind: 'giveItem', item: 'book-translated' },
  ],
});

function host(defs: ServiceDef[], init: ConstructorParameters<typeof MemoryLogicHost>[0] = {}) {
  const catalog = createServiceCatalog(defs, registry);
  return new MemoryLogicHost({ ...init, services: { [SERVICES_SERVICE]: catalog } });
}
const buy = (h: MemoryLogicHost, service: string) =>
  applyLogicEffects([{ kind: 'purchaseService', service }], h, registry);

describe('services (mw-e20.9)', () => {
  it('AC-4: both kinds name the service they reference', () => {
    const node = { kind: 'x', service: 'translate-book' };
    const want = [{ type: 'service', id: 'translate-book' }];
    expect(registry.condition('service.available')?.refs?.(node)).toEqual(want);
    expect(registry.effect('purchaseService')?.refs?.(node)).toEqual(want);
  });

  it('an effect kind the running registry lacks refuses', () => {
    const other = createLogicRegistry();
    other.registerEffect({ kind: 'zap', schema: z.strictObject({}), apply: () => undefined });
    const catalog = createServiceCatalog([def({ effects: [{ kind: 'zap' }] })], other);
    const h = new MemoryLogicHost({ gold: 90, services: { [SERVICES_SERVICE]: catalog } });
    expect(buy(h, 'x')).toMatchObject({ ok: false, reason: 'unknown-effect:zap' });
    expect(h.gold()).toBe(90);
  });

  it('AC-1: buying a translation takes the gold and swaps the book for its translation', () => {
    const h = host([translate], { gold: 100, items: { 'book-untranslated': 1 } });
    expect(buy(h, 'translate-book').ok).toBe(true);
    expect(h.gold()).toBe(60);
    expect(h.itemCount('book-untranslated')).toBe(0);
    expect(h.itemCount('book-translated')).toBe(1);
    expect(h.emitted).toEqual([
      {
        event: SERVICE_PURCHASED_EVENT,
        data: { service: 'translate-book', npc: 'npc-a', price: 40 },
      },
    ]);
  });

  it('AC-2: insufficient gold changes nothing and reports insufficient-gold', () => {
    const h = host([translate], { gold: 39, items: { 'book-untranslated': 1 } });
    expect(buy(h, 'translate-book')).toMatchObject({ ok: false, reason: 'insufficient-gold' });
    expect(h.gold()).toBe(39);
    expect(h.itemCount('book-untranslated')).toBe(1);
    expect(h.emitted).toEqual([]);
  });

  it('AC-2: a refused effect rolls the payment back', () => {
    const h = host([def({ effects: [{ kind: 'takeItem', item: 'missing' }] })], { gold: 100 });
    expect(buy(h, 'x')).toMatchObject({ ok: false, reason: 'missing-item:missing' });
    expect(h.gold()).toBe(100);
  });

  it('AC-3: unmet conditions refuse the purchase and hide or lock the listing', () => {
    const hidden = translate;
    const locked = { ...translate, id: 'locked', showWhenLocked: true };
    const h = host([hidden, locked], { gold: 100 });
    expect(buy(h, 'translate-book')).toMatchObject({
      ok: false,
      reason: 'service-locked:translate-book',
    });
    const catalog = h.services?.[SERVICES_SERVICE] as ReturnType<typeof createServiceCatalog>;
    expect(listServices(catalog, 'npc-a', h, registry)).toEqual([
      { id: 'locked', name: 'X', price: 40, available: false },
    ]);
    h.giveItem('book-untranslated', 1);
    expect(listServices(catalog, 'npc-a', h, registry).map((l) => l.available)).toEqual([
      true,
      true,
    ]);
  });

  it('an unknown service or a host without a catalog refuses', () => {
    expect(buy(host([]), 'nope')).toMatchObject({ ok: false, reason: 'no-such-service:nope' });
    expect(buy(new MemoryLogicHost({ gold: 5 }), 'nope')).toMatchObject({ ok: false });
  });

  it('bribes and donations move disposition and facts; a formula eases with disposition', () => {
    const bribe = def({
      id: 'bribe',
      price: undefined,
      priceFormula: { base: 50, floor: 20, perDisposition: 0.5 },
      effects: [
        { kind: 'disposition', npc: 'npc-a', delta: 5 },
        { kind: 'setFact', fact: 'guard.bribed', value: true },
      ],
    });
    const h = host([bribe], { gold: 100, dispositions: { 'npc-a': 20 } });
    expect(servicePrice(bribe, h)).toBe(40);
    expect(servicePrice(bribe, new MemoryLogicHost({ dispositions: { 'npc-a': 500 } }))).toBe(20);
    expect(servicePrice(bribe, new MemoryLogicHost({ dispositions: { 'npc-a': -9 } }))).toBe(50);
    expect(buy(h, 'bribe').ok).toBe(true);
    expect(h.gold()).toBe(60);
    expect(h.disposition('npc-a')).toBe(25);
    expect(h.facts.get('guard.bribed')).toBe(true);
  });

  it('service.available gates a dialogue option; fixed price comes back as is', () => {
    const h = host([translate], { gold: 1 });
    const cond = { kind: 'service.available', service: 'translate-book' };
    expect(registry.condition('service.available')?.evaluate(cond, h)).toBe(false);
    expect(registry.condition('service.available')?.evaluate({ ...cond, service: 'zz' }, h)).toBe(
      false,
    );
    h.giveItem('book-untranslated', 1);
    expect(registry.condition('service.available')?.evaluate(cond, h)).toBe(true);
    expect(servicePrice(translate, h)).toBe(40);
    expect(servicePrice({ ...translate, price: undefined }, h)).toBe(0);
  });

  it('the catalog rejects bad logic and the validator names problems, nested purchases included', () => {
    expect(() => createServiceCatalog([def({ conditions: [{ kind: 'nope' }] })], registry)).toThrow(
      /service "x"/,
    );
    expect(() => createServiceCatalog([def({ effects: [{ kind: 'nope' }] })], registry)).toThrow(
      /service "x"/,
    );
    const bad = def({
      conditions: [{ kind: 'nope' }],
      effects: [{ kind: 'purchaseService', service: 'y' }, { kind: 'zip' }],
    });
    const problems = validateServiceLogic(bad, registry);
    expect(problems.some((p) => p.startsWith('conditions[0]'))).toBe(true);
    expect(problems.some((p) => p.startsWith('effects'))).toBe(true);
    expect(validateServiceLogic(translate, registry)).toEqual([]);
    const nested = def({ effects: [{ kind: 'purchaseService', service: 'y' }] });
    expect(validateServiceLogic(nested, registry)).toEqual([
      'effects[0]: a service cannot use purchaseService',
    ]);
  });

  describe('barge fare with heal, advanceTime and travelTo (mw-e20.14)', () => {
    const fare = (days: number) =>
      def({
        id: `barge-${String(days)}`,
        price: 12,
        conditions: [{ kind: 'timeOfDay', from: '06:00', to: '12:00' }],
        showWhenLocked: true,
        effects: [
          { kind: 'advanceTime', days },
          { kind: 'travelTo', scene: 'wendmouth-wharf', spawn: 'barge-landing' },
        ],
      });
    const morning = 8 * 60;

    it('AC-1: the fare is taken, the arrival is requested and one day passes', () => {
      const h = host([fare(1)], { gold: 20, minuteOfDay: morning });
      expect(buy(h, 'barge-1')).toEqual({ ok: true, applied: 1 });
      expect(h.gold()).toBe(8);
      expect(h.advanced).toEqual([1440]);
      expect(h.minuteOfDay()).toBe(morning);
      expect(h.travels).toEqual([{ scene: 'wendmouth-wharf', spawn: 'barge-landing' }]);
      expect(h.emitted.map((e) => e.event)).toEqual([SERVICE_PURCHASED_EVENT]);
    });

    it('AC-2: two days is 2880 minutes, advanced before the travel is requested', () => {
      const h = host([fare(2)], { gold: 20, minuteOfDay: morning });
      expect(buy(h, 'barge-2').ok).toBe(true);
      expect(h.advanced).toEqual([2880]);
    });

    it('AC-3: at night it is refused, nothing is paid, no time passes, nowhere is requested', () => {
      const h = host([fare(1)], { gold: 20, minuteOfDay: 23 * 60 });
      expect(buy(h, 'barge-1')).toMatchObject({ ok: false, reason: 'service-locked:barge-1' });
      expect(h.gold()).toBe(20);
      expect(h.advanced).toEqual([]);
      expect(h.travels).toEqual([]);
    });

    it('a later refusal leaves the clock, health and place alone', () => {
      const h = host(
        [
          def({
            id: 'bad',
            effects: [
              { kind: 'heal', full: true },
              { kind: 'advanceTime', hours: 1 },
              { kind: 'travelTo', scene: 'a-scene', spawn: 'a-spawn' },
              { kind: 'takeItem', item: 'missing-thing', count: 1 },
            ],
          }),
        ],
        { gold: 90 },
      );
      expect(buy(h, 'bad')).toMatchObject({ ok: false });
      expect(h.gold()).toBe(90);
      expect([h.healed, h.advanced, h.travels]).toEqual([[], [], []]);
    });

    it('heals by an amount or fully, and durations add up', () => {
      const h = host([], { gold: 0 });
      const r = applyLogicEffects(
        [
          { kind: 'heal', amount: 5 },
          { kind: 'heal', full: true },
          { kind: 'advanceTime', days: 1, hours: 2, minutes: 3 },
        ],
        h,
        registry,
      );
      expect(r.ok).toBe(true);
      expect(h.healed).toEqual([5, 'full']);
      expect(h.advanced).toEqual([1440 + 120 + 3]);
      applyLogicEffects([{ kind: 'advanceTime', minutes: 30 }], h, registry);
      applyLogicEffects([{ kind: 'advanceTime', hours: 2 }], h, registry);
      expect(h.advanced.slice(1)).toEqual([30, 120]);
    });

    it('rejects bad fields and names the scene and spawn it references', () => {
      const schema = (n: unknown) => registry.effect('advanceTime')?.schema.safeParse(n).success;
      expect(schema({})).toBe(false);
      expect(schema({ hours: 0 })).toBe(false);
      expect(schema({ hours: 3 })).toBe(true);
      expect(registry.effect('heal')?.schema.safeParse({ amount: 3, full: true }).success).toBe(
        false,
      );
      expect(
        registry.effect('travelTo')?.refs?.({ kind: 'travelTo', scene: 's-a', spawn: 'p-b' }),
      ).toEqual([
        { type: 'scene', id: 's-a' },
        { type: 'spawn', id: 's-a/p-b' },
      ]);
    });

    it('validation insists travelTo comes after advanceTime', () => {
      const wrong = def({
        effects: [
          { kind: 'travelTo', scene: 's-a', spawn: 'p-b' },
          { kind: 'advanceTime', hours: 1 },
        ],
      });
      expect(validateServiceLogic(wrong, registry)).toEqual([
        'effects[0]: travelTo must come after advanceTime',
      ]);
      expect(validateServiceLogic(fare(1), registry)).toEqual([]);
    });

    it('inScene holds only in the scene the host names, and names the scene it references', () => {
      const cond = registry.condition('inScene');
      const at = (scene?: string) =>
        new MemoryLogicHost(scene === undefined ? {} : { services: { scene } });
      const node = { kind: 'inScene', scene: 'kestrel-lock' };
      expect(cond?.evaluate(node, at('kestrel-lock'))).toBe(true);
      expect(cond?.evaluate(node, at('wendmouth-harbour'))).toBe(false);
      expect(cond?.evaluate(node, at())).toBe(false);
      expect(cond?.refs?.(node)).toEqual([{ type: 'scene', id: 'kestrel-lock' }]);
    });
  });
});
