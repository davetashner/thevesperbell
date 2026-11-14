import { describe, expect, it } from 'vitest';
import { Mesh, Scene, type WebGLRenderer } from 'three';
import type { SceneSpawnPlacement } from '@sim/index';
import { createGreyboxView } from './index';

function spawn(
  id: string,
  tags: string[],
  extra: Partial<SceneSpawnPlacement> = {},
): SceneSpawnPlacement {
  return {
    id,
    position: { x: 0, y: 3.25, z: 0 },
    yaw: 0 as const,
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    prop: undefined,
    tags,
    ...extra,
  };
}

function drawn(placement: SceneSpawnPlacement) {
  const view = createGreyboxView({ shadowMap: {} } as WebGLRenderer, new Scene());
  const mesh = view.spawn(placement).children[0] as Mesh;
  view.dispose();
  return mesh;
}

describe('spawn markers (mw-ju8.42)', () => {
  it('draws a sign as a flat board at its height, not a cone', () => {
    const mesh = drawn(spawn('sign-x', ['sign']));
    expect(mesh.name).toBe('sign');
    expect(mesh.geometry.type).toBe('BoxGeometry');
    expect(mesh.rotation.x).toBe(0);
  });

  it('keeps the facing cone for an arrival and the player start', () => {
    for (const tag of ['arrival', 'player-start']) {
      const mesh = drawn(spawn('a', [tag], { position: { x: 0, y: 0, z: 0 } }));
      expect(mesh.geometry.type).toBe('ConeGeometry');
    }
  });

  it('draws any other marker (a banner) as a small flat disc', () => {
    const mesh = drawn(spawn('watch-banner', ['banner', 'prop']));
    expect(mesh.name).toBe('marker');
    expect(mesh.geometry.type).toBe('CylinderGeometry');
  });

  it('draws a lightSource spawn as a bracket, not a marker', () => {
    const mesh = drawn(spawn('l', ['lantern'], { lightSource: { variant: 'lantern' } } as never));
    expect(mesh.geometry.type).toBe('BoxGeometry');
    expect(mesh.name).toBe('marker');
  });

  it('mw-e03.13: draws a rope as a thin cylinder from its spawn point to its other end', () => {
    const down = drawn(spawn('r', ['rope'], { rope: { length: 2 } }));
    expect(down.name).toBe('rope');
    expect(down.geometry.type).toBe('CylinderGeometry');
    expect(down.position.y).toBeCloseTo(-1);
    expect(down.rotation.x).toBeCloseTo(0);
    const across = drawn(
      spawn('b', ['rope'], { rope: { length: 6, to: { x: 6, y: 3.25, z: 0 } } }),
    );
    expect(across.position.x).toBeCloseTo(3);
    expect(across.position.y).toBeCloseTo(0);
    expect(Math.abs(across.rotation.z)).toBeCloseTo(Math.PI / 2);
  });

  it('mw-e03.13: a rope with world properties (hemp: its material) is still drawn as a rope, not a bracket', () => {
    const mesh = drawn(
      spawn('r', ['rope'], { rope: { length: 2 }, properties: { material: { id: 'rope' } } }),
    );
    expect(mesh.name).toBe('rope');
    expect(mesh.geometry.type).toBe('CylinderGeometry');
  });

  it('mw-e03.13: a rope that ignores pierce is drawn as a grey chain, a plain one as hemp', () => {
    const chain = drawn(
      spawn('c', ['rope'], {
        rope: { length: 1, support: { resistances: { pierce: 1 } } },
      }),
    );
    const hemp = drawn(spawn('h', ['rope'], { rope: { length: 1 } }));
    const colour = (mesh: Mesh) =>
      (mesh.material as unknown as { color: { getHex(): number } }).color.getHex();
    expect(colour(chain)).not.toBe(colour(hemp));
  });
});
