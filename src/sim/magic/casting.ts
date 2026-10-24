// The cast phase (mw-e06.4): wind-up, channel and interruption, between a cast being asked for and
// the pipeline delivering it. State machine per caster (`magic.cast`, at most one):
//
//   idle → winding (castTime) → released (pipeline.cast) → idle
//                             ↘ channeling (tick every `interval`) → idle
//   winding | channeling → interrupted | cancelled → idle        (recovery is the spell's cooldown)
//
// A spell with castTime 0 and no channel casts at once, exactly as before. Otherwise `begin` checks
// the gates now (a refusal fizzles at once, nothing held), holds the spell's mana with `reserveMana`,
// and the `casting` system releases it `round(castTime × hz)` ticks later (AC-1: castTime 800 ms is
// tick +48 at 60 Hz, nothing earlier). At release the reservation is freed and `pipeline.cast` runs
// as usual, so the mana gate and the cooldown gate charge then, from the release tick.
//
// Channels. At channel start the gates are checked and charged once (`cost.mana`, cooldown) via
// `pipeline.check`/`spend`; then every `interval` the spell's delivery and effects run as a `free`
// pipeline cast (no second gate charge, a SpellCast with source "free" per tick) and the tick's mana
// (`manaPerSecond × interval`) is spent. A channel that cannot pay its next tick ends "out-of-mana"
// without ticking; it ends "duration" at `maxDuration` (a tick due on that very tick still fires),
// when the player cancels, or when interrupted. Its cooldown restarts when the channel ends.
//
// Interruption sources: a PoiseBroken on the caster (the damage model, e04.1), a `silenced`,
// `grappled` or `restrained` spell status (also refused at the gate when starting), the caster
// dying, and — unless the spell has `flags.castWhileMoving` — moving more than 0.5 m from where the
// cast began (a cancel, not an interrupt). Mana: a wind-up cancelled by the player or by moving is
// freed in full; a wind-up interrupted pays its reservation and gets `refundInterrupted` back (50 %
// by default), except one interrupted in its last 20 % (elapsed ≥ 0.8 × wind-up): that is miscast
// eligible, pays in full and emits `MiscastRequested{cause: "interrupted"}` instead of a clean
// SpellInterrupted-only fizzle, for the miscast system (mw-e06.13). Death frees the reservation.

import type { SpellEntry } from '@content/index';
import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import { Died, PoiseBroken } from '../combat/damage';
import type { System, World } from '../core/world';
import { hypot } from '../math';
import { placementOf } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { spellStatusesOf } from './components';
import { CooldownsComponent, cooldownGate, secondsToTicks, setCooldown } from './cooldown';
import { SpellFizzled } from './events';
import {
  availableMana,
  ManaComponent,
  manaOf,
  MiscastRequested,
  refundInterrupted,
  releaseMana,
  reserveMana,
  spendMana,
} from './mana';
import type { CastGate, CastResult, SpellPipeline } from './pipeline';
import type { CastRequest } from './registry';

/** Farthest a caster may move, metres, during a cast whose spell lacks `castWhileMoving`. */
export const CAST_MOVE_LIMIT = 0.5;
/** Share of the wind-up after which an interruption is miscast eligible. */
export const MISCAST_WINDOW = 0.8;

/** Reasons a gate refuses a cast for the caster's own state. */
export const ALREADY_CASTING = 'already-casting';
/** Spell statuses that stop casting (refused at the gate, and interrupt a running cast). */
export const CASTING_BLOCKERS = ['silenced', 'grappled', 'restrained'] as const;
export type CastingBlocker = (typeof CASTING_BLOCKERS)[number];

export type CastPhase = 'winding' | 'channeling';

