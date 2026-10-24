// The spell pipeline's two extension points (mw-e06.2): effect ops and delivery kinds. Both are
// registries of pure handlers keyed by the names the spell schema already validates, so a new spell
// is a data file and a new capability is one registered handler. Registering a name twice throws:
// two beads quietly replacing each other's op would be a bug nobody could find.
//
// Handlers receive context, never identities: no spell id, so an op cannot special-case a spell, and
// targets arrive as entities the op reads through properties and components. A test greps this
// folder for literal spell ids to keep it that way.

import type { SpellEntry, SpellDeliveryKind, SpellEffectOpName } from '@content/index';
import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import type { DamageModel } from '../combat/damage';
import type { Vec3 } from '../stimulus/shapes';
import type { CastSource, OpDetail } from './events';

/** One effect op of a spell, narrowed to the op named `N`. */
export type OpOf<N extends SpellEffectOpName> = Extract<SpellEntry['effects'][number], { op: N }>;

/** What an op handler sees: the world and where and on whom the effect lands. */
export interface OpContext {
  readonly world: World<never>;
  /** Who cast the spell (the instigator for blame, credit and stimulus sources). */
  readonly caster: EntityId;
  /** The entity reached, or null when the delivery reached only a point. */
  readonly target: EntityId | null;
  /** Where it landed, metres. */
  readonly point: Vec3;
  /** The delivery entity carrying the spell (a damage packet's `source`). */
  readonly delivery: EntityId;
  readonly damage: DamageModel;
}

/**
 * Applies one op. Returns plain data describing what happened (it rides on SpellEffectApplied), or
 * undefined when the op had no effect on this hit (damage on something with no health), in which
 * case no SpellEffectApplied is emitted. Must be deterministic and read only the world.
 */
export type OpHandler<N extends SpellEffectOpName> = (
  ctx: OpContext,
  op: OpOf<N>,
) => OpDetail | undefined;

type ErasedOpHandler = (ctx: OpContext, op: SpellEntry['effects'][number]) => OpDetail | undefined;

const OP_NAMES: readonly string[] = [
  'damage',
  'stimulus',
  'force',
  'status',
  'summon',
  'transform',
  'displace',
  'spawnVolume',
  'light',
  'noise',
];

/** The registered effect op handlers. */
export class OpRegistry {
  private readonly handlers = new Map<string, ErasedOpHandler>();

  /**
   * Registers the handler for op `name`. Throws a RangeError for a name the spell schema does not
   * know, or one already registered (no silent override).
   */
  register<N extends SpellEffectOpName>(name: N, handler: OpHandler<N>): this {
    if (!OP_NAMES.includes(name)) throw new RangeError(`unknown spell effect op "${name}"`);
    if (this.handlers.has(name))
      throw new RangeError(`spell effect op "${name}" is already registered`);
    this.handlers.set(name, handler as ErasedOpHandler);
    return this;
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }

  /** The handler for `name`; throws when none is registered (callers check `has` first). */
  require(name: string): ErasedOpHandler {
    const handler = this.handlers.get(name);
    if (handler === undefined)
      throw new Error(`no handler registered for spell effect op "${name}"`);
    return handler;
  }

  /** Registered op names, sorted. */
  names(): readonly string[] {
    return [...this.handlers.keys()].sort();
  }
}

/** A cast request as the pipeline receives it (the `cast` command, a scroll, an AI). */
export interface CastRequest {
  readonly caster: EntityId;
  readonly spell: string;
  /** `known` (default) must be learned and pays costs; `free` is a scroll or item: neither. */
  readonly source?: CastSource;
  /** Chosen target, for deliveries that need one (touch). */
  readonly target?: EntityId;
  /** Aim point or direction origin for deliveries that need one (later beads). */
  readonly aim?: Vec3;
}

/** One delivery section of a spell, narrowed to the kind `K`. */
export type DeliveryOf<K extends SpellDeliveryKind> = Extract<SpellEntry['delivery'], { kind: K }>;

/** What a delivery handler sees. */
export interface DeliveryContext<K extends SpellDeliveryKind = SpellDeliveryKind> {
  readonly world: World<never>;
  readonly request: CastRequest;
  readonly spell: SpellEntry;
  /** The spell's delivery section, narrowed to this handler's kind. */
  readonly delivery: DeliveryOf<K>;
  /** The delivery entity created for this cast. */
  readonly entity: EntityId;
}

/** One place the delivery reached. */
export interface DeliveryHit {
  readonly target: EntityId | null;
  readonly point: Vec3;
}

/**
 * How a delivery started: it reached these hits right now (self, touch, instant areas); it cannot
 * (a fizzle, nothing spent); or it is in flight and a later system calls `SpellPipeline.land`
 * (projectiles, beams over time).
 */
export type DeliveryResult =
  | { readonly kind: 'hits'; readonly hits: readonly DeliveryHit[] }
  | { readonly kind: 'fizzle'; readonly reason: string }
  | { readonly kind: 'pending' };

export type DeliveryHandler<K extends SpellDeliveryKind = SpellDeliveryKind> = (
  ctx: DeliveryContext<K>,
) => DeliveryResult;

const DELIVERY_KINDS: readonly string[] = [
  'self',
  'touch',
  'projectile',
  'aoe',
  'beam',
  'summonPoint',
];

/** The registered delivery handlers, by delivery kind. */
export class DeliveryRegistry {
  private readonly handlers = new Map<string, DeliveryHandler>();

  /** Registers the handler for delivery `kind`; throws for an unknown or already registered kind. */
  register<K extends SpellDeliveryKind>(kind: K, handler: DeliveryHandler<K>): this {
    if (!DELIVERY_KINDS.includes(kind)) throw new RangeError(`unknown spell delivery "${kind}"`);
    if (this.handlers.has(kind)) {
      throw new RangeError(`spell delivery "${kind}" is already registered`);
    }
    this.handlers.set(kind, handler as unknown as DeliveryHandler);
    return this;
  }

  has(kind: string): boolean {
    return this.handlers.has(kind);
  }

  /** The handler for `kind`; throws when none is registered (callers check `has` first). */
  require(kind: string): DeliveryHandler {
    const handler = this.handlers.get(kind);
    if (handler === undefined)
      throw new Error(`no handler registered for spell delivery "${kind}"`);
    return handler;
  }
}
