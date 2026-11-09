import { describe, expect, it } from 'vitest';
import type { FieldConfigInput } from './config';
import { stepField, type FieldStepReport } from './diffusion';
import { ElementField, type CellCoord } from './grid';

const c = (x: number, y = 0, z = 0): CellCoord => ({ x, y, z });

/**
 * A field without temperature's default ambient loss (so heat totals are exactly conserved) and with
 * a fine epsilon (so small tails still spill into neighbouring chunks): the bare kernel.
 */
const lossless = (input: FieldConfigInput = {}) =>
  new ElementField({ ...input, temperature: { decay: 0, epsilon: 0.05 } });

function cells(field: ElementField, lo: CellCoord, hi: CellCoord) {
  return { min: field.cellCenter(lo), max: field.cellCenter(hi) };
}

function run(field: ElementField, ticks: number): FieldStepReport[] {
  const reports: FieldStepReport[] = [];
  for (let i = 0; i < ticks; i++) reports.push(stepField(field));
  return reports;
}

/** Every channel value in a cube of cells, for comparing fields. */
function dump(field: ElementField, r: number, channel: 'temperature' | 'moisture' = 'temperature') {
  const values: number[] = [];
  field.forCellsIn(cells(field, c(-r, -r, -r), c(r, r, r)), (cell) =>
    values.push(field.read(channel, cell)),
  );
  return values;
}

/** Walls on the shell of the cube [-r, r]³ (cells). */
function room(field: ElementField, r: number): void {
  for (const axis of ['x', 'y', 'z'] as const) {
    for (const side of [-r, r]) {
      const lo = { x: -r, y: -r, z: -r, [axis]: side };
      const hi = { x: r, y: r, z: r, [axis]: side };
      field.setConductivity(cells(field, lo, hi), 0);
    }
  }
}

