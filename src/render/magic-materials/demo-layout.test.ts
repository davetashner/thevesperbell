import { describe, expect, it } from 'vitest';
import {
  DEMO_SLOTS,
  DISSOLVE_LOOP_SECONDS,
  DISSOLVE_STAGES,
  HAZE_COUNT,
  dissolveLoop,
  hazePlacements,
  focusItems,
  parseFocusParam,
  parseMagicParam,
  parseQualityParam,
  slotPosition,
  STAGE_FORWARD,
  STAGE_ORIGIN,
  cameraPose,
} from './demo-layout';

function slotOf(item: string) {
  const slot = DEMO_SLOTS.find((s) => s.item === item);
  if (slot === undefined) throw new Error(`no slot ${item}`);
  return slot;
}

describe('magic demo', () => {
  it('AC-1: ?magic selects the materials scene, ?magic=haze the perf scene, nothing otherwise', () => {
    expect(parseMagicParam('?scene=testbed')).toBeUndefined();
    expect(parseMagicParam('?magic')).toBe('materials');
    expect(parseMagicParam('?magic=materials')).toBe('materials');
    expect(parseMagicParam('?magic=haze')).toBe('haze');
    expect(parseMagicParam('?magic=nonsense')).toBe('materials');
  });

  it('AC-2: ?quality=low forces the Low tier; unknown values use the setting', () => {
    expect(parseQualityParam('?quality=low')).toBe('low');
    expect(parseQualityParam('?quality=high')).toBe('high');
    expect(parseQualityParam('?quality=ultra')).toBeUndefined();
    expect(parseQualityParam('')).toBeUndefined();
  });

  it('the scene shows every material once, plus a hard-edged puff to compare with', () => {
    const items = DEMO_SLOTS.map((slot) => slot.item);
    expect(new Set(items).size).toBe(items.length);
    for (const item of ['fresnel', 'pulse', 'rune', 'haze', 'soft', 'hard', 'dissolve-live']) {
      expect(items).toContain(item);
    }
    expect(
      items.filter((item) => item.startsWith('dissolve-') && item !== 'dissolve-live'),
    ).toHaveLength(DISSOLVE_STAGES.length);
  });

  it('lays the slots out to the viewer’s right of a stage facing −z', () => {
    const origin = { x: 10, y: 0, z: -5 };
    const forward = { x: 0, y: 0, z: -1 };
    const far = slotOf('hard');
    const near = slotOf('dissolve-0');
    expect(slotPosition(far, origin, forward).x).toBeGreaterThan(origin.x);
    expect(slotPosition(near, origin, forward).x).toBeLessThan(origin.x);
    // Far row is deeper into the scene (more −z) than the near row.
    expect(slotPosition(far, origin, forward).z).toBeLessThan(
      slotPosition(near, origin, forward).z,
    );
  });

  it('the stage is out of the testbed and the camera looks at it from the front and above', () => {
    expect(STAGE_ORIGIN.y).toBeGreaterThan(50);
    expect(STAGE_FORWARD).toEqual({ x: 0, y: 0, z: -1 });
    const pose = cameraPose(STAGE_ORIGIN);
    expect(pose.position.z).toBeGreaterThan(STAGE_ORIGIN.z);
    expect(pose.position.y).toBeGreaterThan(pose.target.y);
    expect(pose.target).toMatchObject({ x: STAGE_ORIGIN.x, z: STAGE_ORIGIN.z });
  });

  it('?focus frames one item or the row of dissolves, and falls back to the overview', () => {
    expect(parseFocusParam('')).toBe('overview');
    expect(parseFocusParam('?focus=nonsense')).toBe('overview');
    expect(parseFocusParam('?focus=dissolves')).toBe('dissolves');
    expect(parseFocusParam('?focus=rune')).toBe('rune');
    const rune = slotOf('rune');
    const at = slotPosition(rune, STAGE_ORIGIN, STAGE_FORWARD);
    const pose = cameraPose(STAGE_ORIGIN, 'rune');
    expect(pose.target.x).toBeCloseTo(at.x);
    expect(pose.position.z).toBeGreaterThan(at.z);
    const row = cameraPose(STAGE_ORIGIN, 'dissolves');
    expect(row.position.x).toBe(STAGE_ORIGIN.x);
    // A wider row is framed from further back.
    expect(row.position.z - row.target.z).toBeGreaterThan(pose.position.z - pose.target.z);
    expect(focusItems('overview')).toHaveLength(DEMO_SLOTS.length);
    expect(focusItems('dissolves')).toHaveLength(5);
    expect(focusItems('fresnel')).toEqual(['fresnel']);
    expect(focusItems('hard')).toEqual(['soft', 'hard']);
    expect(focusItems('soft')).toEqual(['soft', 'hard']);
  });

  it('the live dissolve ramps from whole to gone, holds, and starts over', () => {
    expect(dissolveLoop(0)).toBe(0);
    expect(dissolveLoop(DISSOLVE_LOOP_SECONDS * 0.425)).toBeCloseTo(0.5);
    expect(dissolveLoop(DISSOLVE_LOOP_SECONDS * 0.95)).toBe(1);
    expect(dissolveLoop(DISSOLVE_LOOP_SECONDS)).toBe(0);
    expect(dissolveLoop(-0.1)).toBeGreaterThan(0.9);
  });

  it('AC-4: the perf scene places six overlapping hazes', () => {
    const spots = hazePlacements({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    expect(spots).toHaveLength(HAZE_COUNT);
    expect(HAZE_COUNT).toBe(6);
    expect(new Set(spots.map((p) => `${String(p.x)},${String(p.y)},${String(p.z)}`)).size).toBe(6);
  });
});
