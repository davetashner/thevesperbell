// The field debug overlay's model (mw-e03.29): what to draw and print, built from sim reads only.
// Pure functions over the public query API (ElementField reads, LightField.levelAt, property
// reads, the signal graph components, the stimulus log). Nothing here writes the sim, and nothing
// runs unless the overlay is on (see controller.ts).

import { MAX_FIELD_CELLS, type CellMark } from '@render/debug/field-overlay';
import {
  CHUNK_SIZE,
  FIXED_ONE,
  gasOf,
  hasProperty,
  PlacementComponent,
  readProperty,
  SignalGraphComponent,
  WORLD_PROPERTY_KEYS,
  type ElementField,
  type EntityId,
  type StimulusResolution,
  type Vec3,
  type World,
} from '@sim/index';

/** The layers the overlay can draw. */
export const FIELD_LAYERS = ['temperature', 'moisture', 'gas', 'charge', 'light'] as const;

export type FieldLayer = (typeof FIELD_LAYERS)[number];

export { MAX_FIELD_CELLS, type CellMark };
/** Cells farther than this from the viewer are not drawn, metres. */
export const FIELD_RANGE = 20;
/** The light grid is (2 × LIGHT_RADIUS + 1)² samples, one per metre. */
export const LIGHT_RADIUS = 7;
/** Stimulus resolutions listed in the panel. */
export const STIMULUS_LINES = 6;
/** How near the crosshair ray must pass to pick an entity, metres, besides its own radius. */
export const PICK_SLACK = 0.4;

/** A layer's cells and the numbers its legend prints. */
export interface LayerView {
  readonly layer: FieldLayer;
  readonly cells: readonly CellMark[];
  /** Largest magnitude among the cells (absolute value of the shown quantity), 0 for none. */
  readonly peak: number;
  readonly unit: string;
  /** More cells qualified than MAX_FIELD_CELLS, so the farthest were dropped. */
  readonly truncated: boolean;
}

interface Scale {
  /** Deviation below which a cell is not drawn. */
  readonly floor: number;
  /** The least deviation drawn at full strength: a view scales to its own peak, but not below this. */
  readonly full: number;
  readonly unit: string;
}

const SCALES: Readonly<Record<Exclude<FieldLayer, 'light'>, Scale>> = {
  temperature: { floor: 5, full: 50, unit: '°C vs ambient' },
  moisture: { floor: 0.02, full: 1, unit: 'wet' },
  gas: { floor: 0.02, full: 1, unit: 'density' },
  charge: { floor: 0.5, full: 20, unit: 'charge' },
};

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** `rgb` (0xRRGGBB) scaled to `strength` of full brightness: a weak cell is a dim colour. */
export function scaled(rgb: number, strength: number): number {
  const s = 0.15 + 0.85 * clamp01(strength);
  const r = Math.round(((rgb >> 16) & 255) * s);
  const g = Math.round(((rgb >> 8) & 255) * s);
  const b = Math.round((rgb & 255) * s);
  return (r << 16) | (g << 8) | b;
}

const HOT = 0xff4a10;
const COLD = 0x30a0ff;
const WET = 0x2060ff;
const GAS = 0xa0c0a0;
const CHARGE = 0xe8e020;

function colourOf(layer: Exclude<FieldLayer, 'light'>, value: number, strength: number): number {
  switch (layer) {
    case 'temperature':
      return scaled(value > 0 ? HOT : COLD, strength);
    case 'moisture':
      return scaled(WET, strength);
    case 'gas':
      return scaled(GAS, strength);
    case 'charge':
      return scaled(CHARGE, strength);
  }
}

const distance = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * The cells of a field layer within FIELD_RANGE of `viewer`, the nearest MAX_FIELD_CELLS of them,
 * ordered by distance then position (deterministic). Reads each chunk's stored deviations from
 * ambient; a chunk that sleeps holds none, so it draws nothing. The gas layer shows the thickest
 * gas of each cell.
 */
