import { describe, expect, it } from 'vitest';
import { Mesh, Scene, type WebGLRenderer } from 'three';
import type { SceneSpawnPlacement } from '@sim/index';
import { createGreyboxView } from './index';

function spawn(id: string, tags: string[], extra: Partial<SceneSpawnPlacement> = {}) {
  return {
    id,
    position: { x: 0, y: 3.25, z: 0 },
    yaw: 0,
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    prop: undefined,
    tags,
    ...extra,
  } as SceneSpawnPlacement;
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
});
