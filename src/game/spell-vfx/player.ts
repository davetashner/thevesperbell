// Playing a resolved spell VFX block (mw-e29.10): the cast-time half of the spell VFX layer. The spell
// pipeline (e06.17) calls one method per slot as the cast happens; each plays the slot's template and
// returns a handle to stop it, or undefined when the spell does not use that slot, which is skipped
// quietly (AC-4). Particle slots go through the VfxSystem; the area ring and the beam are drawn by
// the surfaces this is given (src/render/spell-vfx).
//
// Per-frame cost: `update` visits ONLY live beams (AC-3: a beam's start follows its cast socket every
// frame): per beam, two anchor reads and one `setEnds`. With no beam alive it does nothing. Every
// other slot is event-driven. VFX never feeds back into the sim: anchors are read only.

import type { BeamDrawing, SpellVfxSurfaces } from '@render/spell-vfx/rules';
import type { EntityId, Vec3 } from '@sim/index';
import type { VfxAnchorResolver, VfxHandle, VfxSpawnOptions } from '../vfx/index.ts';
import type { ResolvedEffect, ResolvedSpellVfx, ResolvedSummon } from './library.ts';

/** Where a slot plays: on an entity (optionally one of its sockets), or at a point. */
export type SpellVfxTarget =
  { readonly entity: EntityId; readonly socket?: string } | { readonly position: Vec3 };

/** What the player spawns particles through (the VfxSystem satisfies it). */
export interface SpellVfxSpawner {
  spawn(effectId: string, options: VfxSpawnOptions): VfxHandle | null;
  stop(handle: VfxHandle): void;
}

/** A running slot: stop it to end its particles and drawings. */
export interface SpellVfxPlaying {
  stop(): void;
}

interface LiveBeam {
  readonly drawing: BeamDrawing;
  readonly caster: SpellVfxTarget;
  readonly end: SpellVfxTarget;
  readonly start: { x: number; y: number; z: number };
  readonly to: { x: number; y: number; z: number };
}

/** A fixed unit up quaternion turned to point along a surface normal (x, y, z unit length). */
function upTo(normal: Vec3): { x: number; y: number; z: number; w: number } {
  // Rotation taking (0, 1, 0) to `normal`: axis (nz, 0, -nx), cos = ny.
  const w = 1 + normal.y;
  if (w < 1e-6) return { x: 1, y: 0, z: 0, w: 0 }; // straight down: half a turn about x
  const length = Math.hypot(normal.z, normal.x, w);
  return { x: normal.z / length, y: 0, z: -normal.x / length, w: w / length };
}

/** Plays the slots of resolved spell VFX blocks. */
export class SpellVfxPlayer {
  readonly #vfx: SpellVfxSpawner;
  readonly #anchors: VfxAnchorResolver;
  readonly #surfaces: SpellVfxSurfaces;
  readonly #beams = new Set<LiveBeam>();

  constructor(options: {
    readonly vfx: SpellVfxSpawner;
    readonly anchors: VfxAnchorResolver;
    readonly surfaces: SpellVfxSurfaces;
  }) {
    this.#vfx = options.vfx;
    this.#anchors = options.anchors;
    this.#surfaces = options.surfaces;
  }

  /** Beams currently alive (the per-frame work `update` does). */
  get liveBeams(): number {
    return this.#beams.size;
  }