export function fieldLayerView(
  field: ElementField,
  layer: Exclude<FieldLayer, 'light'>,
  viewer: Vec3,
): LayerView {
  const scale = SCALES[layer];
  const wanted = (channel: string): boolean =>
    layer === 'gas' ? gasOf(channel as never) !== undefined : channel === layer;
  const found = new Map<string, { cell: Vec3; value: number; distance: number }>();
  for (const chunk of field.chunkList()) {
    for (const [channel, values] of chunk.layers) {
      if (!wanted(channel)) continue;
      values.forEach((raw, i) => {
        const value = raw / FIXED_ONE;
        if (Math.abs(value) < scale.floor) return;
        const cell = {
          x: chunk.cx * CHUNK_SIZE + (i % CHUNK_SIZE),
          y: chunk.cy * CHUNK_SIZE + (Math.floor(i / CHUNK_SIZE) % CHUNK_SIZE),
          z: chunk.cz * CHUNK_SIZE + Math.floor(i / (CHUNK_SIZE * CHUNK_SIZE)),
        };
        const centre = field.cellCenter(cell);
        const d = distance(centre, viewer);
        if (d > FIELD_RANGE) return;
        const key = `${String(cell.x)},${String(cell.y)},${String(cell.z)}`;
        const old = found.get(key);
        if (old === undefined || Math.abs(value) > Math.abs(old.value)) {
          found.set(key, { cell, value, distance: d });
        }
      });
    }
  }
  const ordered = [...found.values()].sort(
    (a, b) =>
      a.distance - b.distance || a.cell.x - b.cell.x || a.cell.y - b.cell.y || a.cell.z - b.cell.z,
  );
  const size = field.config.cellSize * 0.92;
  const kept = ordered.slice(0, MAX_FIELD_CELLS);
  const peak = ordered.reduce((most, { value }) => Math.max(most, Math.abs(value)), 0);
  // Strength is relative to the view's own peak, on a square-root curve, so a 600 degree fire still
  // shows its gradient and its thin edge.
  const full = Math.max(peak, scale.full);
  return {
    layer,
    cells: kept.map(({ cell, value }) => {
      const centre = field.cellCenter(cell);
      return {
        ...centre,
        size,
        height: size,
        colour: colourOf(layer, value, Math.sqrt(Math.abs(value) / full)),
        value,
      };
    }),
    peak,
    unit: scale.unit,
    truncated: ordered.length > kept.length,
  };
}

const DARK = 0x101840;
const LIT = 0xffe060;

function lightColour(level: number): number {
  const t = clamp01(level);
  const mix = (a: number, b: number): number => Math.round(a + (b - a) * t);
  const r = mix((DARK >> 16) & 255, (LIT >> 16) & 255);
  const g = mix((DARK >> 8) & 255, (LIT >> 8) & 255);
  const b = mix(DARK & 255, LIT & 255);
  return (r << 16) | (g << 8) | b;
}

/**
 * The light level on a metre grid of (2 × LIGHT_RADIUS + 1)² flat tiles around `centre`, at the
 * height of `centre` (a floor point: the tiles float 0.1 m above it).
 */
export function lightLayerView(light: { levelAt(point: Vec3): number }, centre: Vec3): LayerView {
  const cx = Math.floor(centre.x) + 0.5;
  const cz = Math.floor(centre.z) + 0.5;
  const cells: CellMark[] = [];
  let peak = 0;
  for (let dx = -LIGHT_RADIUS; dx <= LIGHT_RADIUS; dx++) {
    for (let dz = -LIGHT_RADIUS; dz <= LIGHT_RADIUS; dz++) {
      const point = { x: cx + dx, y: centre.y + 0.1, z: cz + dz };
      const level = light.levelAt(point);
      peak = Math.max(peak, level);
      cells.push({ ...point, size: 0.9, height: 0.04, colour: lightColour(level), value: level });
    }
  }
  return { layer: 'light', cells, peak, unit: 'level 0-1', truncated: false };
}

