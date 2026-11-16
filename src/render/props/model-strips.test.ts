import { BufferAttribute, BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { MODEL_STRIPS, ruleRemoves, stripTriangles, type StripRule } from './model-strips';

/** Two triangles: one at the origin (a mast stand-in), one far from the axis, with a uv each. */
function twoTriangles(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute(
    'position',
    new BufferAttribute(
      new Float32Array([0, 0, 0, 0.1, 0, 0, 0, 0.1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0]),
      3,
    ),
  );
  g.setAttribute(
    'uv',
    new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 2),
  );
  g.setIndex([0, 1, 2, 3, 4, 5]);
  return g;
}

const everything: StripRule = { min: [-9, -9, -9], max: [9, 9, 9] };
const farFromAxis: StripRule = { ...everything, keep: { x: 0, z: 0, radius: 0.5 } };

describe('model strips (render only)', () => {
  it('a rule removes a triangle centred in its box, and keeps what lies outside the box', () => {
    expect(ruleRemoves(everything, 0, 0, 0)).toBe(true);
    expect(ruleRemoves(everything, 0, 9, 0)).toBe(false);
    expect(ruleRemoves(everything, -9.5, 0, 0)).toBe(false);
    expect(ruleRemoves(everything, 0, 0, 9)).toBe(false);
  });

  it('a rule with a kept axis spares what is within its radius', () => {
    expect(ruleRemoves(farFromAxis, 0.1, 0, 0)).toBe(false);
    expect(ruleRemoves(farFromAxis, 0.6, 0, 0)).toBe(true);
    expect(ruleRemoves(farFromAxis, 0, 0, 0.6)).toBe(true);
  });

  it('strips triangles and the vertices only they used, carrying every attribute', () => {
    const out = stripTriangles(twoTriangles(), [farFromAxis]);
    expect(out.getIndex()?.count).toBe(3);
    expect(out.getAttribute('position').count).toBe(3);
    expect(out.getAttribute('uv').count).toBe(3);
    out.computeBoundingBox();
    expect(out.boundingBox?.max.x).toBeCloseTo(0.1);
  });

  it('with no matching rule the geometry comes back whole', () => {
    const out = stripTriangles(twoTriangles(), []);
    expect(out.getIndex()?.count).toBe(6);
    expect(out.getAttribute('position').count).toBe(6);
  });

  it('refuses a geometry with no index', () => {
    expect(() => stripTriangles(new BufferGeometry(), [everything])).toThrow(/indexed/);
  });

  it('names the mast module and the hull, each with at least one cut', () => {
    for (const id of ['model-ship-gilded-tern-rigging-01', 'model-ship-gilded-tern-hull-01']) {
      expect(MODEL_STRIPS[id]?.length, id).toBeGreaterThan(0);
    }
  });
});