/** The cast a caster is in the middle of (`magic.cast`). Absent when idle. */
export interface CastState {
  readonly caster: EntityId;
  readonly spell: string;
  readonly phase: CastPhase;
  readonly startedTick: number;
  /** Winding: the tick it releases. */
  readonly releaseTick: number;
  /** Mana held by the wind-up. */
  readonly reserved: number;
  /** Where the cast began, for the movement rule; null when the caster had no placement. */
  readonly origin: Vec3 | null;
  readonly target: EntityId | null;
  readonly aim: Vec3 | null;
  /** Channeling: next tick due, last tick it may still fire, and ticks fired so far. */
  readonly nextTickAt: number;
  readonly endTick: number;
  readonly ticks: number;
  /** Fixed at the start from the spell: movement is limited, channel timing and tick price, cooldown. */
  readonly anchored: boolean;
  /** Whether the spell channels; `channel` is all zeros when it does not. */
  readonly channelled: boolean;
  readonly channel: ChannelPlan;
  readonly cooldownTicks: number;
}

/** A channel's timing and price in whole ticks (fixed when the cast begins). */
export interface ChannelPlan {
  readonly interval: number;
  readonly duration: number;
  /** Mana one tick drains. */
  readonly tickCost: number;
}

/** Every running cast on one ledger entity (`magic.casts`), in the order the casts began. */
export interface CastLedger {
  readonly casts: readonly CastState[];
}
export const CastLedgerComponent = defineComponent<CastLedger>('magic.casts');

/** A cast entered its wind-up or channel (not emitted for instant spells). */
export interface CastStartedInfo {
  readonly tick: number;
  readonly caster: EntityId;
  readonly spell: string;
  readonly phase: CastPhase;
  /** Tick the wind-up releases (the start tick for a channel). */
  readonly releaseTick: number;
}
export const CastStarted = defineEvent<CastStartedInfo>('CastStarted');

export type InterruptReason = 'poise-broken' | CastingBlocker | 'died';

/** Something interrupted a cast; no delivery is spawned (a channel's earlier ticks stand). */
export interface SpellInterruptedInfo {
  readonly tick: number;
  readonly caster: EntityId;
  readonly spell: string;
  readonly reason: InterruptReason;
  readonly phase: CastPhase;
  /** Share of the wind-up elapsed, 0..1 (1 for a channel). */
  readonly progress: number;
  /** Miscast eligible: MiscastRequested was emitted too. */
  readonly miscast: boolean;
}
export const SpellInterrupted = defineEvent<SpellInterruptedInfo>('SpellInterrupted');

/** A wind-up was called off (by the player, or by moving): no miscast, mana freed in full. */
export interface CastCancelledInfo {
  readonly tick: number;
  readonly caster: EntityId;
  readonly spell: string;
  readonly reason: 'player' | 'moved';
}
export const CastCancelled = defineEvent<CastCancelledInfo>('CastCancelled');

/** One channel tick applied the spell's effects. */
export interface ChannelTickedInfo {
  readonly tick: number;
  readonly caster: EntityId;
  readonly spell: string;
  /** 1-based. */
  readonly index: number;
  /** Mana this tick drained. */
  readonly mana: number;
}
export const ChannelTicked = defineEvent<ChannelTickedInfo>('ChannelTicked');

export type ChannelEndReason =
  'duration' | 'cancelled' | 'moved' | 'out-of-mana' | 'fizzled' | 'interrupted';

/** A channel stopped. */
export interface ChannelEndedInfo {
  readonly tick: number;
  readonly caster: EntityId;
  readonly spell: string;
  readonly reason: ChannelEndReason;
  readonly ticks: number;
}
export const ChannelEnded = defineEvent<ChannelEndedInfo>('ChannelEnded');

/** The player's cancel input: calls off the caster's wind-up or ends its channel. */
export interface CancelCastCommand {
  readonly type: 'cancel-cast';
  readonly caster: EntityId;
}
export function isCancelCastCommand(input: unknown): input is CancelCastCommand {
  return (
    typeof input === 'object' &&
    input !== null &&
    (input as { type?: unknown }).type === 'cancel-cast'
  );
}

