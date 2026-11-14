// Electrical conduction (mw-e03.8), as element rules over world properties.
//
// Charge is the entity's `charge` property: a charge stimulus raises it on what it hits (the stimulus
// API reaches anything that conducts), and nothing else stores charge. Each tick, when anything holds
// charge, the rules run in this order:
// - conduction.flood (exchange, after the water rules so wetness is current): charge flows over the
//   conduction graph (network.ts: conducting things that touch). Every entity that holds more charge
//   than its neighbours explain is a source; from each, a breadth-first flood in ascending entity id
//   order delivers `charge × falloffPerHop^hops` to what it reaches, within the SAME tick, and an
//   entity keeps the larger of what it held and what arrived. A flood visits at most `maxNodes`
//   entities; one that is cut short reports `conductionCapped` (and calls `warn`) and the rest of the
//   network stays neutral. Anything charged at `ignitionCharge` or more that can burn is heated to
//   its ignition point, so the fire rules light it.
// - conduction.shock (transition): every entity holding `shockCharge` or more, a liquid layer
//   excepted, gets a `shocked` event with the charge as intensity, each tick it does. What a shock
//   does to an actor (damage, stagger) belongs to the damage model; this only reports it.
// - conduction.receivers (transition): charge receivers (mechanisms) turn on and off.
// - conduction.discharge (settle): held charge halves every `halfLifeSeconds` and below `minCharge`
//   is gone, so a strike is a brief pulse that a sustained source keeps topped up.
// Needs installLiquids (the graph reads liquid volumes) and the world properties.
// A world with no charge costs one pass over the charge component, and the graph is not touched.