describe('stepField diffusion', () => {
  it('AC-1: a single hot cell in an open field conserves total heat over N ticks', () => {
    const field = lossless();
    field.add('temperature', c(0), 980);
    const reports = run(field, 120);
    const total = field.total('temperature');
    expect(Math.abs(total - 980) / 980).toBeLessThan(0.001);
    expect(total).toBe(980); // exact: fixed-point fluxes conserve every count
    expect(reports.every((r) => Object.keys(r.lost).length === 0)).toBe(true);
    expect(field.read('temperature', c(0))).toBeLessThan(25);
    expect(field.read('temperature', c(3))).toBeGreaterThan(20);
    expect(field.chunkCount).toBeGreaterThan(8); // spread across chunk boundaries
  });

  it('AC-1: once far chunks settle, heat + reported loss still equals the initial heat', () => {
    const field = new ElementField({ sleepTicks: 5 });
    field.add('temperature', c(0), 20);
    let lost = 0;
    for (const report of run(field, 80)) lost += report.lost['temperature'] ?? 0;
    expect(lost).toBeGreaterThan(0);
    expect(field.total('temperature') + lost).toBe(20);
  });

  it('AC-1: with ambient loss, initial heat = final heat + reported loss', () => {
    const field = new ElementField({ temperature: { decay: 0.01 } });
    field.add('temperature', c(7, 7, 7), 500);
    let lost = 0;
    for (const report of run(field, 100)) lost += report.lost['temperature'] ?? 0;
    expect(lost).toBeGreaterThan(0);
    expect(field.total('temperature') + lost).toBeCloseTo(500, 9);
  });

  it('AC-2: no quantity crosses a wall', () => {
    const field = lossless();
    room(field, 3);
    field.add('temperature', c(0), 1000);
    field.add('gas:marsh-gas', c(1, 1, 1), 1);
    field.add('moisture', c(-2, -2, -2), 1);
    // Fixed-point totals are exact, so a single count leaking through in any tick shows below; 100
    // ticks fill the room wall to wall (8 chunks awake, slow under coverage: keep it short).
    run(field, 100);
    for (const channel of ['temperature', 'gas:marsh-gas', 'moisture'] as const) {
      const initial = channel === 'temperature' ? 1000 : 1;
      let inside = 0;
      field.forCellsIn(cells(field, c(-2, -2, -2), c(2, 2, 2)), (cell) => {
        inside += field.read(channel, cell) - (channel === 'temperature' ? 20 : 0);
      });
      expect(inside).toBeCloseTo(initial, 9);
      expect(field.total(channel)).toBeCloseTo(initial, 9);
    }
    expect(field.read('temperature', c(4))).toBe(20);
    expect(field.read('temperature', c(-1, 2, 2))).toBeGreaterThan(20);
  });

  it('AC-3: a chunk within epsilon of ambient for 60 ticks sleeps and costs nothing until touched', () => {
    const field = lossless();
    field.setConductivity(cells(field, c(0), c(0)), 0); // geometry keeps the chunk allocated
    field.add('temperature', c(3, 3, 3), 0.01);
    field.add('temperature', c(4, 4, 4), -0.01); // cancels: settles with no net loss
    const before = run(field, 59);
    expect(before.every((r) => r.activeChunks === 1 && r.cellsUpdated > 0)).toBe(true);
    expect(field.chunkState(c(3, 3, 3))).toBe('awake');
    const sleeping = stepField(field);
    expect(sleeping.lost).toEqual({});
    expect(field.chunkState(c(3, 3, 3))).toBe('asleep');
    expect(field.read('temperature', c(3, 3, 3))).toBe(20);
    const idle = run(field, 10);
    expect(idle.every((r) => r.activeChunks === 0 && r.cellsUpdated === 0)).toBe(true);
    field.add('temperature', c(2), 5);
    expect(field.chunkState(c(2))).toBe('awake');
    expect(stepField(field).activeChunks).toBe(1);
  });

  it('frees a chunk without walls when it sleeps, reporting what settling removed', () => {
    const field = new ElementField({ sleepTicks: 2 });
    field.add('moisture', c(1), 0.0005);
    stepField(field);
    const report = stepField(field);
    expect(report.lost['moisture']).toBeGreaterThan(0);
    expect(field.chunkState(c(1))).toBe('absent');
    expect(field.chunkCount).toBe(0);
  });

  it('drops layers that return exactly to ambient', () => {
    const field = lossless();
    field.add('charge', c(0), 1);
    field.add('charge', c(0), -1);
    field.add('moisture', c(0), 0.5);
    stepField(field);
    expect(field.channels()).toEqual(['moisture']);
  });

  it('flux into a sleeping walled chunk wakes it', () => {
    const field = new ElementField({ sleepTicks: 1 });
    field.setConductivity(cells(field, c(12), c(12)), 0);
    stepField(field);
    expect(field.chunkState(c(8))).toBe('asleep');
    field.add('temperature', c(7), 100);
    stepField(field);
    expect(field.chunkState(c(8))).toBe('awake');
    expect(field.read('temperature', c(8))).toBeGreaterThan(20);
  });

  it('exchanges across a boundary where both chunks participate, and into chunks lacking the layer', () => {
    const field = lossless();
    field.add('temperature', c(7), 100);
    field.add('temperature', c(8), 50);
    field.add('moisture', c(-1), 0.5); // chunk -1 is awake but has no temperature layer
    field.add('temperature', c(0), 80);
    stepField(field);
    expect(field.total('temperature')).toBeCloseTo(230, 9);
    expect(field.read('temperature', c(-1))).toBeGreaterThan(20);
    expect(field.read('temperature', c(8))).toBeCloseTo(50, 1); // +5 from c(7), −25 to 5 others
  });

  it('treats a neighbour the chunk cap refuses as a wall', () => {
    const field = lossless({ maxChunks: 1 });
    field.add('temperature', c(7, 7, 7), 100);
    run(field, 50);
    expect(field.chunkCount).toBe(1);
    expect(field.total('temperature')).toBeCloseTo(100, 9);
  });

  it('does not diffuse channels with zero diffusion', () => {
    const field = new ElementField({ moisture: { diffusion: 0 } });
    field.add('moisture', c(0), 0.5);
    run(field, 5);
    expect(field.read('moisture', c(0))).toBe(0.5);
    expect(field.read('moisture', c(1))).toBe(0);
  });

  it('gives identical results whatever order cells were written and chunks allocated in', () => {
    const configs: FieldConfigInput = { moisture: { decay: 0.001 } };
    const a = new ElementField(configs);
    a.add('temperature', c(7, 1, 1), 300);
    a.add('temperature', c(8, 1, 1), -50);
    a.add('moisture', c(-3, 2, 0), 0.8);
    const b = new ElementField(configs);
    b.add('moisture', c(20), 0); // an extra, empty chunk and layer
    b.add('moisture', c(-3, 2, 0), 0.8);
    b.add('temperature', c(-9), 0);
    b.add('temperature', c(8, 1, 1), -50);
    b.add('temperature', c(7, 1, 1), 300);
    run(a, 40);
    run(b, 40);
    expect(dump(b, 12)).toEqual(dump(a, 12));
    expect(dump(b, 12, 'moisture')).toEqual(dump(a, 12, 'moisture'));
  });
});

