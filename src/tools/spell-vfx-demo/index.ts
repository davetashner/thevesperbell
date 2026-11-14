// Spell VFX testbed (mw-e29.10): the `?spells` URL parameter shows every spell VFX slot in turn on
// stand-ins in front of the player, so the templates can be looked at and the e2e can read what was
// drawn from #app[data-spell-vfx]. It never touches the shared testbed scene: with no parameter nothing
// here runs, and the stand-ins are not in the sim, so nothing can move a golden.
//
//   ?spells=demo     every slot of both demo blocks (arcane defaults, then an orange tint), one step
//                    every 3.2 s, repeating
//   ?spells=<slot>   that slot alone for both blocks, e.g. ?spells=area or ?spells=beam
//
// The demo blocks (demo-spells.json: the arcane block takes every template's defaults, the ember block
// the same templates in orange, the area at 4 m) name templates only. The steps drive the same SpellVfxPlayer a
// spell cast will: windup, release, a projectile flown caster to target and its impact, an area of
// radius 4 m, a beam while the caster strafes (so the beam start is seen following its socket), a
// sustain loop and a summon that dissolves.

import { SPELL_VFX_SLOTS, type SpellVfxBlockInput, type SpellVfxSlot } from '@content/index';
import type { ResolvedSpellVfx, SpellVfxLibrary } from '@game/spell-vfx/library';
import type { SpellVfxPlayer, SpellVfxPlaying, SpellVfxTarget } from '@game/spell-vfx/player';
import { known } from '@game/vfx/indexing';
import type { VfxAnchor, VfxAnchorResolver } from '@game/vfx/index';
import type { EntityId, Vec3 } from '@sim/index';
import demoJson from './demo-spells.json';

/** Seconds each step shows. */
export const SPELL_DEMO_STEP_SECONDS = 3.2;
/** Radius of the demo area, metres (AC-2 shows a ring of exactly this). */
export const SPELL_DEMO_AREA_RADIUS = 4;
/** Seconds the demo projectile takes from caster to target. */
export const SPELL_DEMO_FLIGHT_SECONDS = 0.9;
/** Metres in front of the player the caster and target stand, and how far each is to its side. */
export const SPELL_DEMO_DISTANCE = 4.5;
export const SPELL_DEMO_SPREAD = 2.5;
/** How far the caster walks forward and back while the beam is up, metres. */
export const SPELL_DEMO_STRAFE = 1.5;
/** Entity ids of the stand-ins (far from any real entity's id range). */
export const SPELL_DEMO_CASTER: EntityId = 910_000;
export const SPELL_DEMO_TARGET: EntityId = 910_001;
export const SPELL_DEMO_PROJECTILE: EntityId = 910_002;
/** Socket on the caster the beam leaves from, and its height above the feet. */
export const SPELL_DEMO_SOCKET = 'hand-r';
const CASTER_HAND_HEIGHT = 1.3;
const TARGET_CHEST_HEIGHT = 1.1;

/** The demo blocks, as plain ids (the library validates and resolves them like a spell's `vfx`). */
export function spellDemoBlocks(): Readonly<Record<string, SpellVfxBlockInput>> {
  const blocks: Record<string, SpellVfxBlockInput> = demoJson;
  return blocks;
}

/** One step: which block shows which slot. */
export interface SpellDemoStep {
  readonly block: string;
  readonly slot: SpellVfxSlot;
}

/** `?spells=demo` → every slot of every block; `?spells=<slot>` → that slot; otherwise undefined (off). */
export function parseSpellDemoParam(
  search: string,
  blocks: readonly string[] = Object.keys(spellDemoBlocks()),
): readonly SpellDemoStep[] | undefined {
  const value = new URLSearchParams(search).get('spells');
  if (value === null || value === '') return undefined;
  const slots =
    value === 'demo' ? SPELL_VFX_SLOTS : SPELL_VFX_SLOTS.filter((slot) => slot === value);
  if (slots.length === 0) return undefined;
  return blocks.flatMap((block) => slots.map((slot) => ({ block, slot })));
}

/** The stage: where the player stands and which way they face (radians; 0 faces -z). */
export interface SpellDemoStage {
  readonly origin: Vec3;
  readonly yaw: number;
}

