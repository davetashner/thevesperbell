// mw-e29.10: spell VFX slots through the real pieces, headless: the real VfxSystem spawns the tinted
// particle effects, and the real Three.js objects of the ring and the beam (src/render/spell-vfx) are
// built and moved; only the GPU is missing, so shader compilation is the e2e's (e2e/spell-vfx.spec.ts).
import { Box3, Scene, Vector3, type Mesh, type Object3D, type WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/game-content';
import { SpellVfxLibrary, SpellVfxPlayer } from '@game/spell-vfx/index';
import { VfxSystem } from '@game/vfx/index';
import { MagicMaterials } from '@render/magic-materials/index';
import { SpellVfxView } from '@render/spell-vfx/index';
import type { EntityId, Vec3 } from '@sim/index';

const content = loadGameContent();
const library = new SpellVfxLibrary(content.all('spell-vfx-template'), content.all('vfx-effect'));
const BLOCK = library.resolve({
  castWindup: { template: 'svt-windup-gather' },
  area: { template: 'svt-area-rune-ring' },
  beam: { template: 'svt-beam-stream' },
});

const CASTER: EntityId = 7;
const places = new Map<EntityId, Vec3>([[CASTER, { x: 0, y: 1.3, z: 0 }]]);

function stage(reducedMotion = false) {
  const scene = new Scene();
  const magic = new MagicMaterials({ renderer: {} as WebGLRenderer, tier: 'high' });
  const view = new SpellVfxView(scene, magic, () => reducedMotion);
  const vfx = new VfxSystem({
    effects: [...content.all('vfx-effect'), ...library.derivedEffects()],
    anchors: (entity) => {
      const position = places.get(entity);
      return position && { position };
    },
    dev: false,
  });
  const player = new SpellVfxPlayer({
    vfx,
    anchors: (entity) => {
      const position = places.get(entity);
      return position && { position };
    },
    surfaces: view,
  });
  return { scene, magic, view, vfx, player };
}

const named = (scene: Scene, name: string): Object3D[] => {
  const found: Object3D[] = [];
  scene.traverse((o) => {
    if (o.name === name) found.push(o);
  });
  return found;
};

describe('spell VFX slots, headless (mw-e29.10)', () => {
  it('AC-2: an area spell of radius 4 m renders a ring 4 m in radius once it has grown', () => {
    const { scene, view, player } = stage();
    const centre = { x: 10, y: 0, z: -5 };
    player.area(BLOCK, centre, 4);
    const [decal] = named(scene, 'magic:rune-decal') as Mesh[];
    if (decal === undefined) throw new Error('no ring was drawn');
    view.update(0.1);
    const growing = new Box3().setFromObject(decal).getSize(new Vector3());
    expect(growing.x).toBeLessThan(8); // still opening
    view.update(1); // past its 0.5 s grow time
    decal.updateMatrixWorld(true);
    const box = new Box3().setFromObject(decal);
    const size = box.getSize(new Vector3());
    expect(size.x).toBeCloseTo(8, 6); // a 4 m radius: 8 m across, never more
    expect(size.z).toBeCloseTo(8, 6);
    expect(size.y).toBeCloseTo(0, 6); // lies flat
    const middle = box.getCenter(new Vector3());
    expect([middle.x, middle.z]).toEqual([centre.x, centre.z]);
  });

  it('AC-2: reduced motion shows the ring at its full radius at once', () => {
    const { scene, player } = stage(true);
    player.area(BLOCK, { x: 0, y: 0, z: 0 }, 4);
    const [decal] = named(scene, 'magic:rune-decal') as Mesh[];
    if (decal === undefined) throw new Error('no ring was drawn');
    decal.updateMatrixWorld(true);
    expect(new Box3().setFromObject(decal).getSize(new Vector3()).x).toBeCloseTo(8, 6);
  });

  it('AC-3: the beam start follows the cast socket every frame, as the caster moves', () => {
    const { scene, view, player } = stage();
    places.set(CASTER, { x: 0, y: 1.3, z: 0 });
    player.beam(
      BLOCK,
      { entity: CASTER, socket: 'hand-r' },
      { position: { x: 0, y: 1.3, z: -10 } },
    );
    const [beam] = named(scene, 'spell:beam');
    if (beam === undefined) throw new Error('no beam was drawn');
    // The strip's start end: its centre moved back half its length along the beam.
    const start = (): Vector3 => {
      beam.updateMatrixWorld(true);
      return new Vector3(-0.5, 0, 0).applyMatrix4(beam.matrixWorld);
    };
    const near = (at: number[]): void => {
      const got = start();
      at.forEach((n, i) => {
        expect([got.x, got.y, got.z][i]).toBeCloseTo(n, 5);
      });
    };
    near([0, 1.3, 0]);
    for (const x of [1, 2.5, 4]) {
      places.set(CASTER, { x, y: 1.3, z: 0 });
      player.update();
      view.update(1 / 60);
      near([x, 1.3, 0]);
    }
    expect(view.drawn.beams).toBe(1);
  });

  it('a spell cast through the real VfxSystem spawns its tinted effect; drawings close on stop', () => {
    const { scene, view, vfx, player } = stage();
    expect(vfx.has('vfx-spell-windup-motes~8b5cf6')).toBe(true);
    const windup = player.castWindup(BLOCK, { entity: CASTER });
    vfx.update(0.1, { x: 0, y: 0, z: 0 });
    expect(vfx.stats().particles).toBeGreaterThan(0);
    windup?.stop();
    const ring = player.area(BLOCK, { x: 0, y: 0, z: 0 }, 2);
    const beam = player.beam(BLOCK, { entity: CASTER }, { position: { x: 0, y: 1, z: -4 } });
    expect(view.drawn).toEqual({ rings: 1, beams: 1 });
    ring?.stop();
    beam?.stop();
    expect(view.drawn).toEqual({ rings: 0, beams: 0 });
    expect(view.active).toBe(false);
    expect(named(scene, 'spell:beam')).toEqual([]);
  });

  it('a zero-length beam is hidden rather than drawn degenerate', () => {
    const { scene, player } = stage();
    places.set(CASTER, { x: 0, y: 1, z: 0 });
    player.beam(BLOCK, { entity: CASTER }, { position: { x: 0, y: 1, z: 0 } });
    expect(named(scene, 'spell:beam')[0]?.visible).toBe(false);
  });
});
