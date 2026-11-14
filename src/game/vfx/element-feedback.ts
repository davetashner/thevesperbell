// The element-state presentation bridge (mw-e03.28): makes burning, wet, frozen and charged things
// legible. It watches the sim's `propertyChanged` events against the element-feedback table (content
// type `element-feedback`): when an entity's property puts it in a state, it gets that state's VFX
// effect sized to its bounds (placement radius over the effect's reference radius), its mesh look
// and an optional sound cue; when the property leaves the state they are released. The mapping is by
// property and value, never entity type.
//
// Pooling and LOD (mw-e29.8): effects are ranked nearest the camera first (ties by entity id, then
// table order, so the choice is deterministic). The nearest `fullDetailCap` run at full detail; the
// next ones up to `handleCap` drop to low LOD (emission x `lowLodIntensity`, same look and size);
// only beyond `handleCap` are effects culled, until they come into the nearer set. So 30 burning
// objects over a budget of 16 give 16 full and 14 low-LOD flames and none culled. The VFX runtime
// pools effect instances and applies its own distance LOD and particle budget underneath.
//
// Transitions: when an entity leaves one state while in (or entering) another named by a table
// transition (burning to wet), a one-shot effect spawns once at it. Both orders of the two property
// changes within a tick count, and the edge fires exactly once.
//
// Look precedence: `looks()` layers an entity's states lowest `precedence` first (see element-look).
//
// Presentation only: the bridge reads events and placements and never writes to the sim. Work
// happens when an event changes a state, plus a cheap check per frame in `update`.

import type { ElementFeedbackTable, ElementLookDef, ElementTransitionRule } from '@content/index';
import { propertyChanged, type EntityId, type Vec3 } from '@sim/index';
import type { CueEventSource } from '../cues/audio-bridge.ts';
import type { VfxSpawner } from '../cues/vfx-bridge.ts';
import type { VfxHandle } from './system.ts';
import { at, known } from './indexing.ts';
import { combineLooks, type CombinedLook } from './element-look.ts';

/** An entity's position and bounding radius, metres. */
export interface ElementBounds {
  readonly position: Vec3;
  readonly radius: number;
}

export interface ElementFeedbackOptions {
  readonly table: ElementFeedbackTable;
  readonly vfx: Pick<VfxSpawner, 'spawn' | 'stop' | 'alive'>;
  readonly events: CueEventSource;
  readonly isAlive: (entity: EntityId) => boolean;
  /** Where an entity is and how big; undefined when it has no spatial presence (it gets no effect). */
  readonly boundsOf: (entity: EntityId) => ElementBounds | undefined;
  readonly reducedMotion: () => boolean;
  /** Plays a sound cue at an entity when it enters a state (only for cues that exist). */
  readonly playCue?: (cue: string, entity: EntityId) => void;
}

/** Counters for the scene probe and tests. */
export interface ElementFeedbackStats {
  /** Entities in at least one state. */
  readonly entities: number;
  /** Entity-states wanted. */
  readonly wanted: number;
  /** Live effect handles. */
  readonly live: number;
  /** Wanted entity-states without a handle because of the cap. */
  readonly culled: number;
  /** Live effects running at low LOD (past `fullDetailCap`). */
  readonly lowLod: number;
  /** Entity-states per state id. */
  readonly perState: Readonly<Record<string, number>>;
}

/** Camera movement, metres, that triggers a re-rank when more is wanted than the cap allows. */
const RERANK_DISTANCE = 1;

interface Candidate {
  readonly key: number;
  readonly entity: EntityId;
  readonly rule: number;
  readonly radius: number;
  readonly rank: number;
}

const byRank = (a: Candidate, b: Candidate): number =>
  a.rank - b.rank || a.entity - b.entity || a.rule - b.rule;

/** Drives element VFX, looks and cues from property changes. One per world. */
export class ElementFeedbackBridge {
  readonly #o: ElementFeedbackOptions;
  /** entity → set of rule indices it is in. */
  readonly #active = new Map<EntityId, Set<number>>();
  /** entity × rules + rule → VFX handle and whether it runs at low LOD. */
  readonly #handles = new Map<number, { handle: VfxHandle; low: boolean }>();
  /** Keys of states left since the last `update`, for transitions entered after the leave. */
  readonly #left = new Set<number>();
  readonly #looks = new Map<EntityId, CombinedLook>();
  readonly #rules: ReadonlyMap<string, readonly number[]>;
  #dirty = false;
  #rankedAt: Vec3 | undefined;
  #culled = 0;

  constructor(options: ElementFeedbackOptions) {
    this.#o = options;
    const byProperty = new Map<string, number[]>();
    options.table.states.forEach((state, index) => {
      byProperty.set(state.property, [...(byProperty.get(state.property) ?? []), index]);
    });
    this.#rules = byProperty;
  }

