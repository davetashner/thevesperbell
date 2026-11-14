// What the behaviour runtime hands inputs and primitives about one agent (mw-e11.2). One view per AI
// system is reused for every agent (no allocation per agent per tick); it is valid only during the
// call it is passed to.

import type { AttackLookup } from '../combat/attacks/executor';
import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import type { Creature } from '../creatures/components';
import type { Brain } from './components';
import type { MemoryTuning } from './memory';
import type { AiNavigation } from './navigation';

/** The collaborators primitives use (see `installAi`). */
export interface AiPorts {
  readonly navigation: AiNavigation;
  /** The attack table the `attack` primitive starts attacks from; absent = attacks always fail. */
  readonly attacks: AttackLookup | undefined;
  /** The hour of the day, 0–24, for routine windows (mw-e11.9); absent = windows are not read. */
  readonly hourOfDay: ((world: World<never>) => number | undefined) | undefined;
  /** How target memory decays and predicts (mw-e11.8). */
  readonly memory: MemoryTuning;
  /** How many creatures may attack one target at once (mw-e11.13). */
  readonly attackTokens: number;
}

/** One agent as inputs and primitives see it. */
export interface AgentView {
  world: World<never>;
  entity: EntityId;
  brain: Brain;
  /** Its creature state (patrol route, needs, tuning overrides), when it is a creature. */
  creature: Creature | undefined;
  /** The behaviour's default tuning. */
  tuning: Readonly<Record<string, number>>;
  tick: number;
  /** Ticks per second. */
  hz: number;
  ports: AiPorts;
}

/** A number read for one agent (a constant or a tuning key). */
export type Num = (view: AgentView) => number;
