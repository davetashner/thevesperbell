// mw-e40.32: Wendmouth Harbour's waterfront dressing. Every approved waterfront model is placed in the
// part of the harbour its prompt file names, with a collider where a player would bump into it, the
// grey box it replaces hidden, the Gilded Tern's approach left clear, the place signs readable, and the
// building masses wearing approved tileables.

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { layoutScene } from '@sim/index';
import { hiddenByDressing, paintFor } from '../../src/render/greybox/dressing-hides';
import { SURFACE_TEXTURE_PAINTINGS } from '../../src/render/props/surfaces';

const content = loadGameContent();
const scene = content.get('scene', 'wendmouth-harbour');
const layout = layoutScene(scene, (id) => content.get('kit', id));

/** Where each placed waterfront model belongs: x and z bounds (metres) of its area of the harbour. */
const AREAS: Record<string, { x: [number, number]; z: [number, number]; y?: number }> = {
  'model-prop-wharf-crane-01': { x: [15, 55], z: [88, 99] }, // the treadwheel crane piers on the Stone Wharf
  'model-prop-net-loft-01': { x: [-97, -45], z: [44, 56], y: 4 }, // on the net-loft roofs
  'model-prop-gull-hoard-nest-01': { x: [-97, -14], z: [44, 62] }, // gull hoards on the rooftops
  'model-prop-tidefair-boom-01': { x: [0, 30], z: [76, 92] }, // the Tidefair ground
  'model-prop-wooden-gull-target-01': { x: [0, 30], z: [76, 92] },
  'model-prop-tidefair-marker-01': { x: [0, 30], z: [76, 98] },
  'model-prop-bunting-01': { x: [0, 82], z: [72, 114] }, // the Tidefair and the breakwater walk
};

