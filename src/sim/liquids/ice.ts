// Freezing and melting (mw-e03.7), as element rules over world properties.
//
// - ice.surface: a liquid volume's surface is a grid of cells. Cold and heat stimuli that reach the
//   volume move each cell's temperature (an offset from the air above it, which relaxes back to the
//   air's). A cell at or below the top layer's `freezePoint` grows ice, thicker the colder it is and
//   the longer the cold lasts (the latent time); above it the ice melts. Ice of at least `minSolid`
//   m is a static collider, a box under the surface, that is added, resized in `step`s and removed
//   deterministically in the same tick the thickness crosses a threshold. Bodies resting on a
//   collider that changes are woken, so a melted bridge drops what stood on it that tick.
// - freeze.things: an object that is wet (wetness ≥ `wetThreshold`) and at or below its `freezePoint`
//   becomes `frozen` (not while burning; liquids freeze as volumes). Frozen objects are brittle
//   (FROZEN_FRAGILITY), jam their mechanisms and slick (friction drops to ice) through the rules
//   that already read `frozen`. A frozen object above its freeze point stays at it while it spends
//   the excess heat melting, `fusionHeat` °C per unit of wetness (like evaporation), then thaws.
// Dry objects never freeze: the cold only chills them.
//
// Nothing here names a liquid or an object kind.

import { box } from '../character/greybox';
import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import type { ElementRule } from '../elements/rules';
import { clampTemperature } from '../elements/heat';
import { PhysicsObjectComponent } from '../physics/objects';
import { boundingRadius, type RigidBodyPort } from '../physics/bodies';
import type { ColliderHandle } from '../physics/static-colliders';
import {
  assignProperty,
  readProperty,
  setProperty,
  WorldProperties,
} from '../properties/components';
import { shapeBounds, shapeFalloff } from '../stimulus/shapes';
import { stimulusResolved, temperatureSign } from '../stimulus/stimulus';
import {
  FreezeStateComponent,
  LiquidIceComponent,
  LiquidVolumeComponent,
  type FreezeState,
  type IceCell,
  type IceExposure,
  type LiquidIce,
  type LiquidVolume,
} from './components';
import { levelOf, totalDepth } from './volumes';

/** Tuning of freezing and melting (plain data; game values). */
export interface FreezeConfig {
  /** Edge of a surface cell, m (> 0). */
  readonly cellSize: number;
  /** Fraction of a cell's temperature offset lost per second, [0, 1] (the cold fades into the air). */
  readonly relaxPerSecond: number;
  /** Ice grown per second per °C below the freeze point, m (≥ 0). */
  readonly growthPerDegree: number;
  /** Ice lost per second per °C above the freeze point, m (≥ 0). */
  readonly meltPerDegree: number;
  /** Thinnest ice that is solid, m (> 0). */
  readonly minSolid: number;
  /** Thickest ice, m (≥ minSolid). */
  readonly maxThickness: number;
  /** The collider's thickness changes in steps of this, m (> 0), so growth does not rebuild it every tick. */
  readonly step: number;
  /** Friction of ice (collider and frozen things), [0, 2]. */
  readonly iceFriction: number;
  /** An offset smaller than this, °C, with no ice is forgotten (> 0). */
  readonly epsilon: number;
  /** Wetness a thing needs to freeze solid, (0, 1]. */
  readonly wetThreshold: number;
  /** Heat a frozen thing spends melting a whole unit of wetness, °C (> 0). */
  readonly fusionHeat: number;
}

/** The default freeze tuning. */
export const DEFAULT_FREEZE_CONFIG: FreezeConfig = Object.freeze({
  cellSize: 1,
  relaxPerSecond: 0.3,
  growthPerDegree: 0.005,
  meltPerDegree: 0.0005,
  minSolid: 0.1,
  maxThickness: 0.5,
  step: 0.05,
  iceFriction: 0.05,
  epsilon: 0.01,
  wetThreshold: 0.3,
  fusionHeat: 2000,
});

