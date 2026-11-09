import { describe, expect, it } from 'vitest';
import { CHUNK_CELLS, CONDUCTIVITY_ONE, FIXED_ONE } from './config';
import { cellIndex, ElementField, type CellCoord } from './grid';

const c = (x: number, y = 0, z = 0): CellCoord => ({ x, y, z });

/** Bounds covering the centres of cells lo…hi. */
function cells(field: ElementField, lo: CellCoord, hi: CellCoord) {
  return { min: field.cellCenter(lo), max: field.cellCenter(hi) };
}

describe('ElementField coordinates', () => {
  it('maps points to cells by floor, including negatives, without -0', () => {
    const field = new ElementField();
    expect(field.cellOf({ x: 0.2, y: -0.2, z: 1.0 })).toEqual({ x: 0, y: -1, z: 2 });
    expect(Object.is(field.cellOf({ x: -0, y: 0, z: 0 }).x, 0)).toBe(true);
    expect(field.cellCenter(c(-1, 0, 2))).toEqual({ x: -0.25, y: 0.25, z: 1.25 });
    expect(cellIndex(1, 2, 3)).toBe(1 + 8 * 2 + 64 * 3);
  });

  it('visits cells whose centres lie in bounds, inclusive, x outermost', () => {
    const field = new ElementField();
    const seen: CellCoord[] = [];
    field.forCellsIn(cells(field, c(0), c(1, 0, 1)), (cell) => seen.push(cell));
    expect(seen).toEqual([c(0, 0, 0), c(0, 0, 1), c(1, 0, 0), c(1, 0, 1)]);
  });
});

describe('ElementField values', () => {
  it('reads ambient where nothing is stored and allocates chunks only on write', () => {
    const field = new ElementField();
    expect(field.read('temperature', c(5))).toBe(20);
    expect(field.readAt('gas:smoke', { x: 1, y: 1, z: 1 })).toBe(0);
    expect(field.chunkCount).toBe(0);
    expect(field.chunkState(c(5))).toBe('absent');
    expect(field.add('temperature', c(5), 10)).toBe(true);
    expect(field.read('temperature', c(5))).toBe(30);
    expect(field.chunkCount).toBe(1);
    expect(field.chunkState(c(5))).toBe('awake');
    expect(field.set('moisture', c(-1), 0.25)).toBe(true);
    expect(field.read('moisture', c(-1))).toBe(0.25);
    expect(field.addAt('charge', { x: 0, y: 0, z: 0 }, 2)).toBe(true);
    expect(field.channels()).toEqual(['charge', 'moisture', 'temperature']);
    expect(field.total('temperature')).toBe(10);
    expect(field.total('gas:smoke')).toBe(0);
  });

  it('clamps writes to the channel range', () => {
    const field = new ElementField();
    field.add('moisture', c(0), 5);
    expect(field.read('moisture', c(0))).toBe(1);
    field.set('temperature', c(0), -1000);
    expect(field.read('temperature', c(0))).toBeCloseTo(-273.15, 4);
  });

  it('rejects non-finite amounts and unknown channels', () => {
    const field = new ElementField();
    expect(() => field.add('temperature', c(0), NaN)).toThrow(RangeError);
    expect(() => field.set('temperature', c(0), Infinity)).toThrow(RangeError);
    expect(() => field.add('heat' as 'charge', c(0), 1)).toThrow(/unknown field channel/);
  });

  it('refuses writes into walls and past the chunk cap', () => {
    const field = new ElementField({ maxChunks: 1 });
    expect(field.setConductivity(cells(field, c(0), c(0)), 0)).toBe(true);
    expect(field.add('temperature', c(0), 5)).toBe(false);
    expect(field.add('temperature', c(1), 5)).toBe(true);
    expect(field.add('temperature', c(100), 5)).toBe(false);
    expect(field.setConductivity(cells(field, c(100), c(100)), 0)).toBe(false);
    expect(field.chunkCount).toBe(1);
  });
});

describe('ElementField chunk links', () => {
  it('links face neighbours both ways as chunks come and go', () => {
    const field = new ElementField();
    const a = field.allocate(0, 0, 0);
    const east = field.allocate(1, 0, 0);
    const up = field.allocate(0, 1, 0);
    const far = field.allocate(5, 5, 5);
    if (!a || !east || !up || !far) throw new Error('allocation refused');
    expect(a.links).toEqual([east, undefined, up, undefined, undefined, undefined]);
    expect(east.links[1]).toBe(a); // -x of the east chunk is the first one
    expect(up.links[3]).toBe(a); // -y of the upper chunk
    expect(far.links.every((link) => link === undefined)).toBe(true);
    field.release(a);
    expect(east.links[1]).toBeUndefined();
    expect(up.links[3]).toBeUndefined();
    const again = field.allocate(0, 0, 0);
    expect(again?.links[0]).toBe(east);
    expect(east.links[1]).toBe(again);
  });
});