/** Outcome of asking to cast: started a wind-up/channel, or what the pipeline said. */
export type BeginResult = CastResult | { readonly status: 'started' };

/** Handle returned by `installCasting`. */
export interface CastController {
  /** Starts a cast of a learned spell (what the `cast` command does). */
  begin(request: CastRequest): BeginResult;
  /** Player cancel: frees a wind-up in full, or ends a channel. False when idle. */
  cancel(caster: EntityId): boolean;
  /** Interrupts a running cast for `reason`. False when idle. */
  interrupt(caster: EntityId, reason: InterruptReason): boolean;
}

function planChannel(world: World<never>, channel: SpellEntry['channel']): ChannelPlan {
  if (channel === undefined) return { interval: 0, duration: 0, tickCost: 0 };
  const interval = secondsToTicks(world, channel.interval);
  return {
    interval,
    duration: secondsToTicks(world, channel.maxDuration),
    tickCost: (channel.manaPerSecond * interval) / world.clock.hz,
  };
}

function castLedger(world: World<never>): readonly [EntityId, CastLedger] {
  const found: (readonly [EntityId, CastLedger])[] = [];
  world.query(CastLedgerComponent).forEach((id, ledger) => found.push([id, ledger]));
  const first = found[0];
  if (first === undefined) throw new Error('casting is not installed in this world');
  return first;
}

/** The cast state of `caster`, or undefined when idle. */
export function castStateOf(world: World<never>, caster: EntityId): CastState | undefined {
  return castLedger(world)[1].casts.find((c) => c.caster === caster);
}

/** Puts `state` in the ledger, replacing the caster's running cast (or adding it at the end). */
function putCast(world: World<never>, state: CastState): void {
  const [id, ledger] = castLedger(world);
  const exists = ledger.casts.some((c) => c.caster === state.caster);
  const casts = exists
    ? ledger.casts.map((c) => (c.caster === state.caster ? state : c))
    : [...ledger.casts, state];
  world.set(id, CastLedgerComponent, { casts: Object.freeze(casts) });
}

function dropCast(world: World<never>, caster: EntityId): void {
  const [id, ledger] = castLedger(world);
  world.set(id, CastLedgerComponent, { casts: ledger.casts.filter((c) => c.caster !== caster) });
}

function blockerOf(world: World<never>, caster: EntityId): CastingBlocker | undefined {
  const held = spellStatusesOf(world, caster);
  return CASTING_BLOCKERS.find((name) => held.some((s) => s.status === name));
}

/** The gate refusing a cast while the caster is already casting, silenced, grappled or restrained. */
export function castStateGate(): CastGate {
  return {
    name: 'cast-state',
    check: ({ world, request }) =>
      castStateOf(world, request.caster) !== undefined
        ? ALREADY_CASTING
        : blockerOf(world, request.caster),
  };
}

/**
 * Makes `world` run the cast phase: registers the cast-state and cooldown components, the cooldown
 * and cast-state gates, the `casting` system, the poise/death subscriptions, and routes the pipeline's
 * `cast` commands through `begin`. Also handles `cancel-cast` commands. Call once at setup after
 * `installSpells` (and `installMana`, which it works with but does not require), outside a step.
 */
