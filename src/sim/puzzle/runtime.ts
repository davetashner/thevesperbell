// The puzzle runtime (mw-e15.3): puzzles are data (src/content/data/puzzle), and this is the one
// piece of code that runs all of them. Each puzzle is a `PuzzleDef`; the runtime watches its goal
// (the live conditions of mw-e15.2) and walks it through dormant → discovered → in-progress →
// solved (or failed when a critical entity is lost), firing its outputs when the goal comes true.
//
// - Discovery: entering the discovery volume (world coordinates) or using the trigger entity
//   discovers a dormant puzzle; so does the first thing the player does to it (a property its goal
//   reads changes on a listed entity, a listed entity is used, a capability is used on it). A puzzle
//   with no discovery rule is found that way alone. Any state but solved becomes solved when the
//   goal is true, however it got there.
// - Outputs, fired once when the puzzle is solved: its solved fact and the other facts it sets (one
//   transaction), the lever or button signals it drives, and its reward hooks (`puzzleRewarded`,
//   only the first time). A solved one-shot puzzle stays solved and never fires again, whatever the
//   goal does afterwards. A repeatable one reopens when its goal fails (levers it drove go back).
// - Attribution: capabilities used while the puzzle was open (`capabilityUsed`, bridged from spell
//   casts) are its trail. The solution whose capabilities are all in the trail, the most demanding
//   first, is credited; none fitting is `undeclared`, which also emits `puzzleSolvedUndeclared`.
//   A solution that needs no capability fits any trail, so a puzzle with an "anyone can" route is
//   never undeclared: capabilities alone cannot tell a torch from a stranger's cleverness.
// - Persistence: a puzzle's state, attribution, trail, lost entities and half-finished `sustained`
//   holds are a `puzzle.state` component on a puzzle entity, so saves, snapshots and the state hash
//   carry them. The component is registered, and the entity made, only when a puzzle first leaves
//   dormant: worlds with no puzzle in play hash exactly as they did before this existed. After a
//   `World.restore` the runtime reloads its view (it notices by `World.restores`), resumes the holds
//   and re-reads the goals; a solved puzzle stays solved without firing anything.
//
// - Recovery (mw-e15.7): `recovery` policies bring a puzzle back from a loss, in the world, never by
//   rolling a save back. `respawn`: a critical entity that is lost (destroyed) or spent (burnt out)
//   is replaced at its source after N seconds through the host (the scene loader), never overlapping
//   another physics object: while the spot is taken it retries every `RETRY_SECONDS`. `reset`: using
//   the trigger entity (a lever) returns the listed doors and switches to their authored state and
//   counts a reset in a fact; a solved puzzle ignores it. Every critical entity that is a physics
//   object and falls below the kill plane is put back at its spawn within the tick (recovery.ts).
//   Each recovery says so with `puzzleRecovered`. Pending respawns are part of the saved record
//   (`recovering`, present only while one is pending), so a save in the middle of one finishes it.
//
// Everything here is deterministic: events, ids and sim ticks only.

import { defineComponent, type EntityId } from '../core/component';
import { fireBurntOut } from '../elements/fire';
import { hasCapability } from '../progression/capabilities';
import { PhysicsObjectComponent } from '../physics/objects';
import { SceneTransformComponent } from '../scene/loader';
import type { Vec3 } from '../stimulus/shapes';
import type { System, World } from '../core/world';
import type { Condition } from '../facts/conditions';
import { worldLiveReader } from '../facts/live';
import { interacted } from '../interaction/system';
import { SpellCast } from '../magic/events';
import { propertyChanged } from '../properties/components';
import { SceneSpawnComponent } from '../scene/loader';
import { DoorComponent, LockComponent, SwitchComponent } from '../mechanisms/components';
import { SignalGraphComponent, pressButton, setLever, signalGraphOf } from '../signals/runtime';
import type { VolumeShape } from '../signals/graph';
import { GoalRuntime } from './goals';
import {
  footprintClear,
  markPuzzleCritical,
  PuzzleCriticalComponent,
  resetMechanisms,
  returnLost,
  type MechanismDefault,
} from './recovery';
import {
  capabilityUsed,
  CLUE_PREFIX,
  clueCapability,
  clueRead,
  puzzleDiscovered,
  puzzleFailed,
  puzzleHint,
  puzzleRecovered,
  puzzleRewarded,
  puzzleSolved,
  puzzleSolvedUndeclared,
  puzzleStateChanged,
  puzzleUnsolved,
  UNDECLARED,
  type PuzzleState,
} from './events';

/** A declared way to solve a puzzle: the capabilities it needs, all of them (none: anyone). */
export interface PuzzleSolutionDef {
  readonly id: string;
  readonly capabilities: readonly string[];
}