/** What the demo has done, for the e2e probe. */
export interface SpellDemoStats {
  readonly step: number;
  readonly block: string;
  readonly slot: SpellVfxSlot;
  readonly steps: number;
  readonly started: number;
  /** The beam's start and its caster's socket as last placed (they match every frame). */
  readonly casterHand: Vec3;
  readonly areaRadius: number;
  /** Summoned body's dissolve progress, 0 whole … 1 gone. */
  readonly dissolve: number;
}

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

/** Plays the steps through a SpellVfxPlayer. */
export class SpellVfxDemo {
  readonly #player: SpellVfxPlayer;
  readonly #resolved = new Map<string, ResolvedSpellVfx>();
  readonly #steps: readonly SpellDemoStep[];
  readonly #places = new Map<EntityId, { x: number; y: number; z: number }>();
  #playing: SpellVfxPlaying[] = [];
  #index = -1;
  #elapsed = SPELL_DEMO_STEP_SECONDS;
  #started = 0;
  #dissolveSeconds = 1;
  #dissolve = 1;
  #flown = false;
  #stage: SpellDemoStage = { origin: ZERO, yaw: 0 };

  constructor(player: SpellVfxPlayer, library: SpellVfxLibrary, steps: readonly SpellDemoStep[]) {
    if (steps.length === 0) throw new Error('spell vfx demo: no steps');
    this.#player = player;
    this.#steps = steps;
    for (const [name, block] of Object.entries(spellDemoBlocks())) {
      this.#resolved.set(name, library.resolve(block));
    }
    for (const entity of [SPELL_DEMO_CASTER, SPELL_DEMO_TARGET, SPELL_DEMO_PROJECTILE]) {
      this.#places.set(entity, { x: 0, y: 0, z: 0 });
    }
  }

  /** Anchors of the stand-ins for the VfxSystem; undefined for any other entity. */
  readonly anchor: VfxAnchorResolver = (entity, socket): VfxAnchor | undefined => {
    const at = this.#places.get(entity);
    if (at === undefined) return undefined;
    const lift =
      entity === SPELL_DEMO_CASTER && socket === SPELL_DEMO_SOCKET
        ? CASTER_HAND_HEIGHT
        : entity === SPELL_DEMO_TARGET
          ? TARGET_CHEST_HEIGHT
          : 0;
    return { position: { x: at.x, y: at.y + lift, z: at.z } };
  };

  /** A stand-in's position (feet), for entities this demo made. */
  #feet(entity: EntityId): Vec3 {
    return known(this.#places.get(entity));
  }

