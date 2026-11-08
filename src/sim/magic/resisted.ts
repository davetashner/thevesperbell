// ForceResisted: the event a force raises when it cannot move its target (a tether or remote hold met
// something heavier than its limit, a force op met something anchored). It lives apart from the tether
// so the tether and remote holds can both use it without importing each other. Re-exported by
// `tether.ts`, where it began.

import type { EntityId } from '../core/component';
import { defineEvent } from '../core/events';

export type ForceResistedReason = 'overweight' | 'anchored';

/** A force could not move its target: it met something heavier than its limit, or anchored. */
export interface ForceResistedInfo {
  readonly tick: number;
  readonly caster: EntityId;
  /** The spell id for a tether; null for a force op, which never sees one. */
  readonly spell: string | null;
  readonly target: EntityId;
  /** The target's weight and the heaviest the spell lifts, kg. */
  readonly weight: number;
  readonly limit: number;
  /** `overweight` above the limit; `anchored` for something that is neither liftable nor pushable. */
  readonly reason: ForceResistedReason;
}
export const ForceResisted = defineEvent<ForceResistedInfo>('ForceResisted');
