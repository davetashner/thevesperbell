// The Wendmouth harbour tileables (owner-approved 2026-11-16) on real content: every one is shipped,
// credited and has a prompt file; the quay, breakwater and sea walls wear the stone without changing
// what they are; the harbour water is painted; and the net-loft roofs follow the thief-route rule —
// the tin roof by the Customs House stair is loud metal underfoot, the tar roofs are quiet wood, and
// the two read apart by look as well as by sound.

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { layoutScene } from '@sim/index';
import { paintFor } from '../../src/render/greybox/dressing-hides';
import {
  LIQUID_TEXTURE_PAINTINGS,
  liquidPaintingFor,
  SURFACE_TEXTURE_PAINTINGS,
} from '../../src/render/props/surfaces';

const content = loadGameContent();
const scene = content.get('scene', 'wendmouth-harbour');
const layout = layoutScene(scene, (id) => content.get('kit', id));
const credits = readFileSync('assets/CREDITS.md', 'utf8');
const STONE = 'tex-stone-breakwater-01';
const TIN = 'tex-roof-tin-harbour-01';
const TAR = 'tex-roof-tar-harbour-01';
const WATER = 'tex-water-harbour-grey-01';

describe('Wendmouth harbour tileables', () => {
  it('every harbour tileable has a runtime file, a CREDITS row and an approved prompt file', () => {
    for (const id of [STONE, TIN, TAR, WATER]) {
      expect(existsSync(`public/assets/texture/${id}.webp`), `${id} runtime file`).toBe(true);
      expect(credits, `${id} CREDITS row`).toContain(`| \`${id}\` | texture |`);
      expect(readFileSync(`assets/prompts/texture/${id}.md`, 'utf8')).toContain(
        '**Status: owner-approved',
      );
    }
    for (const id of [STONE, TIN, TAR]) {
      expect(SURFACE_TEXTURE_PAINTINGS[id]?.url).toBe(`/assets/texture/${id}.webp`);
    }
    expect(LIQUID_TEXTURE_PAINTINGS['harbour-water']?.url).toBe(`/assets/texture/${WATER}.webp`);
  });

  it('the Stone Wharf, the stair landing, the breakwater and the Undertow tunnel are stone underfoot', () => {
    for (const id of ['stone-wharf', 'great-stair-landing', 'breakwater-walk', 'undertow-tunnel']) {
      const region = layout.surfaces.find((s) => s.id === id);
      expect(region?.texture, id).toBe(STONE);
      expect(region?.surface, id).toBe('stone');
    }
  });

  it('paints the quay face, the pool walls and the breakwater as stone, never the ships', () => {
    const stone = layout.parts.filter((p) => paintFor(p, layout.paints) === STONE);
    expect(stone.length).toBeGreaterThanOrEqual(6);
    // The Gilded Tern's hull (x 30–40) and the Patient Ann (x −16 to −12) stay unpainted.
    const ships = stone.filter((p) => {
      const x = (p.min.x + p.max.x) / 2;
      const z = (p.min.z + p.max.z) / 2;
      return z > 101 && z < 159 && ((x > 29 && x < 41) || (x > -17 && x < -11));
    });
    expect(ships).toEqual([]);
  });

  it('every harbour water volume wears the harbour water', () => {
    const water = scene.spawns.filter((s) => s.liquid !== undefined);
    expect(water.length).toBeGreaterThanOrEqual(4);
    for (const s of water) expect(liquidPaintingFor(s.tags)?.url, s.id).toContain(WATER);
  });

  it('the tin roof by the Customs House stair is loud; the other two net lofts are quiet tar', () => {
    const roof = (id: string) => layout.surfaces.find((s) => s.id === id);
    expect(roof('loft-roof-east')).toMatchObject({ surface: 'metal-grate', texture: TIN });
    expect(roof('loft-roof-west')).toMatchObject({ surface: 'wood', texture: TAR });
    expect(roof('loft-roof-middle')).toMatchObject({ surface: 'wood', texture: TAR });
    // The tin roof is the one the Customs House stair climbs from.
    const stair = roof('loft-stair-customs');
    const east = roof('loft-roof-east');
    expect(stair && east && Math.abs(stair.min.x - east.max.x)).toBeLessThanOrEqual(1);
    const table = content.get('surface-table', 'surfaces').surfaces;
    const db = (id: string) => table.find((t) => t.id === id)?.offsetDb ?? 0;
    expect(db('metal-grate') - db('wood')).toBeGreaterThanOrEqual(6);
  });
});
