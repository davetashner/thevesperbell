// The Gilded Tern's dressing models in Wendmouth Harbour (render only): every model has a prompt file,
// an owner-approved one is shipped, and dressing the ship never hides a gameplay affordance — the
// rigging climb and the crow's nest stay drawn, and every springald that looks solid has a collider.

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { layoutScene } from '@sim/index';
import { hiddenByDressing, paintFor } from '../../src/render/greybox/dressing-hides';
import { MODEL_STRIPS } from '../../src/render/props/model-strips';
import { PROP_MODELS } from '../../src/render/props/dock-props';
import {
  CLIMB_MAST,
  HOLD_LADDER_DZ,
  HOLD_LADDER_FOOT,
  HOLD_LADDER_TOP,
  HULL_DRESSING,
  HULL_LADDER_DX,
  HULL_LADDER_DZ,
  HULL_LADDER_FOOT,
  HULL_LADDER_TOP,
  LADDER_DX,
  LADDER_DZ,
  LADDER_TOP,
} from '../../src/render/props/tern-rigging';
import { SURFACE_TEXTURE_PAINTINGS } from '../../src/render/props/surfaces';
import { WALL_TEXTURES } from '@content/index';

const content = loadGameContent();
const scene = content.get('scene', 'wendmouth-harbour');
const layout = layoutScene(scene, (id) => content.get('kit', id));

