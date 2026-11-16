// The Gilded Tern's dressing models in Wendmouth Harbour (render only): every model has a prompt file,
// an owner-approved one is shipped, and dressing the ship never hides a gameplay affordance — the
// rigging climb and the crow's nest stay drawn, and every springald that looks solid has a collider.

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { layoutScene } from '@sim/index';
import { hiddenByDressing, paintFor } from '../../src/render/greybox/dressing-hides';
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

  it('hides the grey hull mass but never the climb, the crow’s nest or the stern cabin', () => {
    const hidden = layout.parts.filter((p) => hiddenByDressing(p, layout.dressings));
    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden.some((p) => p.purpose === 'climbable')).toBe(false);
    // The crow's nest platform (top 12 m) and the cabin walls behind z 138 stay drawn.
    expect(hidden.some((p) => p.max.y >= 11.9 && p.max.y <= 12.1 && p.min.x > 35)).toBe(false);
    expect(hidden.some((p) => (p.min.z + p.max.z) / 2 > 138)).toBe(false);
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
