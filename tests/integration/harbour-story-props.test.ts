// The harbour story-prop models (owner-approved turntables, 2026-11-16): the bay nine heist pieces and
// the breakwater's serpent figurehead and sea-door. They are not placed yet (the interiors are later
// beads), so this checks what can be checked now: each is shipped, credited and approved, and stays
// within the large-prop budget once optimised (style bible §13.2: one material, a small file).

import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { layoutScene } from '@sim/index';
import { hiddenByDressing } from '../../src/render/greybox/dressing-hides';

const MODELS = [
  'model-prop-bay-door-seal-01',
  'model-prop-relic-crate-01',
  'model-prop-ballast-crate-01',
  'model-prop-cargo-scale-01',
  'model-prop-strongroom-door-01',
  'model-prop-shelf-cray-01',
  'model-prop-figurehead-serpent-01',
  'model-prop-sea-door-01',
] as const;
const credits = readFileSync('assets/CREDITS.md', 'utf8');
const content = loadGameContent();
const harbour = layoutScene(content.get('scene', 'wendmouth-harbour'), (id) =>
  content.get('kit', id),
);
/** Placed in the harbour now; the doors wait for the door system and the relic crate for the heist. */
const PLACED = [
  'model-prop-cargo-scale-01',
  'model-prop-shelf-cray-01',
  'model-prop-ballast-crate-01',
  'model-prop-figurehead-serpent-01',
  'model-prop-sea-door-01',
] as const;

describe('harbour story-prop models', () => {
  it('every model is shipped, credited and owner-approved', () => {
    for (const id of MODELS) {
      const runtime = `public/assets/model/${id}.glb`;
      expect(existsSync(runtime), `${id} runtime file`).toBe(true);
      expect(statSync(runtime).size, `${id} size`).toBeLessThan(256 * 1024);
      expect(credits, `${id} CREDITS row`).toContain(`| ${id} | model |`);
      expect(readFileSync(`assets/prompts/model/${id}.md`, 'utf8')).toContain(
        '**Status: owner-approved model**',
      );
    }
  });

  it('the relic crate and its ballast twin are separate models from the same approved sheet', () => {
    const relic = readFileSync('assets/prompts/model/model-prop-relic-crate-01.md', 'utf8');
    const ballast = readFileSync('assets/prompts/model/model-prop-ballast-crate-01.md', 'utf8');
    for (const text of [relic, ballast]) expect(text).toContain('prop-harbour-story-set-01');
  });

  it('the placed story props stand on colliders, so nothing that looks solid can be walked through', () => {
    for (const model of PLACED) {
      const dressing = harbour.dressings.find((d) => d.model === model);
      expect(dressing, model).toBeDefined();
      const { x, y, z } = dressing?.at ?? { x: 0, y: 0, z: 0 };
      const collider = harbour.parts.find(
        (p) =>
          p.purpose === 'blocking' &&
          Math.abs(p.min.y - y) < 0.01 &&
          x >= p.min.x &&
          x <= p.max.x &&
          z >= p.min.z &&
          z <= p.max.z,
      );
      expect(collider, `${model} collider`).toBeDefined();
      // The collider box is not drawn over the model.
      expect(
        collider !== undefined && hiddenByDressing(collider, harbour.dressings),
        `${model} hides its collider`,
      ).toBe(true);
    }
  });

  it('the sunken figurehead breaks the surface (the serpent of the rumour) and the sea-door sits at the tide line', () => {
    const water = -2.5;
    const head = harbour.dressings.find((d) => d.model === 'model-prop-figurehead-serpent-01');
    expect(head?.at.y ?? 0).toBeLessThan(water);
    expect((head?.at.y ?? 0) + (head?.size.y ?? 0)).toBeGreaterThan(water);
    const door = harbour.dressings.find((d) => d.model === 'model-prop-sea-door-01');
    expect(door?.at.y ?? 0).toBeLessThan(water);
    expect((door?.at.y ?? 0) + (door?.size.y ?? 0)).toBeGreaterThan(water);
  });

  it('the generated waterfront props are shipped and credited, and the rejected drying net is not', () => {
    for (const id of [
      'model-prop-wharf-crane-01',
      'model-prop-crate-stack-01',
      'model-prop-tidefair-marker-01',
      'model-prop-notice-lantern-court-01',
      'model-prop-rowing-boat-01',
      'model-prop-cargo-net-01',
      'model-prop-net-loft-01',
      'model-prop-plank-bridge-01',
      'model-prop-gull-hoard-nest-01',
      'model-prop-smuggler-crate-01',
      'model-prop-lantern-hook-01',
      'model-prop-fence-counter-01',
      'model-prop-tidefair-boom-01',
      'model-prop-wooden-gull-target-01',
      'model-prop-bunting-01',
    ]) {
      expect(existsSync(`public/assets/model/${id}.glb`), `${id} runtime file`).toBe(true);
      expect(statSync(`public/assets/model/${id}.glb`).size, `${id} size`).toBeLessThan(256 * 1024);
      expect(credits, `${id} CREDITS row`).toContain(`| ${id} | model |`);
    }
    expect(existsSync('public/assets/model/model-prop-drying-net-01.glb')).toBe(false);
  });
});
