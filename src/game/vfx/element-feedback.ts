// The element-state presentation bridge (mw-e03.28): makes burning, wet, frozen and charged things
// legible. It watches the sim's `propertyChanged` events against the element-feedback table (content
// type `element-feedback`): when an entity's property puts it in a state, it gets that state's VFX
// effect sized to its bounds (placement radius over the effect's reference radius), its mesh look
// and an optional sound cue; when the property leaves the state they are released. The mapping is by
// property and value, never entity type.
//
// Pooling and LOD: at most `handleCap` effects are live. When more entities are in a state, the ones
// nearest the camera keep theirs (ties by entity id, then table order, so the choice is
// deterministic) and the rest are culled until they come into the nearest set. The VFX runtime pools
// effect instances and applies its own distance LOD and particle budget underneath.
//
// Presentation only: the bridge reads events and placements and never writes to the sim. Work
// happens when an event changes a state, plus a cheap check per frame in `update`.

import type { ElementFeedbackTable, ElementLookDef } from '@content/index';
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
  /** entity × rules + rule → VFX handle. */
  readonly #handles = new Map<number, VfxHandle>();
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
      perState,
    };
  }

  /** Brings effects up to date; call once per frame with the camera position. */
  update(camera: Vec3): void {
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
    } else {
      const left = known(set); // switching off needs it in the set (checked above)
      left.delete(index);
      if (left.size === 0) this.#active.delete(entity);
      this.#release(entity, index);
    }
    this.#refreshLook(entity);
  }

  #release(entity: EntityId, index: number): void {
    const key = this.#key(entity, index);
    const handle = this.#handles.get(key);
    if (handle === undefined) return;
    this.#o.vfx.stop(handle);
    this.#handles.delete(key);
  }

  #refreshLook(entity: EntityId): void {
    const looks: ElementLookDef[] = [];
    for (const index of [...(this.#active.get(entity) ?? [])].sort((a, b) => a - b)) {
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
    const { handleCap, hysteresis } = this.#o.table;
    const candidates: Candidate[] = [];
    for (const [entity, set] of this.#active) {
      const found = this.#o.boundsOf(entity);
      if (found === undefined) continue;
      const { x, y, z } = found.position;
      const distance = Math.hypot(x - camera.x, y - camera.y, z - camera.z);
      for (const rule of set) {
        const key = this.#key(entity, rule);
        const handle = this.#handles.get(key);
        const held = handle !== undefined && this.#o.vfx.alive(handle);
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
    const keep = new Set(candidates.slice(0, handleCap).map((c) => c.key));
    this.#culled = candidates.length - keep.size;
    for (const [key, handle] of [...this.#handles]) {
      if (keep.has(key) && this.#o.vfx.alive(handle)) continue;
      this.#o.vfx.stop(handle);
      this.#handles.delete(key);
    }
    const reduced = this.#o.reducedMotion();
    for (const { key, entity, rule, radius } of candidates) {
      if (!keep.has(key) || this.#handles.has(key)) continue;
      const state = this.#rule(rule);
      const scale = Math.min(
        state.scale.max,
        Math.max(state.scale.min, radius / state.referenceRadius),
      );
      const handle = this.#o.vfx.spawn(state.effect, {
        entity,
        scale,
        params: { intensity: reduced ? state.reducedIntensity : 1 },
      });
      if (handle !== null) this.#handles.set(key, handle);
    }
  }
}
