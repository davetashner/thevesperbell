// Liquid components (mw-e03.6). A liquid volume is a level-based box of liquid (a basin, a millpond, a
// puddle): no fluid dynamics, just layers stacked by density with a surface height. Everything else a
// liquid does comes from world properties: each layer is a real entity carrying its liquid's material
// (oil is flammable, water is saturated), so fire, wetness and stimuli treat a layer like any object.

import { defineComponent, type EntityId } from '../core/component';
import type { StimulusFalloff, StimulusShape, Vec3 } from '../stimulus/shapes';

/** One layer of a volume: a liquid, how deep it is, and the entity that carries its properties. */
export interface LiquidLayer {
  /** The liquid's material id (a material with `liquid: true`, e.g. `water`, `oil`). */
  readonly liquid: string;
  /** Depth, m (> 0). */
  readonly depth: number;
  /** The entity that has the liquid's material properties and sits in the layer's slab. */
  readonly entity: EntityId;
  /** Tick the layer was created on (a layer's entity is only pruned as dead after that tick). */
  readonly born: number;
}

/** A drain: while open the level falls by `rate` m/s, bottom layer first. */
export interface LiquidDrain {
  readonly open: boolean;
  /** Level fall, m/s (≥ 0). */
  readonly rate: number;
}

/** A tap or spring: while open it adds `liquid` at `rate` m/s of level until the volume is full. */
export interface LiquidFill {
  readonly open: boolean;
  readonly liquid: string;
  /** Level rise, m/s (≥ 0). */
  readonly rate: number;
}

/**
 * A volume of liquid (`liquid.volume`; a snapshot and save key, never renamed). `min.y` is the floor
 * and `max.y` the brim; the surface is the floor plus the layers' depths. Layers run bottom to top,
 * densest first.
 */
export interface LiquidVolume {
  readonly min: Vec3;
  readonly max: Vec3;
  readonly layers: readonly LiquidLayer[];
  readonly drain?: LiquidDrain;
  readonly fill?: LiquidFill;
}

export const LiquidVolumeComponent = defineComponent<LiquidVolume>('liquid.volume');

/** Marks the entity that carries a layer's properties (`liquid.layer`), so rules can tell it apart. */
export interface LiquidLayerMark {
  readonly volume: EntityId;
}

export const LiquidLayerComponent = defineComponent<LiquidLayerMark>('liquid.layer');

/** An entity that is fully inside a volume right now (`liquid.submerged`). */
export interface Submerged {
  readonly volume: EntityId;
}

export const SubmergedComponent = defineComponent<Submerged>('liquid.submerged');

/** A rain zone (`liquid.rain`): a box of sky that wets what is inside it while `on`. */
export interface RainZone {
  readonly min: Vec3;
  readonly max: Vec3;
  /** Wetness added per second to everything inside (> 0). */
  readonly rate: number;
  readonly on: boolean;
}

export const RainZoneComponent = defineComponent<RainZone>('liquid.rain');

/** A cold or heat stimulus that reached a volume this tick, waiting for the ice rule to spread it over cells. */
export interface IceExposure {
  readonly shape: StimulusShape;
  readonly falloff: StimulusFalloff;
  /** °C at full falloff: negative for cold, positive for heat. */
  readonly delta: number;
}

/** One horizontal cell of a volume's surface: its temperature offset and the ice grown on it. */
export interface IceCell {
  /** Cell column and row from the volume's min corner (x, z). */
  readonly ix: number;
  readonly iz: number;
  /** Surface temperature minus the air's, °C: stimuli move it, it relaxes to 0. */
  readonly offset: number;
  /** Ice thickness, m (0 … max). */
  readonly thickness: number;
  /** Thickness of the ice collider now standing (0: none), m. */
  readonly solid: number;
  /** Height of that collider's top, m. */
  readonly top: number;
  /** Handle of that collider in the world's physics (0: none). */
  readonly collider: number;
}

/** The ice on a volume (`liquid.ice`; a snapshot and save key): cells with ice or a temperature offset. */
export interface LiquidIce {
  /** Sorted by (ix, iz). */
  readonly cells: readonly IceCell[];
  readonly pending: readonly IceExposure[];
}

export const LiquidIceComponent = defineComponent<LiquidIce>('liquid.ice');

/** What a frozen object remembers (`freeze.state`): its friction before it iced, and heat absorbed thawing. */
export interface FreezeState {
  /** Friction before freezing, restored on thaw (-1: it was not changed). */
  readonly friction: number;
  /** Heat spent melting so far, °C. */
  readonly absorbed: number;
}

export const FreezeStateComponent = defineComponent<FreezeState>('freeze.state');

/** Every component the liquids layer uses. */
export const LIQUID_COMPONENTS = [
  LiquidVolumeComponent,
  LiquidLayerComponent,
  SubmergedComponent,
  RainZoneComponent,
  LiquidIceComponent,
  FreezeStateComponent,
] as const;