/** A value as the inspector prints it: numbers to 3 decimals, records as compact JSON. */
export function formatValue(value: unknown): string {
  if (typeof value === 'number') return String(Math.round(value * 1000) / 1000);
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value, (_key, v: unknown) =>
      typeof v === 'number' ? Math.round(v * 1000) / 1000 : v,
    );
  }
  return String(value);
}

/** One property row of the inspector. */
export interface PropertyRow {
  readonly key: string;
  readonly value: string;
}

/** An entity's properties as the inspector lists them, or undefined for a dead entity. */
export function inspectRows(world: World<never>, entity: EntityId): PropertyRow[] | undefined {
  if (!world.isAlive(entity)) return undefined;
  const rows: PropertyRow[] = [];
  for (const key of WORLD_PROPERTY_KEYS) {
    if (!hasProperty(world, entity, key)) continue;
    rows.push({ key, value: formatValue(readProperty(world, entity, key)) });
  }
  return rows;
}

/** One stimulus resolution as a panel line. */
export function stimulusLine(entry: StimulusResolution): string {
  const { stimulus, hits } = entry;
  const where = 'center' in stimulus.shape ? stimulus.shape.center : undefined;
  const at =
    where === undefined
      ? ''
      : ` @${formatValue(where.x)},${formatValue(where.y)},${formatValue(where.z)}`;
  return `t${String(entry.tick)} ${stimulus.element} ${formatValue(entry.amount)} ${stimulus.shape.kind}${at} -> ${String(hits.length)} hit`;
}

/** The newest `count` resolutions as panel lines, newest first. */
export function stimulusLines(
  entries: readonly StimulusResolution[],
  count = STIMULUS_LINES,
): string[] {
  return entries.slice(-count).reverse().map(stimulusLine);
}

/** Live signal wires: each placed graph's output ports with their current values. */
export function wireLines(world: World<never>): string[] {
  if (!world.isRegistered(SignalGraphComponent)) return [];
  const lines: string[] = [];
  world.query(SignalGraphComponent).forEach((id, graph) => {
    const outputs = Object.entries(graph.outputs).sort(([a], [b]) => a.localeCompare(b));
    const on = outputs.filter(([, value]) => value).map(([key]) => key);
    lines.push(
      `#${String(id)} ${graph.graph.id}: ${String(graph.graph.wires.length)} wires, ${String(on.length)}/${String(outputs.length)} on${on.length === 0 ? '' : ` (${on.join(' ')})`}`,
    );
  });
  return lines;
}

/** A placed entity, for picking. */
export interface Pickable {
  readonly entity: EntityId;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
}

/** A ray: unit `direction`. */
export interface Ray {
  readonly origin: Vec3;
  readonly direction: Vec3;
}

/** Every placed entity that holds at least one world property, ascending id. */
export function pickables(world: World<never>): Pickable[] {
  if (!world.isRegistered(PlacementComponent)) return [];
  const found: Pickable[] = [];
  world.query(PlacementComponent).forEach((entity, p) => {
    if (WORLD_PROPERTY_KEYS.some((key) => hasProperty(world, entity, key))) {
      found.push({ entity, x: p.x, y: p.y, z: p.z, radius: p.radius });
    }
  });
  return found;
}

/**
 * The entity `ray` points at: of those whose bounding sphere (grown by PICK_SLACK) it passes
 * through in front of its origin, the nearest along the ray; undefined for none.
 */
export function pickEntity(ray: Ray, candidates: readonly Pickable[]): EntityId | undefined {
  let best: EntityId | undefined;
  let bestT = Infinity;
  const { origin: o, direction: d } = ray;
  for (const c of candidates) {
    const t = (c.x - o.x) * d.x + (c.y - o.y) * d.y + (c.z - o.z) * d.z;
    if (t <= 0 || t >= bestT) continue;
    const reach = c.radius + PICK_SLACK;
    const dx = o.x + d.x * t - c.x;
    const dy = o.y + d.y * t - c.y;
    const dz = o.z + d.z * t - c.z;
    if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
    bestT = t;
    best = c.entity;
  }
  return best;
}
