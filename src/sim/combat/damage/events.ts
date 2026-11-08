// Events the damage model emits on the sim bus (mw-e04.1). Hit reactions (e04.7), the combat HUD
// (e04.10), impact audio/VFX (e28.4, e29.4), the death loop (e01.8) and AI (e11) all listen here
// instead of polling health, so one resolved hit reaches every consumer in the same tick. Per hit
// the order is DamageApplied, then PoiseBroken or Died (never both: a killing blow does not stagger).

import type { EntityId } from '../../core/component';
import { defineEvent } from '../../core/events';
import type { DamagePacket } from './packet';
import type { DamageAmounts } from './types';

/** One resolved hit on a living combatant. */
export interface DamageResult {
  readonly tick: number;
  readonly target: EntityId;
  /** The packet as its source built it (instigator, source, impulse, direction, region…). */
  readonly packet: DamagePacket;
  /**
   * Resolved damage per type after the whole pipeline: every type the packet carried (or a modifier
   * added), 0 included, in canonical type order.
   */
  readonly amounts: DamageAmounts;
  /** Sum of `amounts`; may exceed the health that was left (overkill). */
  readonly total: number;
  /** The packet dealt damage only in types the target is immune to (resistance 0): "no effect". */
  readonly immune: boolean;
  /** Poise damage after modifiers (hyperarmor, guards). */
  readonly poiseDamage: number;
  /** Stamina damage after modifiers (for the record; guard rules drain it). */
  readonly staminaDamage: number;
  /** Tags after modifiers (a rule may add e.g. `counter`); sorted, no duplicates. */
  readonly tags: readonly string[];
  readonly healthBefore: number;
  readonly healthAfter: number;
  /** This hit emptied the poise meter (PoiseBroken was emitted). */
  readonly poiseBroken: boolean;
  /** This hit killed the target (Died was emitted). */
  readonly died: boolean;
}

/** A hit resolved on a living combatant (also for 0 damage, so "no effect" can be shown). */
export const DamageApplied = defineEvent<DamageResult>('DamageApplied');

/** Payload of PoiseBroken. */
export interface PoiseBreak {
  readonly tick: number;
  readonly target: EntityId;
  readonly instigator: EntityId | null;
  readonly source: EntityId | null;
}

/** A hit emptied the target's poise (hit reactions turn this into a stagger). */
export const PoiseBroken = defineEvent<PoiseBreak>('PoiseBroken');

/** Payload of Died. */
export interface Death {
  readonly tick: number;
  readonly target: EntityId;
  /** The killing packet's instigator (credit, AI blame, the death screen). */
  readonly killer: EntityId | null;
  readonly source: EntityId | null;
  /** The killing hit's tags (e.g. `environment`, `backstab`). */
  readonly tags: readonly string[];
}

/** A combatant's health reached 0. Emitted exactly once per entity; later hits are ignored. */
export const Died = defineEvent<Death>('Died');

/** Payload of Deflected. */
export interface DeflectInfo {
  readonly tick: number;
  readonly target: EntityId;
  readonly instigator: EntityId | null;
  readonly source: EntityId | null;
  readonly region: string | undefined;
  /** The armour value that stopped the hit. */
  readonly armor: number;
  /** The penetration that was not enough. */
  readonly penetration: number;
}

/** An arrow ricocheted off armour (e05.6): the hit dealt 0 damage. Follows that hit's DamageApplied. */
export const Deflected = defineEvent<DeflectInfo>('Deflected');

/** How a landed hit reads on the hit marker. */
export type HitMarkerVariant = 'normal' | 'headshot' | 'weakpoint' | 'deflected';

/** Payload of HitMarker. */
export interface HitMarkerInfo {
  readonly tick: number;
  readonly target: EntityId;
  readonly instigator: EntityId | null;
  readonly variant: HitMarkerVariant;
}

/** A hit landed (immune targets excepted): what its marker should read (e05.6). Follows DamageApplied. */
export const HitMarker = defineEvent<HitMarkerInfo>('HitMarker');