/** The full, validated freeze config for `input` over the defaults. Throws a RangeError. */
export function resolveFreezeConfig(input: Partial<FreezeConfig> = {}): FreezeConfig {
  const config = { ...DEFAULT_FREEZE_CONFIG, ...input };
  const positive = ['cellSize', 'minSolid', 'step', 'epsilon', 'fusionHeat'] as const;
  for (const key of positive) {
    if (!(config[key] > 0) || !Number.isFinite(config[key])) {
      throw new RangeError(`freeze config ${key} must be a finite number > 0`);
    }
  }
  for (const key of ['growthPerDegree', 'meltPerDegree'] as const) {
    if (!(config[key] >= 0) || !Number.isFinite(config[key])) {
      throw new RangeError(`freeze config ${key} must be a finite number ≥ 0`);
    }
  }
  const unit = (n: number, max: number): boolean => n >= 0 && n <= max;
  if (!unit(config.relaxPerSecond, 1))
    throw new RangeError('freeze config relaxPerSecond must be in [0, 1]');
  if (!unit(config.iceFriction, 2))
    throw new RangeError('freeze config iceFriction must be in [0, 2]');
  if (!(config.wetThreshold > 0 && config.wetThreshold <= 1)) {
    throw new RangeError('freeze config wetThreshold must be in (0, 1]');
  }
  if (!(config.maxThickness >= config.minSolid) || !Number.isFinite(config.maxThickness)) {
    throw new RangeError('freeze config maxThickness must be ≥ minSolid');
  }
  return config;
}

/** The collider thickness for ice `thickness` m thick: whole steps, none below minSolid. */
export function solidThickness(config: FreezeConfig, thickness: number): number {
  if (thickness < config.minSolid) return 0;
  return Math.max(config.minSolid, Math.floor(thickness / config.step + 1e-9) * config.step);
}

/** The cell of `ice` at (ix, iz), or undefined. */
export function iceCellAt(ice: LiquidIce, ix: number, iz: number): IceCell | undefined {
  return ice.cells.find((cell) => cell.ix === ix && cell.iz === iz);
}

/** Thickest ice of `ice`, m (0: none). */
export function thickestIce(ice: LiquidIce): number {
  return ice.cells.reduce((most, cell) => Math.max(most, cell.thickness), 0);
}

/** Wakes the bodies at rest on or near `area`, so a collider about to change does not strand them. */
function wakeOver(
  world: World<never>,
  area: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } },
): void {
  const port = world.physics as Partial<RigidBodyPort> | undefined;
  if (port?.wake === undefined) return;
  const wake = port.wake.bind(port);
  world.query(PhysicsObjectComponent).forEach((_entity, object) => {
    const r = boundingRadius(object.shape);
    const p = object.position;
    if (
      p.x + r >= area.min.x &&
      p.x - r <= area.max.x &&
      p.z + r >= area.min.z &&
      p.z - r <= area.max.z &&
      p.y + r >= area.min.y &&
      p.y - r <= area.max.y + 0.5
    ) {
      wake(object.body as ColliderHandle);
    }
  });
}

/** The horizontal rectangle a cell covers (the last row and column are clipped to the box). */
function footprintOf(config: FreezeConfig, volume: LiquidVolume, cell: IceCell) {
  const x0 = volume.min.x + cell.ix * config.cellSize;
  const z0 = volume.min.z + cell.iz * config.cellSize;
  return {
    min: { x: x0, z: z0 },
    max: {
      x: Math.min(volume.max.x, x0 + config.cellSize),
      z: Math.min(volume.max.z, z0 + config.cellSize),
    },
  };
}

/** Takes the collider under `cell` away (waking what rests on it); true when there was one. */
function dropCollider(
  world: World<never>,
  config: FreezeConfig,
  volume: LiquidVolume,
  cell: IceCell,
): void {
  const sink = world.physics;
  if (cell.collider === 0 || sink?.has(cell.collider as ColliderHandle) !== true) return;
  const { min, max } = footprintOf(config, volume, cell);
  wakeOver(world, {
    min: { x: min.x, y: cell.top - cell.solid, z: min.z },
    max: { x: max.x, y: cell.top, z: max.z },
  });
  sink.remove(cell.collider as ColliderHandle);
}

/** Brings the collider under one cell to `want` m thick with its top at `top`. Returns the new cell. */
function syncCollider(
  world: World<never>,
  config: FreezeConfig,
  volume: LiquidVolume,
  cell: IceCell,
  want: number,
  top: number,
): IceCell {
  if (want === cell.solid && (want === 0 || top === cell.top)) return cell;
  dropCollider(world, config, volume, cell);
  const sink = world.physics;
  if (want === 0 || sink === undefined) return { ...cell, solid: 0, top: 0, collider: 0 };
  const { min, max } = footprintOf(config, volume, cell);
  const handle = sink.add(
    box({ x: min.x, y: top - want, z: min.z }, { x: max.x, y: top, z: max.z }),
  );
  (sink as Partial<RigidBodyPort>).setMaterial?.(handle, {
    friction: config.iceFriction,
    restitution: 0,
  });
  return { ...cell, solid: want, top, collider: handle };
}

