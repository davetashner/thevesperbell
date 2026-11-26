// Purchasable services (mw-e20.9): gold for something an NPC does. A service (content type
// `service`) has a price, conditions and effects in the shared logic DSL. Dialogue buys one with the
// `purchaseService` effect: it checks the conditions, takes the price with `host.adjustGold` and
// applies the service's effects through the same registry, all inside the caller's atomic batch, so
// insufficient gold or any refused effect leaves everything unchanged. Failures are DSL reasons:
// `no-such-service:<id>`, `service-locked:<id>`, `insufficient-gold`. After the batch commits it
// emits `service.purchased` { service, npc, price }. `service.available` is the matching condition
// (a dialogue option's `when`); `listServices` gives a provider's listing with locked/hidden entries
// per `showWhenLocked`. The catalog reaches the effect as the `services` entry of the host's
// `services` record (`SERVICES_SERVICE`). Deterministic: no clock, randomness or DOM.

import { z } from 'zod';
import type { ServiceDef } from '../../content/types/service';
import { evaluateLogic } from '../logic/evaluate';
import type { LogicRegistry } from '../logic/registry';
import type { LogicContext, LogicRef, LogicRefChecker } from '../logic/types';
import { validateLogicCondition, validateLogicEffects } from '../logic/validate';

/** Key of the service catalog on `LogicContext.services`. */
export const SERVICES_SERVICE = 'services';

/** The event a committed purchase emits. */
export const SERVICE_PURCHASED_EVENT = 'service.purchased';

/** Effect kinds a service's own effects may not use (no nested purchases). */
export const SERVICE_FORBIDDEN_EFFECTS: readonly string[] = ['purchaseService'];

/** A service with its conditions and effects validated and normalized. */
export type ResolvedService = ServiceDef;

export interface ServiceCatalog {
  get(id: string): ResolvedService | undefined;
  /** Services of one provider NPC, in id order. */
  forProvider(npc: string): readonly ResolvedService[];
}

/**
 * A catalog over `defs`, with conditions and effects normalized (defaults filled) by `registry`.
 * @throws Error when a service's logic does not validate.
 */
export function createServiceCatalog(
  defs: readonly ServiceDef[],
  registry: LogicRegistry,
): ServiceCatalog {
  const byId = new Map<string, ResolvedService>();
  for (const def of defs) {
    const conditions = def.conditions.map((c) => {
      const r = validateLogicCondition(c, { registry });
      if (!r.ok)
        throw new Error(`service "${def.id}": ${r.issues.map((i) => i.message).join('; ')}`);
      return r.value;
    });
    const e = validateLogicEffects(def.effects, { registry });
    if (!e.ok) throw new Error(`service "${def.id}": ${e.issues.map((i) => i.message).join('; ')}`);
    byId.set(def.id, { ...def, conditions: [...conditions], effects: [...e.value] });
  }
  const sorted = [...byId.values()].sort((a, b) => Number(a.id > b.id) - Number(a.id < b.id));
  return {
    get: (id) => byId.get(id),
    forProvider: (npc) => sorted.filter((s) => s.providerNpcId.id === npc),
  };
}

/** Crowns `service` costs in `context` (a formula eases with the provider's disposition). */
export function servicePrice(service: ServiceDef, context: LogicContext): number {
  const { price, priceFormula: f } = service;
  if (price !== undefined || f === undefined) return price ?? 0;
  const eased = Math.floor(
    Math.max(0, context.disposition(service.providerNpcId.id)) * f.perDisposition,
  );
  return Math.max(f.floor, f.base - eased);
}

/** Whether every condition of `service` holds. */
export function serviceConditionsHold(
  service: ServiceDef,
  context: LogicContext,
  registry: LogicRegistry,
): boolean {
  return service.conditions.every((c) => evaluateLogic(c, context, registry));
}

/** One line of a provider's listing. */
export interface ServiceListing {
  readonly id: string;
  readonly name: string;
  readonly price: number;
  /** False: conditions unmet (shown locked only when the service says `showWhenLocked`). */
  readonly available: boolean;
}

/** `npc`'s services as the player sees them: unmet ones are locked or hidden per `showWhenLocked`. */
export function listServices(
  catalog: ServiceCatalog,
  npc: string,
  context: LogicContext,
  registry: LogicRegistry,
): ServiceListing[] {
  return catalog.forProvider(npc).flatMap((service) => {
    const available = serviceConditionsHold(service, context, registry);
    if (!available && !service.showWhenLocked) return [];
    return [
      { id: service.id, name: service.name, price: servicePrice(service, context), available },
    ];
  });
}

const serviceId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'expected a service id');

function catalogOf(context: LogicContext): ServiceCatalog | undefined {
  return context.services?.[SERVICES_SERVICE] as ServiceCatalog | undefined;
}

/** Registers `purchaseService` and `service.available` into `registry`. */
export function registerServiceKinds(registry: LogicRegistry): void {
  const ref = (id: string): readonly LogicRef[] => [{ type: 'service', id }];
  registry.registerCondition({
    kind: 'service.available',
    schema: z.strictObject({ service: serviceId }),
    evaluate: (node, context) => {
      const service = catalogOf(context)?.get(node.service);
      return service !== undefined && serviceConditionsHold(service, context, registry);
    },
    refs: (node) => ref(node.service),
  });
  registry.registerEffect({
    kind: 'purchaseService',
    schema: z.strictObject({ service: serviceId }),
    apply: (node, host, defer) => {
      const service = catalogOf(host)?.get(node.service);
      if (service === undefined) return `no-such-service:${node.service}`;
      if (!serviceConditionsHold(service, host, registry)) return `service-locked:${service.id}`;
      const price = servicePrice(service, host);
      const refused = host.adjustGold(-price);
      if (refused !== undefined) return refused;
      for (const effect of service.effects) {
        const definition = registry.effect(effect.kind);
        if (definition === undefined) return `unknown-effect:${effect.kind}`;
        const failure = definition.apply(effect, host, defer);
        if (failure !== undefined) return failure;
      }
      defer(() => {
        host.emit(SERVICE_PURCHASED_EVENT, {
          service: service.id,
          npc: service.providerNpcId.id,
          price,
        });
      });
      return undefined;
    },
    refs: (node) => ref(node.service),
  });
}

/** Every problem with `service`'s logic: unknown kinds, bad fields, unresolved ids, nested purchases. */
export function validateServiceLogic(
  service: ServiceDef,
  registry: LogicRegistry,
  references?: LogicRefChecker,
): string[] {
  const problems: string[] = [];
  service.conditions.forEach((c, i) => {
    const r = validateLogicCondition(c, { registry, references });
    if (!r.ok)
      for (const p of r.issues) problems.push(`conditions[${String(i)}]${p.path}: ${p.message}`);
  });
  const e = validateLogicEffects(service.effects, { registry, references });
  if (!e.ok) for (const p of e.issues) problems.push(`effects${p.path}: ${p.message}`);
  service.effects.forEach((effect, i) => {
    if (SERVICE_FORBIDDEN_EFFECTS.includes(effect.kind)) {
      problems.push(`effects[${String(i)}]: a service cannot use ${effect.kind}`);
    }
  });
  return problems;
}