  /** Subscribes to property changes; returns a function that unsubscribes. */
  attach(): () => void {
    return this.#o.events.on(propertyChanged, (change) => {
      const rules = this.#rules.get(change.key);
      if (rules === undefined) return;
      for (const index of rules)
        this.#set(change.entity, index, this.#rule(index).matches(change.new));
    });
  }

  /** The combined mesh look of every entity in a look-bearing state. */
  looks(): ReadonlyMap<EntityId, CombinedLook> {
    return this.#looks;
  }

  stats(): ElementFeedbackStats {
    const perState: Record<string, number> = {};
    let wanted = 0;
    for (const set of this.#active.values()) {
      for (const index of set) {
        const id = this.#rule(index).id;
        perState[id] = (perState[id] ?? 0) + 1;
        wanted++;
      }
    }
    return {
      entities: this.#active.size,
      wanted,
      live: this.#handles.size,
      culled: this.#culled,
      lowLod: [...this.#handles.values()].filter((h) => h.low).length,
      perState,
    };
  }

  /** Brings effects up to date; call once per frame with the camera position. */
  update(camera: Vec3): void {
    this.#left.clear();
    this.#prune();
    const moved =
      this.#rankedAt === undefined ||
      Math.hypot(
        camera.x - this.#rankedAt.x,
        camera.y - this.#rankedAt.y,
        camera.z - this.#rankedAt.z,
      ) >= RERANK_DISTANCE;
    if (!this.#dirty && !(moved && this.#overCap())) return;
    this.#dirty = false;
    this.#rankedAt = { x: camera.x, y: camera.y, z: camera.z };
    this.#rank(camera);
  }

  #rule(index: number): ElementFeedbackTable['states'][number] {
    return at(this.#o.table.states, index); // an index of this table
  }

  #key(entity: EntityId, rule: number): number {
    return entity * this.#o.table.states.length + rule;
  }

  #overCap(): boolean {
    let wanted = 0;
    for (const set of this.#active.values()) wanted += set.size;
    return wanted > this.#o.table.handleCap;
  }

  #set(entity: EntityId, index: number, on: boolean): void {
    const set = this.#active.get(entity);
    if (on === (set?.has(index) ?? false)) return;
    this.#dirty = true;
    if (on) {
      if (set === undefined) this.#active.set(entity, new Set([index]));
      else set.add(index);
      const cue = this.#rule(index).audioCue;
      if (cue !== undefined) this.#o.playCue?.(cue, entity);
      for (const t of this.#o.table.transitions) {
        if (t.to === index && this.#left.has(this.#key(entity, t.from)))
          this.#transition(entity, t);
      }
    } else {
      const left = known(set); // switching off needs it in the set (checked above)
      left.delete(index);
      if (left.size === 0) this.#active.delete(entity);
      this.#release(entity, index);
      this.#left.add(this.#key(entity, index));
      for (const t of this.#o.table.transitions) {
        if (t.from === index && (this.#active.get(entity)?.has(t.to) ?? false)) {
          this.#transition(entity, t);
        }
      }
    }
    this.#refreshLook(entity);
  }

  #transition(entity: EntityId, t: ElementTransitionRule): void {
    const found = this.#o.boundsOf(entity);
    if (found === undefined) return;
    const scale = Math.min(t.scale.max, Math.max(t.scale.min, found.radius / t.referenceRadius));
    this.#o.vfx.spawn(t.effect, {
      entity,
      scale,
      params: { intensity: this.#o.reducedMotion() ? t.reducedIntensity : 1 },
    });
  }

  #release(entity: EntityId, index: number): void {
    const key = this.#key(entity, index);
    const held = this.#handles.get(key);
    if (held === undefined) return;
    this.#o.vfx.stop(held.handle);
    this.#handles.delete(key);
  }

  #refreshLook(entity: EntityId): void {
    const looks: ElementLookDef[] = [];
    const order = [...(this.#active.get(entity) ?? [])].sort(
      (a, b) => this.#rule(a).precedence - this.#rule(b).precedence || a - b,
    );
    for (const index of order) {
      const look = this.#rule(index).look;
      if (look !== undefined) looks.push(look);
    }
    const combined = combineLooks(looks);
    if (combined === undefined) this.#looks.delete(entity);
    else this.#looks.set(entity, combined);
  }

  /** Drops entities the sim destroyed (their effects stop emitting on their own). */
  #prune(): void {
    for (const entity of [...this.#active.keys()]) {
      if (this.#o.isAlive(entity)) continue;
      for (const index of known(this.#active.get(entity))) this.#release(entity, index);
      this.#active.delete(entity);
      this.#looks.delete(entity);
      this.#dirty = true;
    }
  }

  #rank(camera: Vec3): void {
    const { handleCap, fullDetailCap, lowLodIntensity, hysteresis } = this.#o.table;
    const candidates: Candidate[] = [];
    for (const [entity, set] of this.#active) {
      const found = this.#o.boundsOf(entity);
      if (found === undefined) continue;
      const { x, y, z } = found.position;
      const distance = Math.hypot(x - camera.x, y - camera.y, z - camera.z);
      for (const rule of set) {
        const key = this.#key(entity, rule);
        const had = this.#handles.get(key);
        const held = had !== undefined && this.#o.vfx.alive(had.handle);
        candidates.push({
          key,
          entity,
          rule,
          radius: found.radius,
          rank: distance - (held ? hysteresis : 0),
        });
      }
    }
    candidates.sort(byRank);
    const kept = candidates.slice(0, handleCap);
    const lodOf = new Map(kept.map((c, i) => [c.key, i >= fullDetailCap]));
    this.#culled = candidates.length - kept.length;
    for (const [key, held] of [...this.#handles]) {
      // Gone from the set, dead, or moved between full and low detail (respawned below).
      if (lodOf.get(key) === held.low && this.#o.vfx.alive(held.handle)) continue;
      this.#o.vfx.stop(held.handle);
      this.#handles.delete(key);
    }
    const reduced = this.#o.reducedMotion();
    for (const { key, entity, rule, radius } of kept) {
      if (this.#handles.has(key)) continue;
      const state = this.#rule(rule);
      const scale = Math.min(
        state.scale.max,
        Math.max(state.scale.min, radius / state.referenceRadius),
      );
      const low = lodOf.get(key) === true;
      const base = reduced ? state.reducedIntensity : 1;
      const handle = this.#o.vfx.spawn(state.effect, {
        entity,
        scale,
        params: { intensity: low ? base * lowLodIntensity : base },
      });
      if (handle !== null) this.#handles.set(key, { handle, low });
    }
  }
}