export function installCasting<TInput>(
  world: World<TInput>,
  pipeline: SpellPipeline,
): CastController {
  const w: World<never> = world;
  if (!w.isRegistered(ManaComponent)) throw new Error('install mana before casting');
  w.register(CastLedgerComponent, CooldownsComponent);
  const book = w.spawn();
  w.add(book, CastLedgerComponent, { casts: [] });
  w.add(book, CooldownsComponent, { entries: [] });
  pipeline.addGate(cooldownGate()).addGate(castStateGate());

  const requestOf = (caster: EntityId, st: CastState, source?: 'free'): CastRequest => ({
    caster,
    spell: st.spell,
    ...(source === undefined ? {} : { source }),
    ...(st.target === null ? {} : { target: st.target }),
    ...(st.aim === null ? {} : { aim: st.aim }),
  });

  const endChannel = (caster: EntityId, st: CastState, reason: ChannelEndReason): void => {
    dropCast(w, caster);
    if (st.cooldownTicks > 0) setCooldown(w, caster, st.spell, w.tick + st.cooldownTicks);
    w.events.emit(ChannelEnded, {
      tick: w.tick,
      caster,
      spell: st.spell,
      reason,
      ticks: st.ticks,
    });
  };

  /** Checks and charges the gates, then enters the channel (the caster has no state). Refusal fizzles. */
  const startChannel = (caster: EntityId, st: CastState): boolean => {
    const request = requestOf(caster, st);
    const reason = pipeline.check(w, request);
    if (reason !== undefined) {
      w.events.emit(SpellFizzled, {
        tick: w.tick,
        caster,
        spell: st.spell,
        reason,
        stage: 'validate',
      });
      return false;
    }
    pipeline.spend(w, request);
    putCast(w, {
      ...st,
      phase: 'channeling',
      nextTickAt: w.tick + st.channel.interval,
      endTick: w.tick + st.channel.duration,
      ticks: 0,
      reserved: 0,
    });
    w.events.emit(CastStarted, {
      tick: w.tick,
      caster,
      spell: st.spell,
      phase: 'channeling',
      releaseTick: w.tick,
    });
    return true;
  };

  const release = (caster: EntityId, st: CastState): void => {
    if (st.reserved > 0) releaseMana(w, caster, st.reserved, false);
    dropCast(w, caster);
    if (!st.channelled) {
      pipeline.cast(w, requestOf(caster, st));
      return;
    }
    startChannel(caster, st);
  };

  const channelTick = (caster: EntityId, st: CastState): void => {
    const { channel } = st;
    const cost = channel.tickCost;
    if (cost > 0 && (manaOf(w, caster) === undefined || availableMana(w, caster) < cost)) {
      endChannel(caster, st, 'out-of-mana');
      return;
    }
    const result = pipeline.cast(w, requestOf(caster, st, 'free'));
    if (result.status === 'fizzled') {
      endChannel(caster, st, 'fizzled');
      return;
    }
    const drained = cost > 0 ? spendMana(w, caster, cost) : 0;
    const next: CastState = {
      ...st,
      ticks: st.ticks + 1,
      nextTickAt: st.nextTickAt + channel.interval,
    };
    putCast(w, next);
    w.events.emit(ChannelTicked, {
      tick: w.tick,
      caster,
      spell: st.spell,
      index: next.ticks,
      mana: drained,
    });
  };

  const interrupt = (caster: EntityId, reason: InterruptReason): boolean => {
    const st = castStateOf(w, caster);
    if (st === undefined) return false;
    const wind = Math.max(1, st.releaseTick - st.startedTick);
    const elapsed = w.tick - st.startedTick;
    const winding = st.phase === 'winding';
    const miscast = winding && reason !== 'died' && elapsed >= MISCAST_WINDOW * wind;
    w.events.emit(SpellInterrupted, {
      tick: w.tick,
      caster,
      spell: st.spell,
      reason,
      phase: st.phase,
      progress: winding ? Math.min(1, elapsed / wind) : 1,
      miscast,
    });
    if (!winding) {
      endChannel(caster, st, 'interrupted');
      return true;
    }
    dropCast(w, caster);
    if (st.reserved > 0) {
      const paid = releaseMana(w, caster, st.reserved, reason !== 'died');
      if (reason !== 'died' && !miscast) refundInterrupted(w, caster, paid);
    }
    if (miscast) {
      w.events.emit(MiscastRequested, {
        tick: w.tick,
        caster,
        spell: st.spell,
        deficit: 0,
        severity: Math.min(1, elapsed / wind),
        cause: 'interrupted',
      });
    }
    return true;
  };

  const cancel = (caster: EntityId, reason: 'player' | 'moved' = 'player'): boolean => {
    const st = castStateOf(w, caster);
    if (st === undefined) return false;
    if (st.phase === 'channeling') {
      endChannel(caster, st, reason === 'player' ? 'cancelled' : 'moved');
      return true;
    }
    dropCast(w, caster);
    if (st.reserved > 0) releaseMana(w, caster, st.reserved, false);
    w.events.emit(CastCancelled, { tick: w.tick, caster, spell: st.spell, reason });
    return true;
  };

  const begin = (request: CastRequest): BeginResult => {
    const fizzle = (reason: string): BeginResult => {
      w.events.emit(SpellFizzled, {
        tick: w.tick,
        caster: request.caster,
        spell: request.spell,
        reason,
        stage: 'validate',
      });
      return { status: 'fizzled', reason, stage: 'validate' };
    };
    const spell = pipeline.spells(request.spell);
    if (spell === undefined) return fizzle('unknown-spell');
    const reason = pipeline.check(w, request);
    if (reason !== undefined) return fizzle(reason);
    if (spell.castTime === 0 && spell.channel === undefined) return pipeline.cast(w, request);

    const at = placementOf(w, request.caster);
    const base: CastState = {
      caster: request.caster,
      spell: spell.id,
      phase: 'winding',
      startedTick: w.tick,
      releaseTick: w.tick + secondsToTicks(w, spell.castTime),
      reserved: 0,
      origin: at === undefined ? null : { x: at.x, y: at.y, z: at.z },
      target: request.target ?? null,
      aim: request.aim ?? null,
      nextTickAt: 0,
      endTick: 0,
      ticks: 0,
      anchored: !spell.flags.castWhileMoving,
      channelled: spell.channel !== undefined,
      channel: planChannel(w, spell.channel),
      cooldownTicks: secondsToTicks(w, spell.cooldown),
    };
    if (spell.castTime === 0) {
      // the gates were just checked, so a channel with no wind-up always starts
      startChannel(request.caster, base);
      return { status: 'started' };
    }
    const cost = spell.cost.mana;
    const reserved =
      cost > 0 && manaOf(w, request.caster) !== undefined
        ? Math.min(cost, availableMana(w, request.caster))
        : 0;
    if (reserved > 0) reserveMana(w, request.caster, reserved);
    putCast(w, { ...base, reserved });
    w.events.emit(CastStarted, {
      tick: w.tick,
      caster: request.caster,
      spell: spell.id,
      phase: 'winding',
      releaseTick: base.releaseTick,
    });
    return { status: 'started' };
  };

  pipeline.handleCommands((_world, request) => {
    begin(request);
  });
  w.events.on(PoiseBroken, ({ target }) => void interrupt(target, 'poise-broken'));
  w.events.on(Died, ({ target }) => void interrupt(target, 'died'));

  const system: System<TInput> = {
    name: 'casting',
    run: ({ inputs, tick }) => {
      for (const input of inputs) if (isCancelCastCommand(input)) cancel(input.caster);
      for (const st of castLedger(w)[1].casts) {
        const { caster } = st;
        const blocker = blockerOf(w, caster);
        if (blocker !== undefined) {
          interrupt(caster, blocker);
          continue;
        }
        if (st.anchored && st.origin !== null) {
          const now = placementOf(w, caster);
          if (
            now !== undefined &&
            hypot(now.x - st.origin.x, now.y - st.origin.y, now.z - st.origin.z) > CAST_MOVE_LIMIT
          ) {
            cancel(caster, 'moved');
            continue;
          }
        }
        if (st.phase === 'winding') {
          if (tick >= st.releaseTick) release(caster, st);
          continue;
        }
        if (tick >= st.nextTickAt && tick <= st.endTick) {
          channelTick(caster, st);
        }
        const after = castStateOf(w, caster);
        if (after !== undefined && tick >= after.endTick) endChannel(caster, after, 'duration');
      }
    },
  };
  world.addSystem(system);
  return { begin, cancel: (caster) => cancel(caster), interrupt };
}