const key = (ix: number, iz: number): number => ix * 65_536 + iz;

/** One tick of a volume's surface: exposures, relaxation, growth and melt, colliders. */
function stepVolume(
  world: World<never>,
  config: FreezeConfig,
  entity: EntityId,
  volume: LiquidVolume,
  ice: LiquidIce,
  airAt: (x: number, y: number, z: number) => number,
  hz: number,
): void {
  const top = volume.layers.at(-1);
  if (top === undefined) {
    for (const cell of ice.cells) dropCollider(world, config, volume, cell);
    world.set(entity, LiquidIceComponent, { cells: [], pending: [] });
    return;
  }
  const freezePoint = readProperty(world, top.entity, 'freezePoint');
  const surface = levelOf(volume);
  const depthCap = Math.min(config.maxThickness, totalDepth(volume));
  const nx = Math.ceil((volume.max.x - volume.min.x) / config.cellSize);
  const nz = Math.ceil((volume.max.z - volume.min.z) / config.cellSize);
  const cells = new Map<number, IceCell>();
  for (const cell of ice.cells) cells.set(key(cell.ix, cell.iz), cell);
  const point = (ix: number, iz: number) => ({
    x: volume.min.x + (ix + 0.5) * config.cellSize,
    y: surface,
    z: volume.min.z + (iz + 0.5) * config.cellSize,
  });
  for (const exposure of ice.pending) {
    for (let ix = 0; ix < nx; ix++) {
      for (let iz = 0; iz < nz; iz++) {
        const reach =
          exposure.shape.kind === 'contact'
            ? 1
            : shapeFalloff(exposure.shape, exposure.falloff, point(ix, iz), config.cellSize / 2);
        if (reach === undefined) continue;
        const cell = cells.get(key(ix, iz)) ?? {
          ix,
          iz,
          offset: 0,
          thickness: 0,
          solid: 0,
          top: 0,
          collider: 0,
        };
        cells.set(key(ix, iz), { ...cell, offset: cell.offset + exposure.delta * reach });
      }
    }
  }
  const dt = 1 / hz;
  const keep = 1 - config.relaxPerSecond * dt;
  const next: IceCell[] = [];
  for (const cell of [...cells.values()].sort((a, b) => a.ix - b.ix || a.iz - b.iz)) {
    const offset = cell.offset * keep;
    const at = point(cell.ix, cell.iz);
    const temperature = airAt(at.x, at.y, at.z) + offset;
    const degrees = freezePoint - temperature; // > 0 below the freeze point
    const thickness = Math.min(
      depthCap,
      Math.max(
        0,
        cell.thickness +
          (degrees > 0 ? config.growthPerDegree : config.meltPerDegree) * degrees * dt,
      ),
    );
    const synced = syncCollider(
      world,
      config,
      volume,
      { ...cell, offset, thickness },
      solidThickness(config, thickness),
      surface,
    );
    if (thickness > 0 || Math.abs(offset) >= config.epsilon) next.push(synced);
  }
  world.set(entity, LiquidIceComponent, { cells: next, pending: [] });
}

/**
 * Makes `world` freeze liquid surfaces: cold and heat stimuli that reach a volume wait on it for the
 * surface rule, which spreads them over its cells (the stimulus API is the only way in, so nothing
 * names a spell), and a volume that goes takes its ice colliders with it. Call once at setup, after
 * `installLiquids`, wherever `freezeRules` run (without those rules the waiting exposures would
 * never be consumed).
 */
export function installIce<W extends World<never>>(world: W): W {
  world.events.on(stimulusResolved, ({ stimulus, amount }) => {
    const sign = temperatureSign(stimulus.element);
    if (sign === 0 || !(amount > 0)) return;
    const { shape } = stimulus;
    const reach = shapeBounds(shape);
    const exposure: IceExposure = {
      shape,
      falloff: stimulus.falloff,
      delta: sign * amount,
    };
    const hit: [EntityId, LiquidIce][] = [];
    world.query(LiquidVolumeComponent, LiquidIceComponent).forEach((entity, volume, ice) => {
      const touched =
        reach === undefined
          ? shape.kind === 'contact' &&
            (shape.target === entity ||
              volume.layers.some((layer) => layer.entity === shape.target))
          : reach.max.x >= volume.min.x &&
            reach.min.x <= volume.max.x &&
            reach.max.y >= volume.min.y &&
            reach.min.y <= volume.max.y &&
            reach.max.z >= volume.min.z &&
            reach.min.z <= volume.max.z;
      if (touched) hit.push([entity, ice]);
    });
    for (const [entity, ice] of hit) {
      world.set(entity, LiquidIceComponent, { ...ice, pending: [...ice.pending, exposure] });
    }
  });
  world.onRemove(LiquidIceComponent, (_entity, ice) => {
    const sink = world.physics;
    if (sink === undefined) return;
    for (const cell of ice.cells) {
      if (cell.collider !== 0 && sink.has(cell.collider as ColliderHandle)) {
        sink.remove(cell.collider as ColliderHandle);
      }
    }
  });
  return world;
}

