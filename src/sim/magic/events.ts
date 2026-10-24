// The events a spell cast emits (mw-e06.2). Render, audio, UI and the quest/stat layers subscribe to
// these; the sim never calls them. For one cast the order is always SpellCast, then for each reached
// target SpellHit followed by one SpellEffectApplied per op that took effect (in the spell's op
// order), all in the tick the effects land. A cast that cannot complete emits SpellFizzled instead.

import type { EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { Vec3 } from '../stimulus/shapes';

/** Where a cast came from: a learned spell (pays costs, obeys gates) or a free source (a scroll). */
export type CastSource = 'known' | 'free';

/** Plain data an op reports about what it did (damage dealt, status applied…); shown to cue sheets. */
export type OpDetail = Readonly<Record<string, string | number | boolean | null>>;

/** A cast passed validation and its delivery started. */
export interface SpellCastInfo {
  readonly tick: number;
  readonly caster: EntityId;
  readonly spell: string;
  readonly source: CastSource;
  /** The delivery entity (`magic.delivery`) carrying the spell to its targets. */
  readonly delivery: EntityId;
  readonly deliveryKind: string;
}
export const SpellCast = defineEvent<SpellCastInfo>('SpellCast');

/** A delivery reached something (or a point): the effect ops are about to apply there. */
export interface SpellHitInfo {
  readonly tick: number;
  readonly caster: EntityId;
  readonly spell: string;
  readonly delivery: EntityId;
  /** The entity reached, or null for a bare point (a volume or summon site). */
  readonly target: EntityId | null;
  readonly point: Vec3;
}
export const SpellHit = defineEvent<SpellHitInfo>('SpellHit');

/** One effect op took effect on one hit. */
export interface SpellEffectAppliedInfo {
  readonly tick: number;
  readonly caster: EntityId;
  readonly spell: string;
  readonly delivery: EntityId;
  readonly target: EntityId | null;
  readonly point: Vec3;
  /** Op name (`damage`, `stimulus`, `status`…). */
  readonly op: string;
  /** Index of the op in the spell's `effects`. */
  readonly index: number;
  readonly detail: OpDetail;
}
export const SpellEffectApplied = defineEvent<SpellEffectAppliedInfo>('SpellEffectApplied');

/** Where a cast stopped: before anything was spent, or while the delivery was starting. */
export type FizzleStage = 'validate' | 'deliver';

/** A cast did not happen. Nothing was spent. */
export interface SpellFizzledInfo {
  readonly tick: number;
  readonly caster: EntityId;
  readonly spell: string;
  /** Why: `unknown-spell`, `unknown-caster`, `unsupported-delivery`, `unsupported-op`, `no-target`, `out-of-reach`, `no-position`, or a gate's reason (`insufficient-mana`…). */
  readonly reason: string;
  readonly stage: FizzleStage;
}
export const SpellFizzled = defineEvent<SpellFizzledInfo>('SpellFizzled');

/** A flame spell was put out by water: the cue is a hiss and a puff of steam. */
export interface SpellQuenchedInfo {
  readonly tick: number;
  readonly caster: EntityId;
  readonly spell: string;
  /** The delivery entity (destroyed by the time listeners run for a launch-time quench). */
  readonly delivery: EntityId;
  /** Where it went out, metres. */
  readonly point: Vec3;
  /** What put it out; `water` today. */
  readonly medium: 'water';
  /** The presentation cue this event stands for (render/audio bind to it). */
  readonly cue: 'steam';
  /** `launch`: cast while submerged; `flight`: flew into water. */
  readonly stage: 'launch' | 'flight';
}
export const SpellQuenched = defineEvent<SpellQuenchedInfo>('SpellQuenched');

/** Anywhere a spell effect has landed in the world: the one cue render/audio bind to is these events. */
export const SPELL_EVENTS = [
  SpellCast,
  SpellHit,
  SpellEffectApplied,
  SpellFizzled,
  SpellQuenched,
] as const;
