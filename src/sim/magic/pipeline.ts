// The spell pipeline (mw-e06.2): one path every spell takes, whatever its school.
//
//   request → validate → deliver → effects
//
// 1. Validate: the spell exists and the caster knows it (a `free` source — a scroll — skips this and
//    every gate), each registered CastGate passes (mana, cooldown… are gates: ADR-0007),
//    and the spell's delivery and every op have registered handlers. Any failure is a SpellFizzled
//    and nothing is spent.
// 2. Deliver: a delivery entity (`magic.delivery`) is created and its kind's handler says what it
//    reaches: hits now (self, touch, instant areas), a fizzle (no target, out of reach — still
//    nothing spent), or pending (in flight; the projectile/beam system calls `land` when it hits).
// 3. Effects: the gates spend their cost, SpellCast is emitted, then for every hit SpellHit and each
//    op in declared order, each op taking effect emitting one SpellEffectApplied.
//
// Everything is plain data on the event bus; render, audio and UI only subscribe. Spell effects
// reach the world through its shared vocabularies (damage model, stimulus API), never pairwise
// scripts, and handlers never see the spell's id. Ops run synchronously inside the tick of the cast
// (or of `land`), so a spell cast by a command lands in that tick.

import type { SpellEntry } from '@content/index';
import { DamageModel } from '../combat/damage';
import type { EntityId } from '../core/component';
import type { System, World } from '../core/world';
import { StimulusQueueComponent } from '../stimulus/stimulus';
import {
  MAGIC_COMPONENTS,
  knowsSpell,
  SpellDeliveryComponent,
  statusLedger,
  StatusLedgerComponent,
  type SpellDeliveryState,
} from './components';
import { builtInDeliveries } from './deliveries';
import {
  SpellCast,
  SpellEffectApplied,
  SpellFizzled,
  SpellHit,
  type CastSource,
  type FizzleStage,
} from './events';
import { builtInOps } from './ops';
import type { CastRequest, DeliveryHit, DeliveryRegistry, OpContext, OpRegistry } from './registry';

/** Spell id → loaded spell, or undefined. */
export type SpellLookup = (id: string) => SpellEntry | undefined;

/** What a gate sees. */
export interface GateContext {
  readonly world: World<never>;
  readonly request: CastRequest;
  readonly spell: SpellEntry;
}

/**
 * A condition every learned-spell cast must meet, and the price it charges. Mana (e06.3) and
 * cooldowns (e06.4) are gates. `check` returns a reason to refuse (becomes SpellFizzled's reason) or
 * undefined; `spend` runs once the delivery has started, only if every gate passed. Neither runs for
 * a `free` cast.
 */
export interface CastGate {
  /** Unique within a pipeline. */
  readonly name: string;
  check(ctx: GateContext): string | undefined;
  spend?(ctx: GateContext): void;
}

export interface SpellPipelineOptions {
  readonly spells: SpellLookup;
  /** Damage model damage ops go through; a fresh one by default. */
  readonly damage?: DamageModel;
  /** Op handlers; the built-in damage, stimulus and status by default. */
  readonly ops?: OpRegistry;
  /** Delivery handlers; the built-in self and touch by default. */
  readonly deliveries?: DeliveryRegistry;
}

/** Handles a `cast` input command (see `SpellPipeline.handleCommands`). */
export type CastCommandHandler = (world: World<never>, request: CastRequest) => void;

/** The outcome of a cast request. */
export type CastResult =
  | { readonly status: 'cast'; readonly delivery: EntityId }
  | { readonly status: 'fizzled'; readonly reason: string; readonly stage: FizzleStage };

export class SpellPipeline {
  readonly ops: OpRegistry;
  readonly deliveries: DeliveryRegistry;
  readonly damage: DamageModel;
  /** Looks a spell up by id (delivery systems read their delivery's section through it). */
  readonly spells: SpellLookup;
  private gates: readonly CastGate[] = [];
  private commandHandler: CastCommandHandler | undefined;

  constructor(options: SpellPipelineOptions) {
    this.spells = options.spells;
    this.damage = options.damage ?? new DamageModel();
    this.ops = options.ops ?? builtInOps();
    this.deliveries = options.deliveries ?? builtInDeliveries();
  }

  /** Adds a gate (checked and charged in registration order). Throws on a duplicate name. */
  addGate(gate: CastGate): this {
    if (this.gates.some((g) => g.name === gate.name)) {
      throw new RangeError(`cast gate "${gate.name}" is already registered`);
    }
    this.gates = [...this.gates, gate];
    return this;
  }