/** The surface rule: see the file header. */
function surfaceRule(config: FreezeConfig): ElementRule {
  return {
    id: 'ice.surface',
    phase: 'transition',
    run: ({ world, field, hz }) => {
      const found: [EntityId, LiquidVolume, LiquidIce][] = [];
      world.query(LiquidVolumeComponent, LiquidIceComponent).forEach((entity, volume, ice) => {
        if (ice.cells.length > 0 || ice.pending.length > 0) found.push([entity, volume, ice]);
      });
      const air = (x: number, y: number, z: number): number =>
        field.readAt('temperature', { x, y, z });
      for (const [entity, volume, ice] of found) {
        stepVolume(world, config, entity, volume, ice, air, hz);
      }
    },
  };
}

/** Writes a frozen thing's state (added at the end of the tick when it has none yet). */
function remember(world: World<never>, entity: EntityId, state: FreezeState): void {
  if (world.has(entity, FreezeStateComponent)) world.set(entity, FreezeStateComponent, state);
  else world.add(entity, FreezeStateComponent, state);
}

function thingsRule(config: FreezeConfig): ElementRule {
  return {
    id: 'freeze.things',
    phase: 'exchange',
    run: ({ world }) => {
      const cold: EntityId[] = [];
      const warm: EntityId[] = [];
      world.query(WorldProperties.temperature).forEach((entity, temperature) => {
        const freezePoint = readProperty(world, entity, 'freezePoint');
        if (readProperty(world, entity, 'frozen')) {
          const state = world.get(entity, FreezeStateComponent);
          if (temperature > freezePoint || (state?.absorbed ?? 0) > 0) warm.push(entity);
        } else if (
          temperature <= freezePoint &&
          readProperty(world, entity, 'wetness') >= config.wetThreshold &&
          !readProperty(world, entity, 'liquid') &&
          !readProperty(world, entity, 'burning')
        ) {
          cold.push(entity);
        }
      });
      for (const entity of cold) {
        const friction = readProperty(world, entity, 'friction');
        const slick = friction > config.iceFriction;
        assignProperty(world, entity, 'frozen', true);
        if (slick) assignProperty(world, entity, 'friction', config.iceFriction);
        remember(world, entity, { friction: slick ? friction : -1, absorbed: 0 });
      }
      for (const entity of warm) {
        const temperature = readProperty(world, entity, 'temperature');
        const freezePoint = readProperty(world, entity, 'freezePoint');
        const state = world.get(entity, FreezeStateComponent) ?? { friction: -1, absorbed: 0 };
        if (temperature <= freezePoint) {
          // It chilled again before it melted: the melt starts over.
          remember(world, entity, { ...state, absorbed: 0 });
          continue;
        }
        const absorbed = state.absorbed + (temperature - freezePoint);
        const need =
          config.fusionHeat * Math.max(readProperty(world, entity, 'wetness'), config.wetThreshold);
        if (absorbed < need) {
          setProperty(world, entity, 'temperature', freezePoint);
          remember(world, entity, { ...state, absorbed });
          continue;
        }
        setProperty(world, entity, 'frozen', false);
        setProperty(world, entity, 'temperature', clampTemperature(freezePoint + absorbed - need));
        if (state.friction >= 0) assignProperty(world, entity, 'friction', state.friction);
        if (world.has(entity, FreezeStateComponent)) world.remove(entity, FreezeStateComponent);
      }
    },
  };
}

/**
 * The freeze rules: the surface ice of liquid volumes (transition phase) and the freezing and
 * thawing of wet objects (exchange phase). Add them after `fireRules` and before `liquidRules`, so a
 * wet object freezes (and stops drying) in the tick its stimulus lands, before water.dry runs. Throws
 * a RangeError for an invalid config.
 */
export function freezeRules(config: Partial<FreezeConfig> = {}): ElementRule[] {
  const resolved = resolveFreezeConfig(config);
  return [surfaceRule(resolved), thingsRule(resolved)];
}