/** What a puzzle writes when solved. */
export interface PuzzleOutputsDef {
  /** Bool fact set true when solved (and false again when a repeatable puzzle reopens). */
  readonly solvedFact: string;
  /** Further facts set when solved. */
  readonly set: readonly { readonly fact: string; readonly value: boolean | number | string }[];
  /** `<graph>/<node>` lever (switched on) or button (pressed) nodes it drives. */
  readonly signals: readonly string[];
  /** Reward hook ids, announced by `puzzleRewarded` the first time it is solved. */
  readonly rewards: readonly string[];
}

/** A door or switch of a reset policy, as its scene authored it. */
export interface ResetMechanismDef {
  /** The scene spawn id of the door or switch. */
  readonly spawn: string;
  readonly door?: { readonly open: boolean; readonly jammed: boolean; readonly locked?: boolean };
  readonly switch?: { readonly position: number };
}

/** How a puzzle recovers (the content's `policy.recovery`). */
export type RecoveryDef =
  | {
      readonly kind: 'respawn';
      /** The critical entity (a spawn id) that is replaced. */
      readonly entity: string;
      readonly seconds: number;
    }
  | {
      readonly kind: 'reset';
      /** The spawn id of the lever (or anything else that is interacted with) that resets. */
      readonly trigger: string;
      /** A declared int fact counted up by each reset. */
      readonly fact?: string | undefined;
      /** What goes back to its authored state. */
      readonly mechanisms: readonly ResetMechanismDef[];
    };

/** What the runtime asks of the world's owner to replace a lost entity (the scene loader). */
export interface PuzzleHost {
  /** The centre and half extents (metres) of what a fresh copy of `spawn` occupies; undefined: nothing to collide. */
  footprint(spawn: string): { readonly centre: Vec3; readonly halfExtents: Vec3 } | undefined;
  /** Brings a fresh copy of `spawn` into the world (its source, as authored). */
  spawn(spawn: string): void;
  /** Takes a spent copy of `spawn` out of the world, if it is there. */
  remove(spawn: string): void;
}

/** Seconds a respawn that finds its spot taken waits before it tries again. */
export const RETRY_SECONDS = 2;

/** One tier of a puzzle's hint ladder (mw-e15.11). */
export interface HintTierDef {
  /** Seconds since the puzzle was found; scaled by the `puzzleHints` difficulty multiplier (higher: sooner). */
  readonly afterSeconds: number;
  /** Failed attempts that fire the tier sooner. */
  readonly afterAttempts?: number | undefined;
  readonly bark?: string | undefined;
  /** Class-aware text: the first whose capability the player has replaces `bark`. */
  readonly variants: readonly { readonly capability: string; readonly bark: string }[];
  /** Scene spawn ids to pulse. */
  readonly highlight: readonly string[];
  /** A declared bool fact set true when the tier fires (the NPC rumour it unlocks). */
  readonly rumour?: string | undefined;
}

/** A signal output whose rising edge is a failed attempt (the sequence node's `failed` port). */
export interface FailureSignalDef {
  readonly signal: string;
  readonly port?: string | undefined;
}

/** A puzzle as the runtime runs it (the content layer builds these from puzzle files). */
export interface PuzzleDef {
  readonly id: string;
  readonly goal: Condition;
  /** Solved puzzles reopen when the goal fails (default: stay solved). */
  readonly repeatable?: boolean;
  /** The scene spawns the puzzle is about; `critical` ones failing to exist fail the puzzle. */
  readonly entities: readonly { readonly id: string; readonly critical: boolean }[];
  readonly solutions: readonly PuzzleSolutionDef[];
  /** Where or how it is found: standing in a volume (world coordinates) or using a spawn. */
  readonly discovery?:
    | {
        readonly volume?: VolumeShape | undefined;
        readonly interact?: string | undefined;
      }
    | undefined;
  readonly outputs: PuzzleOutputsDef;
  /** Diegetic recovery from lost objects and stuck mechanisms (mw-e15.7). */
  readonly recovery?: readonly RecoveryDef[] | undefined;
  /** The hint ladder, in order (mw-e15.11). */
  readonly hints?: readonly HintTierDef[] | undefined;
  /** Signal outputs whose pulses count as failed attempts, for tiers that fire after attempts. */
  readonly failures?: readonly FailureSignalDef[] | undefined;
}

/** A respawn waiting for its time (saved, so a load in the middle of one finishes it). */
export interface PendingRespawn {
  readonly spawn: string;
  /** The tick it is tried at. */
  readonly due: number;
  /** The old copy is still in the world (it burnt out): take it away first. */
  readonly spent: boolean;
}

/** One capability use on a puzzle's trail. */
export interface TrailEntry {
  readonly capability: string;
  readonly tick: number;
}