  /**
   * Routes `cast` input commands to `handler` instead of casting at once (the cast phase, e06.4,
   * starts a wind-up). Throws when a handler is already set.
   */
  handleCommands(handler: CastCommandHandler): this {
    if (this.commandHandler !== undefined) throw new Error('cast commands already have a handler');
    this.commandHandler = handler;
    return this;
  }

  /** Handles a `cast` command: the registered handler, or an immediate `cast`. */
  command(world: World<never>, request: CastRequest): void {
    if (this.commandHandler === undefined) this.cast(world, request);
    else this.commandHandler(world, request);
  }

  /**
   * Why a learned-spell cast would be refused right now (unknown spell, not learned, a gate), or
   * undefined. Changes nothing and emits nothing; the cast phase uses it to reject a wind-up early.
   */
  check(world: World<never>, request: CastRequest): string | undefined {
    const spell = this.spells(request.spell);
    if (spell === undefined) return 'unknown-spell';
    if (!world.isAlive(request.caster)) return 'unknown-caster';
    if (!knowsSpell(world, request.caster, request.spell)) return 'unknown-spell';
    for (const gate of this.gates) {
      const reason = gate.check({ world, request, spell });
      if (reason !== undefined) return reason;
    }
    return undefined;
  }

  /**
   * Charges every gate for `request` without delivering (a channel starting: its effects arrive tick
   * by tick). Call only after `check` passed. Throws for an unknown spell.
   */
  spend(world: World<never>, request: CastRequest): void {
    const spell = this.spells(request.spell);
    if (spell === undefined) throw new Error(`unknown spell "${request.spell}"`);
    for (const gate of this.gates) gate.spend?.({ world, request, spell });
  }

  /**
   * Runs a cast request through the pipeline now (see the file header). Safe to call from a system
   * or between ticks; events queue on the world's bus.
   */
  cast(world: World<never>, request: CastRequest): CastResult {
    const source: CastSource = request.source ?? 'known';
    const fizzle = (reason: string, stage: FizzleStage): CastResult => {
      world.events.emit(SpellFizzled, {
        tick: world.tick,
        caster: request.caster,
        spell: request.spell,
        reason,
        stage,
      });
      return { status: 'fizzled', reason, stage };
    };

    const spell = this.spells(request.spell);
    if (spell === undefined) return fizzle('unknown-spell', 'validate');
    if (!world.isAlive(request.caster)) return fizzle('unknown-caster', 'validate');
    if (source === 'known' && !knowsSpell(world, request.caster, request.spell)) {
      return fizzle('unknown-spell', 'validate');
    }
    const gateContext: GateContext = { world, request, spell };
    if (source === 'known') {
      for (const gate of this.gates) {
        const reason = gate.check(gateContext);
        if (reason !== undefined) return fizzle(reason, 'validate');
      }
    }
    const kind = spell.delivery.kind;
    if (!this.deliveries.has(kind)) return fizzle('unsupported-delivery', 'validate');
    if (!spell.effects.every((effect) => this.ops.has(effect.op))) {
      return fizzle('unsupported-op', 'validate');
    }

    const state: SpellDeliveryState = {
      spell: spell.id,
      caster: request.caster,
      kind,
      source,
      spawned: world.tick,
    };
    const entity = world.spawn();
    world.add(entity, SpellDeliveryComponent, state);
    const result = this.deliveries.require(kind)({
      world,
      request,
      spell,
      delivery: spell.delivery,
      entity,
    });
    if (result.kind === 'fizzle') {
      world.destroy(entity);
      return fizzle(result.reason, 'deliver');
    }
    if (source === 'known') for (const gate of this.gates) gate.spend?.(gateContext);
    world.events.emit(SpellCast, {
      tick: world.tick,
      caster: request.caster,
      spell: spell.id,
      source,
      delivery: entity,
      deliveryKind: kind,
    });
    if (result.kind === 'hits') {
      this.apply(world, state, entity, spell, result.hits);
      world.destroy(entity);
    }
    return { status: 'cast', delivery: entity };
  }

  /**
   * A pending delivery (a projectile that struck, a beam tick) reached `hits`: applies the spell's
   * effects there and ends the delivery. Throws for an entity that is not a live spell delivery.
   */
  land(world: World<never>, delivery: EntityId, hits: readonly DeliveryHit[]): void {
    const state = world.get(delivery, SpellDeliveryComponent);
    if (state === undefined) throw new Error(`entity ${String(delivery)} is not a spell delivery`);
    const spell = this.spells(state.spell);
    if (spell === undefined) throw new Error(`delivery ${String(delivery)} names an unknown spell`);
    this.apply(world, state, delivery, spell, hits);
    world.destroy(delivery);
  }