  /** Where `target` is now; undefined when its entity or socket is gone. */
  #where(target: SpellVfxTarget): Vec3 | undefined {
    return 'position' in target
      ? target.position
      : this.#anchors(target.entity, target.socket)?.position;
  }

  #particles(
    slot: ResolvedEffect | undefined,
    target: SpellVfxTarget,
    extra: VfxSpawnOptions = {},
  ): SpellVfxPlaying | undefined {
    if (slot === undefined) return undefined;
    const options: VfxSpawnOptions =
      'position' in target
        ? { ...extra, position: target.position, scale: slot.scale * (extra.scale ?? 1) }
        : {
            ...extra,
            entity: target.entity,
            scale: slot.scale * (extra.scale ?? 1),
            ...(target.socket !== undefined && { socket: target.socket }),
          };
    const handle = this.#vfx.spawn(slot.effect, options);
    return {
      stop: () => {
        if (handle !== null) this.#vfx.stop(handle);
      },
    };
  }

  /** The charge-up effect on the caster; stop it when the spell releases or is cancelled. */
  castWindup(vfx: ResolvedSpellVfx, caster: SpellVfxTarget): SpellVfxPlaying | undefined {
    return this.#particles(vfx.castWindup, caster);
  }

  /** The release flash on the caster. */
  castRelease(vfx: ResolvedSpellVfx, caster: SpellVfxTarget): SpellVfxPlaying | undefined {
    return this.#particles(vfx.castRelease, caster);
  }

  /** The projectile's head (and trail), riding `projectile` for its whole flight. */
  projectile(vfx: ResolvedSpellVfx, projectile: SpellVfxTarget): SpellVfxPlaying | undefined {
    if (vfx.projectile === undefined) return undefined;
    const parts = [
      this.#particles(vfx.projectile.head, projectile),
      this.#particles(vfx.projectile.trail, projectile),
    ];
    return {
      stop: () => {
        for (const part of parts) part?.stop();
      },
    };
  }

  /** The impact effect at `at`, turned to the surface `normal` when given. */
  impact(vfx: ResolvedSpellVfx, at: Vec3, normal?: Vec3): SpellVfxPlaying | undefined {
    const rotation = normal && { rotation: upTo(normal), worldRotation: true };
    return this.#particles(vfx.impact, { position: at }, rotation);
  }

  /** The area ring (and its motes) at `centre`, its edge exactly `radius` metres out. */
  area(vfx: ResolvedSpellVfx, centre: Vec3, radius: number): SpellVfxPlaying | undefined {
    const ring = vfx.area;
    if (ring === undefined) return undefined;
    const drawing = this.#surfaces.openRing({ centre, radius, ring });
    // Motes spread over the whole radius: the effect's spawn radius is 1 m before scaling.
    const motes = this.#particles(ring.motes, { position: centre }, { scale: radius });
    return {
      stop: () => {
        drawing.close();
        motes?.stop();
      },
    };
  }

  /**
   * A beam from the caster's socket to `end`. The start is re-read from the caster's socket every
   * frame in `update`, so it follows a caster that moves; the end follows its own target (an
   * entity), or stays where it was aimed.
   */
  beam(
    vfx: ResolvedSpellVfx,
    caster: SpellVfxTarget,
    end: SpellVfxTarget,
  ): SpellVfxPlaying | undefined {
    const spec = vfx.beam;
    if (spec === undefined) return undefined;
    const live: LiveBeam = {
      drawing: this.#surfaces.openBeam(spec),
      caster,
      end,
      start: { x: 0, y: 0, z: 0 },
      to: { x: 0, y: 0, z: 0 },
    };
    this.#beams.add(live);
    this.#follow(live);
    const flare = this.#particles(spec.end, end);
    return {
      stop: () => {
        this.#beams.delete(live);
        live.drawing.close();
        flare?.stop();
      },
    };
  }

  /** The loop on the target while a status or channel holds. */
  sustainOnTarget(vfx: ResolvedSpellVfx, target: SpellVfxTarget): SpellVfxPlaying | undefined {
    return this.#particles(vfx.sustainOnTarget, target);
  }

  /**
   * A summoned thing arriving (or leaving) at `at`: plays the effect and returns how long its body
   * dissolves, which the caller feeds the magical materials' dissolve (src/render/magic-materials).
   */
  summon(
    vfx: ResolvedSpellVfx,
    at: SpellVfxTarget,
  ): { readonly playing: SpellVfxPlaying; readonly summon: ResolvedSummon } | undefined {
    const summon = vfx.summon;
    const playing = this.#particles(summon, at);
    return summon && playing && { playing, summon };
  }

  /** Moves every live beam's ends to where its sockets are now. Does nothing with no beam alive. */
  update(): void {
    for (const live of this.#beams) this.#follow(live);
  }

  #follow(live: LiveBeam): void {
    const start = this.#where(live.caster);
    const end = this.#where(live.end);
    if (start === undefined || end === undefined) return; // a socket is gone: hold the last ends
    live.start.x = start.x;
    live.start.y = start.y;
    live.start.z = start.z;
    live.to.x = end.x;
    live.to.y = end.y;
    live.to.z = end.z;
    live.drawing.setEnds(live.start, live.to);
  }
}