describe('stepField kernel', () => {
  /** The textbook form of one tick on a single sealed chunk: every face from its own definition. */
  function reference(values: number[], rate: number, conductivity: number): number[] {
    const delta = new Array<number>(512).fill(0);
    const at = (x: number, y: number, z: number): number => x + 8 * (y + 8 * z);
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        for (let z = 0; z < 8; z++) {
          for (const [dx, dy, dz] of [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
          ] as const) {
            if (x + dx > 7 || y + dy > 7 || z + dz > 7) continue;
            const i = at(x, y, z);
            const j = at(x + dx, y + dy, z + dz);
            const a = values[i] ?? 0;
            const b = values[j] ?? 0;
            const flux = Math.trunc(((a - b) * rate * conductivity) / (4096 * 256));
            delta[i] = (delta[i] ?? 0) - flux;
            delta[j] = (delta[j] ?? 0) + flux;
          }
        }
      }
    }
    return values.map((v, i) => v + (delta[i] ?? 0));
  }

  it('matches the face-by-face definition on a sealed chunk, and conserves with a wall in it', () => {
    for (const walled of [false, true]) {
      // A sealed chunk (the cap walls it in), no loss, so one tick is only the interior kernel.
      const field = new ElementField({
        maxChunks: 1,
        temperature: {
          ambient: 0,
          min: -10000,
          max: 10000,
          diffusion: 0.1,
          decay: 0,
          epsilon: 1000,
        },
      });
      const cellAt = (i: number): CellCoord => c(i % 8, (i >> 3) % 8, i >> 6);
      const read = (): number[] =>
        Array.from({ length: 512 }, (_, i) =>
          Math.round(field.read('temperature', cellAt(i)) * 65536),
        );
      for (let i = 0; i < 512; i++) {
        // A lumpy, signed field with ties and sub-unit remainders.
        field.set(
          'temperature',
          cellAt(i),
          ((i * 7919) % 211) - 105 + (((i * 31) % 997) - 498) / 65536,
        );
      }
      if (walled) field.setConductivity(cells(field, c(3, 3, 3), c(3, 3, 3)), 0);
      const start = read();
      stepField(field);
      const after = read();
      if (walled) expect(after.reduce((x, y) => x + y, 0)).toBe(start.reduce((x, y) => x + y, 0));
      else expect(after).toEqual(reference(start, 410, 256));
    }
  });

  it('steps more chunks than the spare delta buffers it keeps', () => {
    // 2,100 chunks of two channels: 4,200 buffers in one tick, past the pool's limit of 4,096.
    const field = new ElementField({ maxChunks: 2100 });
    for (let i = 0; i < 2100; i++) {
      field.add('temperature', c(i * 8, 0, 0), 100);
      field.add('moisture', c(i * 8, 0, 0), 0.5);
    }
    const report = stepField(field);
    expect(report.activeChunks).toBe(2100);
    expect(stepField(field).activeChunks).toBe(2100); // and the next tick reuses what was kept
  });
});