  /**
   * A pending delivery reached `hits` but carries on (a projectile piercing a creature, one that
   * expires): applies `effects` (default: the spell's own) there and leaves the delivery alive. Throws
   * for an entity that is not a live spell delivery.
   */
  strike(
    world: World<never>,
    delivery: EntityId,
    hits: readonly DeliveryHit[],
    effects?: SpellEntry['effects'],
  ): void {
    const state = world.get(delivery, SpellDeliveryComponent);
    if (state === undefined) throw new Error(`entity ${String(delivery)} is not a spell delivery`);
    const spell = this.spells(state.spell);
    if (spell === undefined) throw new Error(`delivery ${String(delivery)} names an unknown spell`);
    this.apply(world, state, delivery, spell, hits, effects ?? spell.effects);
  }

  /**
   * A pending delivery ended without landing (out of range, caster interrupted, quenched): removes
   * it and reports a SpellFizzled with `reason`.
   */
  cancel(world: World<never>, delivery: EntityId, reason = 'delivery-ended'): void {
    const state = world.get(delivery, SpellDeliveryComponent);
    if (state === undefined) throw new Error(`entity ${String(delivery)} is not a spell delivery`);
    world.events.emit(SpellFizzled, {
      tick: world.tick,
      caster: state.caster,
      spell: state.spell,
      reason,
      stage: 'deliver',
    });
    world.destroy(delivery);
  }

  private apply(
    world: World<never>,
    state: SpellDeliveryState,
    delivery: EntityId,
    spell: SpellEntry,
    hits: readonly DeliveryHit[],
    effects: SpellEntry['effects'] = spell.effects,
  ): void {
    const base = { tick: world.tick, caster: state.caster, spell: spell.id, delivery };
    for (const hit of hits) {
      world.events.emit(SpellHit, { ...base, target: hit.target, point: hit.point });
      const ctx: OpContext = {
        world,
        caster: state.caster,
        target: hit.target,
        point: hit.point,
        delivery,
        damage: this.damage,
      };
      effects.forEach((op, index) => {
        const detail = this.ops.require(op.op)(ctx, op);
        if (detail === undefined) return;
        world.events.emit(SpellEffectApplied, {
          ...base,
          target: hit.target,
          point: hit.point,
          op: op.op,
          index,
          detail,
        });
      });
    }
  }
}

/** The `cast` input command: a caster asks to cast a learned spell (never a free source). */
export interface CastCommand {
  readonly type: 'cast';
  readonly caster: EntityId;
  readonly spell: string;
  readonly target?: EntityId;
  readonly aim?: { readonly x: number; readonly y: number; readonly z: number };
}

/** Whether an input command is a cast command. */
export function isCastCommand(input: unknown): input is CastCommand {
  return (
    typeof input === 'object' && input !== null && (input as { type?: unknown }).type === 'cast'
  );
}

/**
 * Makes `world` run spells: registers the spell components, creates the status ledger, and adds the
 * system that expires statuses and processes `cast` commands each tick. Install stimuli first, and
 * add this before `stimulusSystem` so a spell's stimuli resolve in the tick it is cast. Call once at
 * setup, outside a step. Returns the pipeline for registering ops, deliveries and gates.
 */
export function installSpells<TInput>(
  world: World<TInput>,
  options: SpellPipelineOptions,
): SpellPipeline {
  const w: World<never> = world;
  if (!world.isRegistered(StimulusQueueComponent)) throw new Error('install stimuli before spells');
  world.register(...MAGIC_COMPONENTS);
  world.add(world.spawn(), StatusLedgerComponent, { entries: [] });
  const pipeline = new SpellPipeline(options);
  const system: System<TInput> = {
    name: 'spells',
    run: ({ inputs, tick }) => {
      const [id, ledger] = statusLedger(w);
      if (ledger.entries.some((entry) => entry.expiresTick <= tick)) {
        w.set(id, StatusLedgerComponent, {
          entries: ledger.entries.filter((entry) => entry.expiresTick > tick),
        });
      }
      for (const input of inputs) {
        if (!isCastCommand(input)) continue;
        pipeline.command(w, {
          caster: input.caster,
          spell: input.spell,
          ...(input.target === undefined ? {} : { target: input.target }),
          ...(input.aim === undefined ? {} : { aim: input.aim }),
        });
      }
    },
  };
  world.addSystem(system);
  return pipeline;
}