/** A puzzle's saved state (`puzzle.state`; a snapshot and save key, never renamed). */
export interface PuzzleRecord {
  readonly id: string;
  readonly state: PuzzleState;
  /** The declared solution id credited, `undeclared`, or null while unsolved. */
  readonly attribution: string | null;
  /** Capabilities used while open, oldest first (at most `TRAIL_LIMIT`). */
  readonly trail: readonly TrailEntry[];
  /** Whether the reward hooks have fired (they fire once, even for a repeatable puzzle). */
  readonly rewarded: boolean;
  /** Critical spawn ids seen to be lost. */
  readonly lost: readonly string[];
  readonly discoveredAt: number | null;
  readonly solvedAt: number | null;
  /** Start ticks of the goal's `sustained` holds (null: not holding), see `ConditionSubscription.holds`. */
  readonly holds: readonly (number | null)[];
  /** Respawns waiting for their time; absent when none is (records of puzzles at rest are unchanged). */
  readonly recovering?: readonly PendingRespawn[];
  /** Hint ladder progress; absent until an attempt fails or a tier fires (records of puzzles at rest are unchanged). */
  readonly hints?: { readonly fired: number; readonly attempts: number };
}

export const PuzzleStateComponent = defineComponent<PuzzleRecord>('puzzle.state');

/** The longest trail kept; older uses fall off. */
export const TRAIL_LIMIT = 32;

/** Capability uses this long before a dormant puzzle was first touched still count towards it, seconds. */
export const ENGAGE_WINDOW_SECONDS = 10;

/** A value known to be present by construction. */
const known = <T>(value: T | undefined): T => value as T;

const fresh = (id: string): PuzzleRecord => ({
  id,
  state: 'dormant',
  attribution: null,
  trail: [],
  rewarded: false,
  lost: [],
  discoveredAt: null,
  solvedAt: null,
  holds: [],
});

/**
 * Which declared solution a trail credits: among those whose capabilities are all in `used`, the one
 * needing the most (the first declared on a tie); `UNDECLARED` when none fits.
 */
export function attribute(
  solutions: readonly PuzzleSolutionDef[],
  used: ReadonlySet<string>,
): string {
  let best: PuzzleSolutionDef | undefined;
  for (const solution of solutions) {
    if (!solution.capabilities.every((capability) => used.has(capability))) continue;
    if (best === undefined || solution.capabilities.length > best.capabilities.length) {
      best = solution;
    }
  }
  return best?.id ?? UNDECLARED;
}

/** What a puzzle publishes to debug tools and the e2e. */
export interface PuzzleStatus {
  readonly id: string;
  readonly state: PuzzleState;
  readonly attribution: string | null;
  readonly trail: readonly string[];
  /** Whether the goal holds now. */
  readonly met: boolean;
  /** Spawn id → entity for the listed entities that exist. */
  readonly entities: Readonly<Record<string, EntityId>>;
}

export interface PuzzleRuntimeOptions {
  /** The player: discovery volumes look for it, and only its capability uses count. */
  readonly player?: EntityId | undefined;
  /** Replaces lost critical entities (respawn policies); absent: they are not replaced. */
  readonly host?: PuzzleHost | undefined;
  /**
   * The height under which a critical physics object is lost, metres (a function: read each tick).
   * Absent: critical entities are not watched for falling out of the level.
   */
  readonly killY?: number | (() => number) | undefined;
}

const IN_PLAY: readonly PuzzleState[] = ['dormant', 'discovered', 'in-progress', 'failed'];

/** Runs the puzzles of one world. Create it between steps, after the scene and mechanisms exist. */
export class PuzzleRuntime {
  readonly #world: World<never>;
  readonly #player: EntityId | undefined;
  readonly #host: PuzzleHost | undefined;
  readonly #killY: (() => number) | undefined;
  readonly #defs = new Map<string, PuzzleDef>();
  readonly #goals: GoalRuntime;
  readonly #records = new Map<string, PuzzleRecord>();
  /** Puzzle id → entity holding its record; absent until the puzzle first leaves dormant. */
  readonly #entities = new Map<string, EntityId>();
  readonly #dirty = new Set<string>();
  /** Spawn id → entity, for the spawns that exist now. */
  #bound = new Map<string, EntityId>();
  /** Critical spawn ids (by puzzle) that have been seen to exist. */
  readonly #seen = new Map<string, Set<string>>();
  readonly #watched = new Set<EntityId>();
  readonly #goalProperties = new Map<string, ReadonlySet<string>>();
  readonly #offs: (() => void)[] = [];
  /** Puzzle id → whether each failure signal was on at the last look (a rising edge is an attempt). */
  readonly #failing = new Map<string, boolean[]>();
  #structure = -1;
  #restores: number;

