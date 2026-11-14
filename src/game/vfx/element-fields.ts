// Gas field visualisation (mw-e03.28): smoke and steam in the element field drawn as cloud effects.
// The field is a grid of cells; this samples it a few times a second, picks the densest cells above
// a threshold near the camera (at most `cap` per gas, ties by cell position, so it is
// deterministic), and holds one looping cloud effect on each, sized to a cell and fuller where the
// gas is thicker. Cells that thin out or leave the nearest set release their effect.
//
// Presentation only: it reads the field through ElementField's read methods and never writes.

import type { ElementFieldRule } from '@content/index';
import { CHUNK_SIZE, FIXED_ONE, type ElementField, type Vec3 } from '@sim/index';
import type { VfxSpawner } from '../cues/vfx-bridge.ts';
import { at } from './indexing.ts';
import type { VfxHandle } from './system.ts';

export interface GasFieldOptions {
  readonly rules: readonly ElementFieldRule[];
  readonly vfx: Pick<VfxSpawner, 'spawn' | 'stop' | 'alive'>;
  /** The world's field, or undefined when none is installed yet. */
  readonly field: () => ElementField | undefined;
  readonly reducedMotion: () => boolean;
}

/** Seconds between samples of the field. */
export const GAS_SAMPLE_SECONDS = 0.25;
/** Cells farther than this from the camera are not drawn, metres. */
export const GAS_RANGE = 30;
/** Concentration bands: a cloud fills in as the gas thickens, so a band change respawns it. */
const BANDS = 3;

interface Cell {
  readonly key: string;
  readonly position: Vec3;
  readonly band: number;
  readonly distance: number;
}

/** Draws the field's gases. One per world. */
export class GasFieldPresenter {
  readonly #o: GasFieldOptions;
  /** `gas|x,y,z` → live cloud. */
  readonly #live = new Map<string, { handle: VfxHandle; band: number }>();
  #since = Infinity;

  constructor(options: GasFieldOptions) {
    this.#o = options;
  }

  /** Live clouds. */
  get clouds(): number {
    return this.#live.size;
  }

  /** Call every frame; samples the field every GAS_SAMPLE_SECONDS. */
  update(seconds: number, camera: Vec3): void {
    this.#since += seconds;
    if (this.#since < GAS_SAMPLE_SECONDS) return;
    this.#since = 0;
    const field = this.#o.field();
    const wanted = new Map<string, Cell & { rule: ElementFieldRule; scale: number }>();
    if (field !== undefined) {
      for (const rule of this.#o.rules) {
        for (const cell of denseCells(field, rule, camera)) {
          wanted.set(cell.key, {
            ...cell,
            rule,
            scale: field.config.cellSize / rule.referenceCell,
          });
        }
      }
    }
    for (const [key, cloud] of [...this.#live]) {
      const want = wanted.get(key);
      if (want?.band === cloud.band && this.#o.vfx.alive(cloud.handle)) continue;
      this.#o.vfx.stop(cloud.handle);
      this.#live.delete(key);
    }
    const reduced = this.#o.reducedMotion();
    for (const [key, cell] of wanted) {
      if (this.#live.has(key)) continue;
      const handle = this.#o.vfx.spawn(cell.rule.effect, {
        position: cell.position,
        scale: cell.scale,
        params: { intensity: (cell.band / BANDS) * (reduced ? 0.5 : 1) },
      });
      if (handle !== null) this.#live.set(key, { handle, band: cell.band });
    }
  }
}

/** The densest cells of a gas above its threshold within range, capped, in deterministic order. */
function denseCells(field: ElementField, rule: ElementFieldRule, camera: Vec3): Cell[] {
  const channel = `gas:${rule.gas}` as const;
  const cells: (Cell & { density: number })[] = [];
  for (const chunk of field.chunkList()) {
    const layer = chunk.layers.get(channel);
    if (layer === undefined) continue;
    for (let i = 0; i < layer.length; i++) {
      const density = at(layer, i) / FIXED_ONE;
      if (density < rule.threshold) continue;
      const lx = i % CHUNK_SIZE;
      const ly = Math.floor(i / CHUNK_SIZE) % CHUNK_SIZE;
      const lz = Math.floor(i / (CHUNK_SIZE * CHUNK_SIZE));
      const cell = {
        x: chunk.cx * CHUNK_SIZE + lx,
        y: chunk.cy * CHUNK_SIZE + ly,
        z: chunk.cz * CHUNK_SIZE + lz,
      };
      const position = field.cellCenter(cell);
      const distance = Math.hypot(
        position.x - camera.x,
        position.y - camera.y,
        position.z - camera.z,
      );
      if (distance > GAS_RANGE) continue;
      const band = Math.min(
        BANDS,
        1 + Math.floor(((density - rule.threshold) / (1 - rule.threshold)) * BANDS),
      );
      cells.push({
        key: `${rule.gas}|${String(cell.x)},${String(cell.y)},${String(cell.z)}`,
        position,
        band,
        distance,
        density,
      });
    }
  }
  cells.sort(
    (a, b) => b.density - a.density || a.distance - b.distance || a.key.localeCompare(b.key),
  );
  return cells.slice(0, rule.cap);
}