describe('Gilded Tern dressing', () => {
  it('dresses the hull, three masts, the figurehead and four springalds', () => {
    const models = layout.dressings.map((d) => d.model);
    expect(models.filter((m) => m === 'model-ship-gilded-tern-hull-01')).toHaveLength(1);
    expect(models.filter((m) => m === 'model-ship-gilded-tern-rigging-01')).toHaveLength(3);
    expect(models.filter((m) => m === 'model-prop-tern-figurehead-01')).toHaveLength(1);
    expect(models.filter((m) => m === 'model-prop-springald-swivel-01')).toHaveLength(4);
  });

  it('every dressing model has a prompt file, and an owner-approved one is shipped', () => {
    for (const { model } of layout.dressings) {
      const prompt = `assets/prompts/model/${model}.md`;
      expect(existsSync(prompt), `${model} prompt file`).toBe(true);
      if (readFileSync(prompt, 'utf8').includes('**Status: owner-approved model**')) {
        expect(existsSync(`public/assets/model/${model}.glb`), `${model} runtime file`).toBe(true);
      }
    }
  });

  it('hides the grey hull shell, the hold, the bulwarks and the stern cabin, never the crow’s nest', () => {
    const hidden = layout.parts.filter((p) => hiddenByDressing(p, layout.dressings));
    expect(hidden.length).toBeGreaterThan(0);
    // The crow's nest platform (top 12 m) stays drawn: nothing replaces it.
    expect(
      hidden.some(
        (p) => p.purpose === 'blocking' && p.max.y >= 11.9 && p.max.y <= 12.1 && p.min.x > 35,
      ),
    ).toBe(false);
    // The cabin's walls (above the deck, behind z 138) are the model's poop deck now, not boxes.
    const cabin = layout.parts.filter((p) => p.min.y >= 2 && (p.min.z + p.max.z) / 2 > 138);
    expect(cabin.length).toBeGreaterThan(0);
    expect(cabin.every((p) => p.purpose !== 'blocking' || hidden.includes(p))).toBe(true);
    // Every blocking mass in the hull's footprint is hidden except the mast pillars and the nest.
    const loose = layout.parts.filter(
      (p) =>
        p.purpose === 'blocking' &&
        p.min.x >= 30 &&
        p.max.x <= 40 &&
        p.min.z >= 106 &&
        p.max.z <= 147 &&
        p.max.y < 6 &&
        p.min.y < 3.3 &&
        !hidden.includes(p),
    );
    // What is left: the gangway landing and the deck furniture (hutch, tiller, springald posts).
    for (const p of loose) expect(p.min.y).toBeGreaterThanOrEqual(1.7);
  });

  it('only the climbs a dressing redraws are hidden: the hull ladders and the mast board', () => {
    const climbs = layout.parts.filter((p) => p.purpose === 'climbable');
    const hiddenClimbs = climbs.filter((p) => hiddenByDressing(p, layout.dressings));
    expect(hiddenClimbs).toHaveLength(3);
    const hull = layout.dressings.find((d) => d.id === HULL_DRESSING);
    expect(hull).toBeDefined();
    const at = hull?.at ?? { x: 0, y: 0, z: 0 };
    const covers = (x: number, z: number, foot: number, top: number) =>
      hiddenClimbs.some(
        (p) =>
          p.min.x <= x &&
          p.max.x >= x &&
          p.min.z <= z &&
          p.max.z >= z &&
          Math.abs(p.min.y - foot) < 0.01 &&
          p.max.y >= Math.min(top, 2) - 0.01,
      );
    // The ladders drawn on the hull sit on the grey-box climbs they stand in for.
    expect(
      covers(at.x + HULL_LADDER_DX, at.z + HULL_LADDER_DZ, HULL_LADDER_FOOT, HULL_LADDER_TOP),
    ).toBe(true);
    expect(covers(at.x, at.z + HOLD_LADDER_DZ, HOLD_LADDER_FOOT, HOLD_LADDER_TOP)).toBe(true);
    // The mainmast's board is the third, and the crow's nest climb (the shrouds) is not among them.
    const mast = layout.dressings.find((d) => d.id === CLIMB_MAST)?.at ?? { x: 0, y: 0, z: 0 };
    expect(covers(mast.x + LADDER_DX - 0.3, mast.z, mast.y, LADDER_TOP)).toBe(true);
  });

  it('shows the hold again only from inside: the hull box says so, the shell and cabin do not', () => {
    const inside = layout.dressings.filter((d) => d.hides?.inside === true);
    expect(inside.map((d) => d.id)).toEqual([HULL_DRESSING]);
    // From inside the hold's floor and walls are drawn; the hull's lower shell never is.
    const box = inside[0]?.hides;
    expect(box?.min.y).toBeGreaterThan(-1.7);
    expect(box?.max.y).toBeLessThan(1.7);
  });

  it('draws the mainmast’s rope ladder against the climbable board, and cuts only models the scene dresses', () => {
    const mast = layout.dressings.find((d) => d.id === CLIMB_MAST);
    expect(mast).toBeDefined();
    const x = (mast?.at.x ?? 0) + LADDER_DX;
    const z = (mast?.at.z ?? 0) + LADDER_DZ;
    const board = layout.parts.find(
      (p) =>
        p.purpose === 'climbable' &&
        Math.abs(p.max.x - x) < 0.1 &&
        p.min.z <= z &&
        p.max.z >= z &&
        p.max.y >= LADDER_TOP,
    );
    expect(board).toBeDefined();
    expect(board?.min.y).toBeCloseTo(mast?.at.y ?? 0, 5);
    const dressed = new Set(layout.dressings.map((d) => d.model));
    for (const model of Object.keys(MODEL_STRIPS)) expect(dressed.has(model), model).toBe(true);
  });

  it('the hold grating is drawn from boxes, so its blobby model stays unused', () => {
    expect(PROP_MODELS['deck-grating']?.procedural).toBe('deck-grating');
  });

  it('every springald stands on a collider', () => {
    const springalds = layout.dressings.filter((d) => d.model === 'model-prop-springald-swivel-01');
    for (const { at, id } of springalds) {
      const post = layout.parts.find(
        (p) =>
          p.purpose === 'blocking' &&
          Math.abs(p.min.y - at.y) < 0.01 &&
          at.x >= p.min.x &&
          at.x <= p.max.x &&
          at.z >= p.min.z &&
          at.z <= p.max.z &&
          p.max.x - p.min.x < 1,
      );
      expect(post, id).toBeDefined();
    }
  });

  it('paints the stern cabin walls as pine bulkhead without changing what they are made of', () => {
    for (const id of WALL_TEXTURES) {
      expect(SURFACE_TEXTURE_PAINTINGS[id]?.url, id).toBe(`/assets/texture/${id}.webp`);
      expect(existsSync(`public/assets/texture/${id}.webp`), `${id} runtime file`).toBe(true);
    }
    const cabin = layout.parts.filter((p) => paintFor(p, layout.paints) === 'tex-bulkhead-pine-01');
    // Front wall and doorway, the berth bulkhead and doorway, both sides and the stern.
    expect(cabin.length).toBeGreaterThanOrEqual(8);
    const placements = scene.placements.filter(
      (p) => p.at[2] >= 137.5 && p.at[0] >= 30 && p.at[0] <= 40,
    );
    expect(placements.every((p) => p.properties?.material === undefined)).toBe(true);
  });
});