  constructor(world: World<never>, defs: readonly PuzzleDef[], options: PuzzleRuntimeOptions = {}) {
    this.#world = world;
    this.#player = options.player;
    this.#host = options.host;
    const { killY } = options;
    this.#killY = typeof killY === 'number' ? () => killY : killY;
    this.#restores = world.restores;
    this.#goals = new GoalRuntime(world);
    for (const def of defs) {
      if (this.#defs.has(def.id)) throw new Error(`puzzle "${def.id}" is defined twice`);
      this.#defs.set(def.id, def);
      this.#records.set(def.id, fresh(def.id));
      this.#goals.add(def.id, def.goal, (met) => {
        this.#onGoal(def.id, met);
      });
      this.#goalProperties.set(def.id, new Set(this.#goals.compiled(def.id).live.properties));
      this.#seen.set(def.id, new Set());
    }
    this.#offs.push(
      world.events.on(propertyChanged, ({ entity, key }) => {
        if (!this.#watched.has(entity)) return;
        for (const [id, def] of this.#defs) {
          if (this.#goalProperties.get(id)?.has(key) === true && this.#lists(def, entity)) {
            this.#engage(id);
          }
        }
      }),
      world.events.on(fireBurntOut, ({ entity }) => {
        this.#spent(entity);
      }),
      world.events.on(interacted, ({ target }) => {
        const spawn = this.#spawnId(target);
        if (spawn === undefined) return;
        for (const [id, def] of this.#defs) {
          for (const policy of this.#policies(id)) {
            if (policy.kind === 'reset' && policy.trigger === spawn) this.#reset(id, policy);
          }
          if (def.discovery?.interact === spawn && this.#state(id) === 'dormant') {
            this.#transition(id, 'discovered');
          }
          if (def.entities.some((entity) => entity.id === spawn)) this.#engage(id);
        }
      }),
      world.events.on(SpellCast, ({ caster, spell }) => {
        world.events.emit(capabilityUsed, {
          actor: caster,
          capability: `spell.${spell}`,
          tick: world.tick,
        });
      }),
      world.events.on(clueRead, ({ actor, item, puzzle, tick }) => {
        if (this.#player !== undefined && actor !== this.#player) return;
        this.#trailOf(puzzle, clueCapability(item), tick);
      }),
      world.events.on(capabilityUsed, (use) => {
        if (this.#player !== undefined && use.actor !== this.#player) return;
        this.#trail(use.capability, use.tick, use.target);
      }),
    );
    this.#sync();
    this.#readFailures();
    for (const id of this.#defs.keys()) {
      if (this.#goals.met(id)) this.#onGoal(id, true);
    }
    this.#flush();
  }

  /** The ids of the puzzles, in the order given. */
  get ids(): readonly string[] {
    return [...this.#defs.keys()];
  }

  /** Puzzle `id`'s lifecycle state. */
  state(id: string): PuzzleState {
    this.#reload();
    return this.#state(id);
  }

  /** Puzzle `id`'s record (a copy). */
  record(id: string): PuzzleRecord {
    this.#reload();
    return structuredClone(this.#record(id));
  }

  /** Puzzle `id`'s goal, sub-condition by sub-condition (see `GoalRuntime.explain`). */
  explain(id: string): string {
    this.#record(id);
    return this.#goals.explain(id);
  }

  /** What every puzzle is doing, in the order given. */
  status(): readonly PuzzleStatus[] {
    this.#reload();
    return [...this.#defs.keys()].map((id) => {
      const record = this.#record(id);
      const def = known(this.#defs.get(id));
      const entities: Record<string, EntityId> = {};
      for (const { id: spawn } of def.entities) {
        const entity = this.#bound.get(spawn);
        if (entity !== undefined) entities[spawn] = entity;
      }
      return {
        id,
        state: record.state,
        attribution: record.attribution,
        trail: [...new Set(record.trail.map((use) => use.capability))],
        met: this.#goals.met(id),
        entities,
      };
    });
  }

  /** One tick, after the systems that move things: discovery, goals, then what must be saved. */
  poll(): void {
    this.#reload();
    this.#scan();
    this.#recover();
    this.#look();
    this.#goals.poll();
    this.#holds();
    this.#hints();
    this.#flush();
  }

  /** Stops watching everything. The puzzle entities stay in the world. */
  dispose(): void {
    for (const off of this.#offs) off();
    this.#offs.length = 0;
    this.#goals.dispose();
  }

  // --- state ---------------------------------------------------------------------------------

  #record(id: string): PuzzleRecord {
    const record = this.#records.get(id);
    if (record === undefined) throw new Error(`puzzle "${id}" is not defined`);
    return record;
  }

  #state(id: string): PuzzleState {
    return this.#record(id).state;
  }

  #update(id: string, change: Partial<PuzzleRecord>): void {
    this.#records.set(id, { ...this.#record(id), ...change });
    this.#dirty.add(id);
  }

  #transition(id: string, to: PuzzleState): void {
    const from = this.#state(id);
    const tick = this.#world.tick;
    if (to === 'discovered' || (from === 'dormant' && to === 'in-progress')) {
      // The first touch: what was done a moment ago counts, what was done long before does not
      // (a clue read at any time before does: the book was read, however long ago).
      const since = tick - ENGAGE_WINDOW_SECONDS * this.#world.clock.hz;
      this.#update(id, {
        discoveredAt: tick,
        trail: this.#record(id).trail.filter(
          (use) => use.tick >= since || use.capability.startsWith(CLUE_PREFIX),
        ),
      });
    }
    this.#update(id, { state: to });
    if (from === 'dormant') this.#mark(known(this.#defs.get(id)));
    this.#world.events.emit(puzzleStateChanged, { puzzle: id, from, to, tick });
    if (from === 'dormant' && (to === 'discovered' || to === 'in-progress')) {
      this.#world.events.emit(puzzleDiscovered, { puzzle: id, tick });
    }
  }

  /** The player did something to the puzzle: found it if need be, and it is under way. */
  #engage(id: string): void {
    const state = this.#state(id);
    if (state === 'dormant' || state === 'discovered') {
      this.#transition(id, 'in-progress');
      this.#checkLost(id);
    }
  }

  // --- goals ---------------------------------------------------------------------------------

  #onGoal(id: string, met: boolean): void {
    const state = this.#state(id);
    if (met && state !== 'solved') this.#solve(id);
    else if (!met && state === 'solved' && this.#defs.get(id)?.repeatable === true) {
      this.#reopen(id);
    }
  }

  #solve(id: string): void {
    const def = known(this.#defs.get(id));
    const record = this.#record(id);
    const tick = this.#world.tick;
    const trail = [...new Set(record.trail.map((use) => use.capability))];
    const attribution = attribute(def.solutions, new Set(trail));
    const first = !record.rewarded;
    this.#transition(id, 'solved');
    this.#update(id, { attribution, solvedAt: tick, rewarded: true, holds: [] });
    const { outputs } = def;
    this.#world.facts.transaction(() => {
      this.#world.facts.set(outputs.solvedFact, true);
      for (const { fact, value } of outputs.set) this.#world.facts.set(fact, value);
    });
    for (const signal of outputs.signals) this.#drive(signal, true);
    const events = this.#world.events;
    events.emit(puzzleSolved, { puzzle: id, tick, attribution, trail });
    if (attribution === UNDECLARED) {
      events.emit(puzzleSolvedUndeclared, { puzzle: id, tick, attribution, trail });
    }
    if (first) {
      for (const reward of outputs.rewards)
        events.emit(puzzleRewarded, { puzzle: id, reward, tick });
    }
  }

  #reopen(id: string): void {
    const def = known(this.#defs.get(id));
    this.#transition(id, 'in-progress');
    this.#update(id, {
      attribution: null,
      solvedAt: null,
      trail: [],
      discoveredAt: this.#world.tick,
    });
    this.#setHints(id, undefined);
    this.#world.facts.set(def.outputs.solvedFact, false);
    for (const signal of def.outputs.signals) this.#drive(signal, false);
    this.#world.events.emit(puzzleUnsolved, { puzzle: id, tick: this.#world.tick });
  }

  /** Switches a lever on or off, or presses a button (`on` only); anything else is left alone. */
  #drive(signal: string, on: boolean): void {
    const [graph = '', node = ''] = signal.split('/');
    if (!this.#world.isRegistered(SignalGraphComponent)) return;
    let found: EntityId | undefined;
    this.#world.query(SignalGraphComponent).forEach((entity, instance) => {
      if (found === undefined && instance.graph.id === graph) found = entity;
    });
    if (found === undefined) return;
    const kind = signalGraphOf(this.#world, found).graph.nodes.find((n) => n.id === node)?.kind;
    if (kind === 'lever') setLever(this.#world, found, node, on);
    else if (kind === 'button' && on) pressButton(this.#world, found, node);
  }

  // --- trail, discovery, entities ----------------------------------------------------------------

  #trail(capability: string, tick: number, target: EntityId | undefined): void {
    for (const [id, def] of this.#defs) {
      if (!this.#trailOf(id, capability, tick)) continue;
      if (target !== undefined && this.#lists(def, target)) this.#engage(id);
    }
  }

  /** Adds a use to puzzle `id`'s trail when it is still open; false when it is not (or unknown). */
  #trailOf(id: string, capability: string, tick: number): boolean {
    if (!this.#defs.has(id) || !IN_PLAY.includes(this.#state(id))) return false;
    const trail = [...this.#record(id).trail, { capability, tick }].slice(-TRAIL_LIMIT);
    this.#update(id, { trail });
    return true;
  }

  /** Dormant puzzles whose discovery volume holds the player. */
  #look(): void {
    const player = this.#player;
    if (player === undefined) return;
    const live = worldLiveReader(this.#world);
    for (const [id, def] of this.#defs) {
      const volume = def.discovery?.volume;
      if (volume === undefined || this.#state(id) !== 'dormant') continue;
      if (live.passes(player, [], volume)) this.#transition(id, 'discovered');
    }
  }

  /** Rebinds the listed spawns when entities came or went, and fails or revives puzzles by it. */
  #scan(): void {
    if (this.#structure === this.#world.structureVersion) return;
    this.#sync();
  }

  #sync(): void {
    this.#structure = this.#world.structureVersion;
    const bound = new Map<string, EntityId>();
    if (this.#world.isRegistered(SceneSpawnComponent)) {
      this.#world.query(SceneSpawnComponent).forEach((entity, spawn) => {
        bound.set(spawn.id, entity);
      });
    }
    const wanted = new Set(
      [...this.#defs.values()].flatMap((def) => [
        ...def.entities.map((entity) => entity.id),
        ...this.#policies(def.id).flatMap((policy) =>
          policy.kind === 'reset'
            ? [policy.trigger, ...policy.mechanisms.map(({ spawn }) => spawn)]
            : [],
        ),
      ]),
    );
    this.#bound = new Map([...bound].filter(([spawn]) => wanted.has(spawn)));
    this.#watched.clear();
    for (const entity of this.#bound.values()) this.#watched.add(entity);
    for (const [id, def] of this.#defs) {
      const seen = known(this.#seen.get(id));
      const lost: string[] = [];
      for (const { id: spawn, critical } of def.entities) {
        if (!critical) continue;
        if (this.#bound.has(spawn)) seen.add(spawn);
        else if (seen.has(spawn) || this.#record(id).lost.includes(spawn)) lost.push(spawn);
      }
      const before = this.#record(id).lost;
      if (before.length !== lost.length || before.some((spawn, i) => spawn !== lost[i])) {
        this.#update(id, { lost });
      }
      this.#checkLost(id);
      this.#schedule(id);
      this.#mark(def);
    }
  }

  #checkLost(id: string): void {
    const { state, lost } = this.#record(id);
    if (lost.length > 0 && (state === 'discovered' || state === 'in-progress')) {
      this.#transition(id, 'failed');
      this.#world.events.emit(puzzleFailed, { puzzle: id, tick: this.#world.tick, lost });
    } else if (lost.length === 0 && state === 'failed') {
      this.#transition(id, 'in-progress');
    }
  }

  #lists(def: PuzzleDef, entity: EntityId): boolean {
    return def.entities.some((listed) => this.#bound.get(listed.id) === entity);
  }

  #spawnId(entity: EntityId): string | undefined {
    if (!this.#world.isRegistered(SceneSpawnComponent)) return undefined;
    return this.#world.get(entity, SceneSpawnComponent)?.id;
  }

  // --- recovery ------------------------------------------------------------------------------

  /** Marks the puzzle's critical physics objects so a fall out of the level returns them home. */
  #mark(def: PuzzleDef): void {
    // Only a puzzle in play marks anything: a dormant one leaves the world (and its hash) as it was.
    if (this.#killY === undefined || this.#state(def.id) === 'dormant') return;
    if (!this.#world.isRegistered(PhysicsObjectComponent)) return;
    for (const { id: spawn, critical } of def.entities) {
      const entity = this.#bound.get(spawn);
      if (!critical || entity === undefined || !this.#world.has(entity, PhysicsObjectComponent)) {
        continue;
      }
      const home = this.#world.get(entity, SceneTransformComponent)?.position;
      const marked =
        this.#world.isRegistered(PuzzleCriticalComponent) &&
        this.#world.has(entity, PuzzleCriticalComponent);
      if (home !== undefined && !marked)
        markPuzzleCritical(this.#world, entity, { puzzle: def.id, spawn, home });
    }
  }

  #policies(id: string): readonly RecoveryDef[] {
    return known(this.#defs.get(id)).recovery ?? [];
  }

  #setRecovering(id: string, recovering: readonly PendingRespawn[]): void {
    const next: PuzzleRecord = { ...this.#record(id), recovering };
    if (recovering.length === 0) delete (next as { recovering?: unknown }).recovering;
    this.#records.set(id, next);
    this.#dirty.add(id);
  }

  #pending(id: string): readonly PendingRespawn[] {
    return this.#record(id).recovering ?? [];
  }

  /** Queues a respawn for each lost critical entity a policy replaces, and drops those that came back. */
  #schedule(id: string): void {
    const { state, lost } = this.#record(id);
    const hz = this.#world.clock.hz;
    let pending = this.#pending(id);
    for (const policy of this.#policies(id)) {
      if (policy.kind !== 'respawn') continue;
      const queued = pending.find((p) => p.spawn === policy.entity);
      if (queued !== undefined && !queued.spent && this.#bound.has(policy.entity)) {
        pending = pending.filter((p) => p !== queued);
      }
      if (state === 'solved' || !lost.includes(policy.entity)) continue;
      if (pending.some((p) => p.spawn === policy.entity)) continue;
      const due = this.#world.tick + Math.ceil(policy.seconds * hz);
      pending = [...pending, { spawn: policy.entity, due, spent: false }];
    }
    if (pending.length !== this.#pending(id).length) this.#setRecovering(id, pending);
  }

  /** A critical entity burnt out: a respawn policy for it replaces the spent copy. */
  #spent(entity: EntityId): void {
    for (const id of this.#defs.keys()) {
      for (const policy of this.#policies(id)) {
        if (policy.kind !== 'respawn' || this.#bound.get(policy.entity) !== entity) continue;
        if (this.#pending(id).some((p) => p.spawn === policy.entity)) continue;
        const due = this.#world.tick + Math.ceil(policy.seconds * this.#world.clock.hz);
        this.#setRecovering(id, [...this.#pending(id), { spawn: policy.entity, due, spent: true }]);
      }
    }
  }

  /** Tries the respawns that are due: clear spot, new copy; else again in `RETRY_SECONDS`. */
  #recover(): void {
    const host = this.#host;
    const tick = this.#world.tick;
    if (this.#killY !== undefined) returnLost(this.#world, this.#killY());
    if (host === undefined) return;
    for (const id of this.#defs.keys()) {
      const due = this.#pending(id).filter((p) => p.due <= tick);
      if (due.length === 0) continue;
      let pending = [...this.#pending(id)];
      const without = (p: PendingRespawn) => pending.filter((q) => q !== p);
      for (const p of due) {
        if (this.#state(id) === 'solved') {
          pending = without(p);
        } else if (p.spent) {
          // The old copy goes this tick; the spot is looked at the next.
          host.remove(p.spawn);
          pending = [...without(p), { ...p, spent: false, due: tick + 1 }];
        } else if (this.#taken(host, p.spawn)) {
          const retry = tick + Math.ceil(RETRY_SECONDS * this.#world.clock.hz);
          pending = [...without(p), { ...p, due: retry }];
        } else {
          pending = without(p);
          host.spawn(p.spawn);
          this.#world.events.emit(puzzleRecovered, {
            puzzle: id,
            tick,
            kind: 'respawn',
            entity: p.spawn,
          });
        }
      }
      this.#setRecovering(id, pending);
    }
  }

  /** Whether another physics object stands where a fresh copy of `spawn` would appear. */
  #taken(host: PuzzleHost, spawn: string): boolean {
    const spot = host.footprint(spawn);
    return spot !== undefined && !footprintClear(this.#world, spot.centre, spot.halfExtents);
  }

  /** The reset trigger was used: mechanisms back to authored, the puzzle back in progress. */
  #reset(id: string, policy: Extract<RecoveryDef, { kind: 'reset' }>): void {
    if (this.#state(id) === 'solved') return;
    const defaults: MechanismDefault[] = [];
    for (const { spawn, door, switch: own } of policy.mechanisms) {
      const entity = this.#bound.get(spawn);
      if (entity === undefined) continue;
      if (door !== undefined && this.#world.has(entity, DoorComponent)) {
        defaults.push({
          kind: 'door',
          entity,
          open: door.open,
          jammed: door.jammed,
          locked: this.#world.has(entity, LockComponent) ? door.locked : undefined,
        });
      }
      if (own !== undefined && this.#world.has(entity, SwitchComponent)) {
        defaults.push({ kind: 'switch', entity, position: own.position });
      }
    }
    resetMechanisms(this.#world, defaults);
    if (policy.fact !== undefined) this.#world.facts.increment(policy.fact);
    const state = this.#state(id);
    if (state === 'dormant' || state === 'discovered') this.#transition(id, 'in-progress');
    this.#world.events.emit(puzzleRecovered, {
      puzzle: id,
      tick: this.#world.tick,
      kind: 'reset',
      entity: '',
    });
  }

  // --- hints ---------------------------------------------------------------------------------

  #setHints(id: string, hints: PuzzleRecord['hints'] | undefined): void {
    const next: PuzzleRecord = { ...this.#record(id), ...(hints !== undefined && { hints }) };
    if (hints === undefined) delete (next as { hints?: unknown }).hints;
    this.#records.set(id, next);
    this.#dirty.add(id);
  }

  /** Whether each of puzzle `id`'s failure signals is on now. */
  #failures(id: string): boolean[] {
    const live = worldLiveReader(this.#world);
    return (known(this.#defs.get(id)).failures ?? []).map(({ signal, port }) => {
      const [graph = '', node = ''] = signal.split('/');
      return live.signal(graph, node, port);
    });
  }

  /** Takes the failure signals as they stand, so a pulse already on is not an attempt. */
  #readFailures(): void {
    for (const id of this.#defs.keys()) this.#failing.set(id, this.#failures(id));
  }

  /** Counts failed attempts and fires the next hint tier of each puzzle in play that is due one. */
  #hints(): void {
    const tick = this.#world.tick;
    const hz = this.#world.clock.hz;
    const scale = Math.round(this.#world.difficulty.puzzleHints * 10_000);
    for (const [id, def] of this.#defs) {
      if (def.hints === undefined || def.hints.length === 0) continue;
      const now = this.#failures(id);
      const before = known(this.#failing.get(id));
      this.#failing.set(id, now);
      const record = this.#record(id);
      if (record.state !== 'discovered' && record.state !== 'in-progress') continue;
      const edges = now.filter((on, i) => on && !before[i]).length;
      let progress = record.hints ?? { fired: 0, attempts: 0 };
      if (edges > 0) {
        progress = { ...progress, attempts: progress.attempts + edges };
        this.#setHints(id, progress);
      }
      const tier = def.hints[progress.fired];
      if (tier === undefined || scale === 0) continue;
      const elapsed = tick - Number(record.discoveredAt);
      const due = Math.ceil((tier.afterSeconds * hz * 10_000) / scale);
      if (
        elapsed < due &&
        !(tier.afterAttempts !== undefined && progress.attempts >= tier.afterAttempts)
      ) {
        continue;
      }
      this.#fireHint(id, progress.fired, tier);
    }
  }

  #fireHint(id: string, index: number, tier: HintTierDef): void {
    const progress = this.#record(id).hints ?? { fired: 0, attempts: 0 };
    this.#setHints(id, { ...progress, fired: index + 1 });
    const player = this.#player;
    const variant =
      player === undefined
        ? undefined
        : tier.variants.find(({ capability }) => hasCapability(this.#world, player, capability));
    const entities = tier.highlight.flatMap((spawn) => {
      const entity = this.#bound.get(spawn);
      return entity === undefined ? [] : [entity];
    });
    if (tier.rumour !== undefined) this.#world.facts.set(tier.rumour, true);
    this.#world.events.emit(puzzleHint, {
      puzzle: id,
      tier: index,
      tick: this.#world.tick,
      bark: variant?.bark ?? tier.bark,
      variant: variant?.capability,
      highlight: tier.highlight,
      entities,
      rumour: tier.rumour,
    });
  }

  // --- persistence ---------------------------------------------------------------------------

  /** Keeps each unsolved puzzle's sustained-hold progress in its record. */
  #holds(): void {
    for (const id of this.#defs.keys()) {
      const record = this.#record(id);
      if (record.state === 'solved') continue;
      const holds = this.#goals.holds(id);
      if (
        holds.length === record.holds.length &&
        holds.every((tick, i) => tick === record.holds[i])
      ) {
        continue;
      }
      this.#update(id, { holds });
    }
  }

  /** Writes the records that changed to their entities (making them on first need). */
  #flush(): void {
    for (const id of this.#dirty) {
      const record = this.#record(id);
      let entity = this.#entities.get(id);
      if (entity === undefined && record.state === 'dormant' && record.recovering === undefined) {
        continue;
      }
      if (!this.#world.isRegistered(PuzzleStateComponent))
        this.#world.register(PuzzleStateComponent);
      if (entity === undefined) {
        entity = this.#world.spawn();
        this.#entities.set(id, entity);
        this.#world.add(entity, PuzzleStateComponent, record);
      } else {
        this.#world.set(entity, PuzzleStateComponent, record);
      }
    }
    this.#dirty.clear();
  }

  /** After `World.restore`: take the records the snapshot holds, resume holds, re-read the goals. */
  #reload(): void {
    if (this.#restores === this.#world.restores) return;
    this.#restores = this.#world.restores;
    this.#entities.clear();
    this.#dirty.clear();
    for (const id of this.#defs.keys()) this.#records.set(id, fresh(id));
    if (this.#world.isRegistered(PuzzleStateComponent)) {
      this.#world.query(PuzzleStateComponent).forEach((entity, record) => {
        if (!this.#defs.has(record.id)) return;
        this.#records.set(record.id, structuredClone(record));
        this.#entities.set(record.id, entity);
      });
    }
    for (const [id, seen] of this.#seen) {
      seen.clear();
      this.#goals.restoreHolds(id, this.#record(id).holds);
    }
    this.#structure = -1;
    this.#sync();
    this.#goals.refresh();
    this.#readFailures();
  }
}

/** The system that runs a runtime's puzzles; add it after movement, stimuli, elements and signals. */
export function puzzleSystem<TInput>(runtime: PuzzleRuntime): System<TInput> {
  return {
    name: 'puzzles',
    run: () => {
      runtime.poll();
    },
  };
}