describe('Wendmouth waterfront dressing', () => {
  const placed = layout.dressings.filter((d) => d.model in AREAS);

  it('places every approved waterfront model at least once', () => {
    const models = new Set(placed.map((d) => d.model));
    expect([...models].sort()).toEqual(Object.keys(AREAS).sort());
    expect(placed.filter((d) => d.model === 'model-prop-wharf-crane-01')).toHaveLength(2);
    expect(placed.filter((d) => d.model === 'model-prop-net-loft-01')).toHaveLength(3);
  });

  it('every placed model has an owner-approved prompt file and a shipped GLB', () => {
    for (const { model } of placed) {
      const prompt = readFileSync(`assets/prompts/model/${model}.md`, 'utf8');
      expect(prompt, model).toContain('**Status: owner-approved model**');
      expect(existsSync(`public/assets/model/${model}.glb`), `${model} runtime file`).toBe(true);
    }
    // The rejected drying net stays unplaced.
    expect(layout.dressings.some((d) => d.model === 'model-prop-drying-net-01')).toBe(false);
  });

  it('every model sits in its area, inside the harbour region and clear of the Gilded Tern', () => {
    const region = scene.regions.find((r) => r.tags.includes('harbour'));
    expect(region).toBeDefined();
    for (const d of placed) {
      const area = AREAS[d.model];
      expect(area, d.id).toBeDefined();
      if (area === undefined || region === undefined) continue;
      expect(d.at.x, d.id).toBeGreaterThanOrEqual(area.x[0]);
      expect(d.at.x, d.id).toBeLessThanOrEqual(area.x[1]);
      expect(d.at.z, d.id).toBeGreaterThanOrEqual(area.z[0]);
      expect(d.at.z, d.id).toBeLessThanOrEqual(area.z[1]);
      if (area.y !== undefined) expect(d.at.y, d.id).toBe(area.y);
      expect(d.at.x).toBeGreaterThan(region.min[0]);
      expect(d.at.x).toBeLessThan(region.max[0]);
      // Keep off the ship (x 28-42, z 95-150).
      const onShip = d.at.x >= 28 && d.at.x <= 42 && d.at.z >= 95 && d.at.z <= 150;
      expect(onShip, d.id).toBe(false);
    }
  });

  it('each placed model has a blocking collider under it, and its grey box is not drawn', () => {
    for (const d of placed.filter((p) => p.model !== 'model-prop-bunting-01')) {
      const hit = layout.parts.some(
        (p) =>
          p.purpose === 'blocking' &&
          d.at.x >= p.min.x &&
          d.at.x <= p.max.x &&
          d.at.z >= p.min.z &&
          d.at.z <= p.max.z &&
          Math.abs(p.min.y - d.at.y) < 0.01,
      );
      expect(hit, d.id).toBe(true);
    }
    const hidden = layout.parts.filter((p) => hiddenByDressing(p, layout.dressings));
    expect(hidden.length).toBeGreaterThanOrEqual(15);
  });

  it('leaves the Tern gangway approach (x 33-37, z 95-104) free of placed models', () => {
    for (const d of placed) {
      const inApproach = d.at.x >= 32 && d.at.x <= 38 && d.at.z >= 94 && d.at.z <= 105;
      expect(inApproach, d.id).toBe(false);
    }
  });

  it('adds a readable sign at the Drowned Gull, customs house, Tidemarket, net lofts and breakwater', () => {
    const signs = scene.spawns.filter((s) => s.tags.includes('sign') && s.id !== 'toll-board');
    const ids = signs.map((s) => s.id);
    for (const id of [
      'sign-drowned-gull',
      'sign-customs-house',
      'sign-tidemarket',
      'sign-net-lofts',
      'sign-breakwater',
    ]) {
      expect(ids).toContain(id);
    }
    for (const s of signs.filter((x) => x.id.startsWith('sign-') && x.id !== 'sign-exit-towpath')) {
      expect(s.tags).toContain('readable');
      expect(s.interact?.affordances[0]?.verb).toBe('read');
      const text = s.tags.find((t) => t.startsWith('inscription-'));
      expect(text, s.id).toBeDefined();
      expect(content.get('inscription', text ?? '').pages.length).toBeGreaterThan(0);
    }
  });

  it('textures the building masses and the quay yards with approved tileables', () => {
    for (const id of ['tex-stone-breakwater-01', 'tex-planks-salt-bleached-01']) {
      expect(SURFACE_TEXTURE_PAINTINGS[id]?.url).toBe(`/assets/texture/${id}.webp`);
      expect(existsSync(`public/assets/texture/${id}.webp`), id).toBe(true);
      expect(readFileSync(`assets/prompts/texture/${id}.md`, 'utf8')).toContain(
        '**Status: owner-approved',
      );
    }
    const painted = (texture: string, x: number, z: number) =>
      layout.parts.some(
        (p) =>
          paintFor(p, layout.paints) === texture &&
          x >= p.min.x &&
          x <= p.max.x &&
          z >= p.min.z &&
          z <= p.max.z,
      );
    expect(painted('tex-stone-breakwater-01', -23, 36)).toBe(true); // Customs House rear wall
    expect(painted('tex-stone-breakwater-01', 30, 44.5)).toBe(true); // Tidemarket side wall
    expect(painted('tex-stone-breakwater-01', 50, 36)).toBe(true); // Bonded Warehouse
    expect(painted('tex-planks-salt-bleached-01', -71, 56)).toBe(true); // a net loft
    expect(painted('tex-planks-salt-bleached-01', 69, 128)).toBe(true); // the Drowned Gull
  });

  // mw-e40.34: the grey boxes that were left (blue cargo blocks, plain net-loft ground floors).
  it('AC-1: every interactive cargo block keeps its collider, its purpose and its sight, and wears a prop', () => {
    const crates = layout.parts.filter((p) => p.piece === 'crate');
    expect(crates).toHaveLength(10);
    for (const c of crates) {
      expect(c.purpose).toBe('interactive');
      // No dressing hides an affordance: the block stays drawn, painted as a crate by the renderer.
      expect(hiddenByDressing(c, layout.dressings)).toBe(false);
    }
    const stacked = layout.dressings.filter((d) => d.id.startsWith('wharf-crate-'));
    expect(stacked).toHaveLength(9);
    for (const d of stacked) {
      const under = crates.find(
        (c) => Math.abs(c.center.x - d.at.x) < 0.01 && Math.abs(c.center.z - d.at.z) < 0.01,
      );
      expect(under, d.id).toBeDefined();
      expect(d.at.y).toBeCloseTo(under?.max.y ?? -1, 5);
    }
  });

  it('AC-2: each net loft front has a door frame, awning, shuttered windows, a stone plinth and a cargo corner', () => {
    for (const n of ['west', 'middle', 'east']) {
      const ids = layout.dressings
        .filter((d) => d.id.startsWith(`net-loft-${n}-`))
        .map((d) => d.id);
      for (const what of ['crate-stack', 'keg', 'barrel', 'rope-coil']) {
        expect(ids, `${n} ${what}`).toContain(`net-loft-${n}-${what}`);
      }
      expect(
        layout.paints.some(
          (p) => p.id === `net-loft-${n}-trim` && p.texture === 'tex-bulkhead-pine-01',
        ),
      ).toBe(true);
      expect(
        layout.paints.some(
          (p) => p.id === `net-loft-${n}-plinth` && p.texture === 'tex-stone-breakwater-01',
        ),
      ).toBe(true);
    }
    const painted = (texture: string, x: number, y: number, z: number) =>
      layout.parts.some(
        (p) =>
          paintFor(p, layout.paints) === texture &&
          x >= p.min.x &&
          x <= p.max.x &&
          y >= p.min.y &&
          y <= p.max.y &&
          z >= p.min.z &&
          z <= p.max.z,
      );
    expect(painted('tex-bulkhead-pine-01', -89, 3.1, 43.75)).toBe(true); // the lintel board
    expect(painted('tex-bulkhead-pine-01', -88, 1.5, 43.75)).toBe(true); // a door jamb
    expect(painted('tex-bulkhead-pine-01', -93.5, 1.8, 43.75)).toBe(true); // a shuttered window
    expect(painted('tex-stone-breakwater-01', -93, 0.25, 43.75)).toBe(true); // the plinth
  });

  it('AC-3: the loft roofs keep the loud tin and quiet tar thief-route rule', () => {
    const roofs = Object.fromEntries(
      scene.surfaces.filter((s) => s.id.startsWith('loft-roof-')).map((s) => [s.id, s]),
    );
    expect(roofs['loft-roof-west']?.surface).toBe('wood');
    expect(roofs['loft-roof-middle']?.surface).toBe('wood');
    expect(roofs['loft-roof-east']?.surface).toBe('metal-grate');
    expect(roofs['loft-roof-east']?.texture).toBe('tex-roof-tin-harbour-01');
  });
});