import type { EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';
import { shockIntensity } from '../elements/actors';
import type { ElementRule } from '../elements/rules';
import { LiquidLayerComponent } from '../liquids/components';
import {
  assignProperty,
  hasProperty,
  readProperty,
  setProperty,
  WorldProperties,
} from '../properties/components';
import { isFlammableNow } from '../properties/derived';
import { WORLD_PROPERTY_SPECS } from '../properties/spec';
import { stepChargeReceivers } from '../mechanisms/charge-receivers';
import { resolveConductionConfig, type ConductionConfig } from './config';
import { ConductionGraphCache, type ConductionGraph } from './network';

const known = <T>(value: T | undefined): T => value as T;

/** An entity holds enough charge to be shocked. */
export interface Shock {
  readonly tick: number;
  readonly entity: EntityId;
  /** The charge it holds. */
  readonly intensity: number;
  /**
   * Contacts between it and the charge's origin in this tick's flood (0 when it was struck directly,
   * or its charge is left from an earlier tick).
   */
  readonly hops: number;
  /** The entity the charge came from (itself when struck directly). */
  readonly origin: EntityId;
}

export const shocked = defineEvent<Shock>('shocked');

/** A flood hit the node cap, so part of the network stayed neutral. */
export interface ConductionCapped {
  readonly tick: number;
  readonly origin: EntityId;
  readonly maxNodes: number;
}

export const conductionCapped = defineEvent<ConductionCapped>('conductionCapped');

/** What `conductionRules` takes. */
export interface ConductionRulesOptions {
  readonly conduction?: Partial<ConductionConfig>;
  /** Called with a message when a flood is cut short at the node cap. */
  readonly warn?: (message: string) => void;
  /** The graph cache to use (default: a private one); tests read how often it rebuilt. */
  readonly cache?: ConductionGraphCache;
}

const CHARGE_MAX = WORLD_PROPERTY_SPECS.charge.max;
/** Charge within this fraction of what a neighbour passes on is explained by that neighbour. */
const EXPLAINED = 1 + 1e-9;

/** Per-tick flood results, kept for the shock rule (hops and origin). */
interface Flood {
  hops: Map<EntityId, { hops: number; origin: EntityId }>;
}

/** Entities holding charge, ascending id. */
function chargedEntities(world: World<never>): [EntityId, number][] {
  const found: [EntityId, number][] = [];
  world.query(WorldProperties.charge).forEach((entity, charge) => {
    if (charge > 0) found.push([entity, charge]);
  });
  return found;
}

/** Floods `graph` from every source and returns the charge each node should hold. */
function flood(
  world: World<never>,
  graph: ConductionGraph,
  config: ConductionConfig,
  result: Flood,
  warn: (message: string) => void,
): Float64Array {
  const { ids, neighbours } = graph;
  const held = new Float64Array(ids.length);
  ids.forEach((id, i) => {
    held[i] = readProperty(world, id, 'charge');
  });
  const sources: number[] = [];
  held.forEach((charge, i) => {
    if (!(charge >= config.minCharge)) return;
    let passed = 0;
    for (const n of known(neighbours[i])) passed = Math.max(passed, known(held[n]));
    if (charge > passed * config.falloffPerHop * EXPLAINED) sources.push(i);
  });
  sources.sort((a, b) => known(held[b]) - known(held[a]) || a - b);

  const best = Float64Array.from(held);
  for (const source of sources) {
    const origin = known(ids[source]);
    result.hops.set(origin, { hops: 0, origin });
    const queue: [number, number][] = [[source, 0]];
    let visited = 1;
    let capped = false;
    for (let head = 0; head < queue.length && !capped; head++) {
      const [at, hops] = known(queue[head]);
      const passed = known(best[at]) * config.falloffPerHop;
      if (passed < config.minCharge) continue;
      for (const next of known(neighbours[at])) {
        if (passed <= known(best[next])) continue;
        if (visited >= config.maxNodes) {
          capped = true;
          break;
        }
        visited += 1;
        best[next] = passed;
        result.hops.set(known(ids[next]), { hops: hops + 1, origin });
        queue.push([next, hops + 1]);
      }
    }
    if (capped) {
      world.events.emit(conductionCapped, {
        tick: world.tick,
        origin,
        maxNodes: config.maxNodes,
      });
      warn(
        `conduction flood from entity ${String(origin)} stopped at ${String(config.maxNodes)} nodes`,
      );
    }
  }
  return best;
}

function floodRule(
  config: ConductionConfig,
  cache: ConductionGraphCache,
  result: Flood,
  warn: (message: string) => void,
): ElementRule {
  return {
    id: 'conduction.flood',
    phase: 'exchange',
    run: ({ world }) => {
      result.hops.clear();
      if (chargedEntities(world).length === 0) return;
      const graph = cache.refresh(world, config.contactGap);
      const best = flood(world, graph, config, result, warn);
      graph.ids.forEach((id, i) => {
        const charge = Math.min(CHARGE_MAX, known(best[i]));
        if (charge > readProperty(world, id, 'charge')) assignProperty(world, id, 'charge', charge);
      });
      for (const [entity, charge] of chargedEntities(world)) {
        if (charge < config.ignitionCharge || !isFlammableNow(world, entity)) continue;
        if (!hasProperty(world, entity, 'temperature')) continue;
        const ignition = readProperty(world, entity, 'ignitionPoint');
        if (readProperty(world, entity, 'temperature') < ignition) {
          setProperty(world, entity, 'temperature', ignition);
        }
      }
    },
  };
}

function shockRule(config: ConductionConfig, result: Flood): ElementRule {
  return {
    id: 'conduction.shock',
    phase: 'transition',
    run: ({ world }) => {
      for (const [entity, charge] of chargedEntities(world)) {
        // A soaked actor takes the wet factor's share more (mw-e03.24).
        const intensity = shockIntensity(world, entity, charge, config.wetActorFactor);
        if (intensity < config.shockCharge || world.has(entity, LiquidLayerComponent)) continue;
        const reached = result.hops.get(entity);
        world.events.emit(shocked, {
          tick: world.tick,
          entity,
          intensity,
          hops: reached?.hops ?? 0,
          origin: reached?.origin ?? entity,
        });
      }
    },
  };
}

function receiversRule(): ElementRule {
  return {
    id: 'conduction.receivers',
    phase: 'transition',
    run: ({ world }) => {
      stepChargeReceivers(world);
    },
  };
}

function dischargeRule(config: ConductionConfig): ElementRule {
  return {
    id: 'conduction.discharge',
    phase: 'settle',
    run: ({ world, hz }) => {
      const keep = 0.5 ** (1 / (config.halfLifeSeconds * hz));
      for (const [entity, charge] of chargedEntities(world)) {
        const left = charge * keep;
        setProperty(world, entity, 'charge', left < config.minCharge ? 0 : left);
      }
    },
  };
}

/**
 * The conduction rules, in the order they run: flood (exchange), shock and receivers (transition),
 * discharge (settle). Add them after `liquidRules` to an ElementRuleSet so wetness is current. Throws a
 * RangeError for an invalid config.
 */
export function conductionRules(options: ConductionRulesOptions = {}): ElementRule[] {
  const config = resolveConductionConfig(options.conduction);
  const cache = options.cache ?? new ConductionGraphCache();
  const result: Flood = { hops: new Map() };
  const warn = options.warn ?? (() => undefined);
  return [
    floodRule(config, cache, result, warn),
    shockRule(config, result),
    receiversRule(),
    dischargeRule(config),
  ];
}