describe('ElementField conductivity', () => {
  it('stores per-cell conductivity; walls drop what they held', () => {
    const field = new ElementField();
    expect(field.conductivity(c(3))).toBe(1);
    field.add('temperature', c(3), 50);
    field.setConductivity(cells(field, c(3), c(3)), 0.5);
    expect(field.conductivity(c(3))).toBe(0.5);
    expect(field.conductivity(c(4))).toBe(1);
    expect(field.read('temperature', c(3))).toBe(70);
    field.setConductivity(cells(field, c(3), c(3)), 0);
    expect(field.conductivity(c(3))).toBe(0);
    expect(field.read('temperature', c(3))).toBe(20);
    expect(() => field.setConductivity(cells(field, c(0), c(0)), 1.5)).toThrow(RangeError);
    expect(() => field.setConductivity(cells(field, c(0), c(0)), NaN)).toThrow(RangeError);
  });
});

describe('ElementField serialization', () => {
  it('round-trips plain, sorted, sparse data', () => {
    const field = new ElementField({ gases: { smoke: { decay: 0.1 } } });
    field.add('temperature', c(9, 0, 0), 5);
    field.add('gas:smoke', c(-9, 0, 0), 0.5);
    field.add('charge', c(-9, 0, 0), 1);
    field.add('moisture', c(0), 0.5);
    field.add('moisture', c(0), -0.5); // back to ambient: omitted
    field.setConductivity(cells(field, c(1), c(1)), 0);
    const data = field.serialize();
    expect(data.chunks.map((chunk) => chunk.at)).toEqual([
      [-2, 0, 0],
      [0, 0, 0],
      [1, 0, 0],
    ]);
    expect(data.chunks[0]?.layers.map(([name]) => name)).toEqual(['charge', 'gas:smoke']);
    expect(data.chunks[1]?.layers).toEqual([]);
    expect(data.chunks[1]?.conductivity).toEqual([1, 0]);
    expect(data.chunks[2]?.layers).toEqual([['temperature', [1, 5 * FIXED_ONE]]]);
    const copy = ElementField.deserialize(structuredClone(data));
    expect(copy.serialize()).toEqual(data);
    expect(copy.read('temperature', c(9))).toBe(25);
    expect(copy.conductivity(c(1))).toBe(0);
  });

  const good = () => new ElementField().serialize();
  const chunk = (over: Record<string, unknown>) => ({
    config: good().config,
    chunks: [{ at: [0, 0, 0], calm: 0, asleep: false, conductivity: [], layers: [], ...over }],
  });
  const bad: [string, unknown][] = [
    ['null', null],
    ['no config', { chunks: [] }],
    ['no chunks', { config: good().config }],
    ['bad config', { config: { cellSize: -1 }, chunks: [] }],
    ['null chunk', { config: good().config, chunks: [null] }],
    ['bad coords', chunk({ at: [0, 0] })],
    ['non-array coords', chunk({ at: 'x' })],
    ['fractional coords', chunk({ at: [0, 0.5, 0] })],
    ['bad calm', chunk({ calm: -1 })],
    ['non-integer calm', chunk({ calm: 'x' })],
    ['bad asleep', chunk({ asleep: 1 })],
    ['bad layers', chunk({ layers: {} })],
    ['odd conductivity', chunk({ conductivity: [1] })],
    ['missing conductivity', chunk({ conductivity: undefined })],
    ['conductivity out of range', chunk({ conductivity: [0, CONDUCTIVITY_ONE + 1] })],
    ['negative conductivity', chunk({ conductivity: [0, -1] })],
    ['unsorted index', chunk({ conductivity: [2, 0, 1, 0] })],
    ['index past chunk', chunk({ conductivity: [CHUNK_CELLS, 0] })],
    ['bad layer entry', chunk({ layers: [[1, []]] })],
    ['non-array layer entry', chunk({ layers: ['temperature'] })],
    ['bad channel', chunk({ layers: [['heat', []]] })],
    [
      'duplicate layer',
      chunk({
        layers: [
          ['charge', [0, 1]],
          ['charge', [1, 1]],
        ],
      }),
    ],
    ['value out of range', chunk({ layers: [['moisture', [0, 2 * FIXED_ONE]]] })],
    ['value below range', chunk({ layers: [['moisture', [0, -1]]] })],
    ['fractional value', chunk({ layers: [['moisture', [0, 0.5]]] })],
    ['asleep with values', chunk({ asleep: true, layers: [['moisture', [0, 1]]] })],
  ];
  it.each(bad)('rejects %s', (_, data) => {
    expect(() => ElementField.deserialize(data)).toThrow(RangeError);
  });

  it('rejects duplicate chunks and more chunks than the cap', () => {
    const base = chunk({});
    const twice = { ...base, chunks: [...base.chunks, ...base.chunks] };
    expect(() => ElementField.deserialize(twice)).toThrow(/duplicate chunk/);
    const capped = {
      config: { ...base.config, maxChunks: 1 },
      chunks: [...base.chunks, { ...base.chunks[0], at: [1, 0, 0] }],
    };
    expect(() => ElementField.deserialize(capped)).toThrow(/maxChunks/);
  });
});