  /** The caster's cast socket, and the target's chest, in the world now. */
  #hand(): Vec3 {
    return known(this.anchor(SPELL_DEMO_CASTER, SPELL_DEMO_SOCKET)).position;
  }
  #chest(): Vec3 {
    return known(this.anchor(SPELL_DEMO_TARGET, undefined)).position;
  }

  /** Where the summoned body stands: between the caster and target, in view past the player. */
  #summonFeet(): Vec3 {
    return this.#ahead(SPELL_DEMO_DISTANCE - 1, 0);
  }

  /** Where the figures stand now (the render side draws them). */
  figures(): {
    readonly caster: Vec3;
    readonly target: Vec3;
    readonly summoned: { readonly at: Vec3; readonly present: boolean; readonly dissolve: number };
  } {
    return {
      caster: this.#feet(SPELL_DEMO_CASTER),
      target: this.#feet(SPELL_DEMO_TARGET),
      summoned: { at: this.#summonFeet(), present: this.summoned, dissolve: this.#dissolve },
    };
  }

  get stats(): SpellDemoStats {
    const step = known(this.#steps[Math.max(this.#index, 0)]);
    return {
      step: this.#index,
      block: step.block,
      slot: step.slot,
      steps: this.#steps.length,
      started: this.#started,
      casterHand: this.#hand(),
      areaRadius: SPELL_DEMO_AREA_RADIUS,
      dissolve: this.#dissolve,
    };
  }

  /** The step showing now; undefined before the first update. */
  get current(): SpellDemoStep | undefined {
    return this.#steps[this.#index];
  }

  /** How dissolved the summoned body is, 0 whole … 1 gone (it arrives dissolving in, then leaves). */
  get dissolve(): number {
    return this.#dissolve;
  }

  /** Whether the summoned body is on stage. */
  get summoned(): boolean {
    return this.current?.slot === 'summon';
  }

  #ahead(distance: number, across = 0): { x: number; y: number; z: number } {
    const { origin, yaw } = this.#stage;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    return {
      x: origin.x + fx * distance + -fz * across,
      y: origin.y,
      z: origin.z + fz * distance + fx * across,
    };
  }

  /** Call once per frame with the seconds since the last, the player's feet and heading. */
  update(dt: number, stage: SpellDemoStage): void {
    this.#stage = stage;
    this.#elapsed += dt;
    if (this.#elapsed >= SPELL_DEMO_STEP_SECONDS) this.#next();
    const step = known(this.#steps[this.#index]);
    const t = this.#elapsed;
    // The caster stands to the left; during the beam it walks forward and back so the beam start
    // must follow its socket. The target stands to the right.
    const walk =
      step.slot === 'beam'
        ? Math.sin((t / SPELL_DEMO_STEP_SECONDS) * Math.PI * 2) * SPELL_DEMO_STRAFE
        : 0;
    this.#move(SPELL_DEMO_CASTER, this.#ahead(SPELL_DEMO_DISTANCE + walk, -SPELL_DEMO_SPREAD));
    this.#move(SPELL_DEMO_TARGET, this.#ahead(SPELL_DEMO_DISTANCE, SPELL_DEMO_SPREAD));
    if (step.slot === 'projectile') this.#fly(step, t);
    if (step.slot === 'summon') {
      // Dissolves in over the template's time, holds, then dissolves out before the step ends.
      const total = this.#dissolveSeconds;
      const out = SPELL_DEMO_STEP_SECONDS - total;
      this.#dissolve = t < total ? 1 - t / total : t > out ? (t - out) / total : 0;
    } else this.#dissolve = 1;
  }

  #move(entity: EntityId, to: Vec3): void {
    const at = known(this.#places.get(entity));
    at.x = to.x;
    at.y = to.y;
    at.z = to.z;
  }

  /** The bolt flies hand to chest; on arrival its head and trail stop and the impact plays. */
  #fly(step: SpellDemoStep, t: number): void {
    const from = this.#hand();
    const to = this.#chest();
    const f = Math.min(t / SPELL_DEMO_FLIGHT_SECONDS, 1);
    this.#move(SPELL_DEMO_PROJECTILE, {
      x: from.x + (to.x - from.x) * f,
      y: from.y + (to.y - from.y) * f,
      z: from.z + (to.z - from.z) * f,
    });
    if (f < 1 || this.#flown) return;
    this.#flown = true;
    this.#stopAll();
    this.#keep(this.#player.impact(this.#block(step), to));
  }

  #block(step: SpellDemoStep): ResolvedSpellVfx {
    return known(this.#resolved.get(step.block));
  }

  #keep(playing: SpellVfxPlaying | undefined): void {
    this.#playing.push(known(playing)); // the demo blocks fill every slot
  }

  #stopAll(): void {
    for (const playing of this.#playing.splice(0)) playing.stop();
  }

  #next(): void {
    this.#stopAll();
    this.#index = (this.#index + 1) % this.#steps.length;
    this.#elapsed = 0;
    this.#flown = false;
    this.#started++;
    const step = known(this.#steps[this.#index]);
    const vfx = this.#block(step);
    const caster: SpellVfxTarget = { entity: SPELL_DEMO_CASTER, socket: SPELL_DEMO_SOCKET };
    const target: SpellVfxTarget = { entity: SPELL_DEMO_TARGET };
    const player = this.#player;
    switch (step.slot) {
      case 'castWindup':
        this.#keep(player.castWindup(vfx, caster));
        break;
      case 'castRelease':
        this.#keep(player.castRelease(vfx, caster));
        break;
      case 'projectile':
        this.#keep(player.projectile(vfx, { entity: SPELL_DEMO_PROJECTILE }));
        break;
      case 'impact':
        this.#keep(player.impact(vfx, this.#chest()));
        break;
      case 'area':
        // Centred on the player's feet, so the third-person view sees the whole ring around them.
        this.#keep(player.area(vfx, this.#ahead(0), SPELL_DEMO_AREA_RADIUS));
        break;
      case 'beam':
        this.#keep(player.beam(vfx, caster, target));
        break;
      case 'sustainOnTarget':
        this.#keep(player.sustainOnTarget(vfx, target));
        break;
      case 'summon': {
        const summoned = known(player.summon(vfx, { position: this.#summonFeet() }));
        this.#dissolveSeconds = summoned.summon.dissolveSeconds;
        this.#keep(summoned.playing);
        break;
      }
    }
  }

  /** Stops everything playing. */
  dispose(): void {
    this.#stopAll();
  }
}
