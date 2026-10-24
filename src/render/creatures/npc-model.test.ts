import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { GlbModel } from '../models/glb';
import { createNpcModelLoader, NPC_MODEL_URLS, npcModelUrl } from './npc-model';

const DATA = join(process.cwd(), 'src/content/data/creature');
const PUBLIC = join(process.cwd(), 'public');

function npcMeshes(): string[] {
  return readdirSync(DATA)
    .filter((f) => f.startsWith('npc-') && f.endsWith('.json'))
    .map((f) => {
      const def = JSON.parse(readFileSync(join(DATA, f), 'utf8')) as {
        presentation: { mesh: string };
      };
      return def.presentation.mesh;
    });
}

/** The JSON chunk of a GLB file. */
interface GlbJson {
  accessors: { count: number }[];
  meshes: { primitives: { indices: number }[] }[];
  images?: unknown[];
}
function glbJson(path: string): GlbJson {
  const bytes = readFileSync(path);
  const length = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + length).toString('utf8')) as GlbJson;
}

describe('NPC models', () => {
  it('AC-1: every NPC mesh id that names a model has a file of at most 6k triangles and one texture', () => {
    const meshes = npcMeshes().filter((mesh) => mesh !== 'placeholder-capsule');
    expect(meshes.length).toBe(7);
    for (const mesh of meshes) {
      const url = npcModelUrl(mesh);
      expect(url, mesh).toBeDefined();
      const path = join(PUBLIC, url ?? '');
      expect(existsSync(path), path).toBe(true);
      const json = glbJson(path);
      const primitive = json.meshes[0]?.primitives[0];
      const indices = json.accessors[primitive?.indices ?? 0]?.count ?? Infinity;
      expect(indices / 3, mesh).toBeLessThanOrEqual(6000);
      expect(json.images?.length, mesh).toBe(1);
    }
  });

  it('AC-1: the watchmen share one model', () => {
    expect(NPC_MODEL_URLS['npc-watchman']).toBeDefined();
    expect(Object.values(NPC_MODEL_URLS).length).toBe(6);
  });

  it('AC-1: Hollis, Juniper and Oswin each have their own model, and no NPC is a capsule any more', () => {
    for (const id of ['npc-hollis', 'npc-juniper', 'npc-oswin']) {
      expect(npcModelUrl(id), id).toBe(`/assets/model/model-${id}-01.glb`);
    }
    expect(npcMeshes()).not.toContain('placeholder-capsule');
  });

  it('AC-2: a mesh id with no model, or no mesh id, stays a capsule', () => {
    expect(npcModelUrl('placeholder-capsule')).toBeUndefined();
    expect(npcModelUrl('placeholder-capsule-bones')).toBeUndefined();
    expect(npcModelUrl('toString')).toBeUndefined();
    expect(npcModelUrl(undefined)).toBeUndefined();
  });
});

describe('createNpcModelLoader', () => {
  const model = (): GlbModel => ({
    geometry: new BoxGeometry(1, 1, 1),
    material: new MeshStandardMaterial(),
  });

  it('AC-2: reads each url once and shares the result', async () => {
    const read = vi.fn(() => Promise.resolve(model()));
    const load = createNpcModelLoader(read);
    const [a, b] = await Promise.all([load('/a.glb'), load('/a.glb')]);
    expect(a).toBe(b);
    await load('/b.glb');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('AC-2: a failed read is not cached, so the next call tries again', async () => {
    const read = vi
      .fn<(url: string) => Promise<GlbModel>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(model());
    const load = createNpcModelLoader(read);
    await expect(load('/a.glb')).rejects.toThrow('offline');
    await expect(load('/a.glb')).resolves.toBeDefined();
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe('createCreatureProxy with an NPC mesh', () => {
  async function proxyWith(
    load: () => Promise<GlbModel>,
  ): Promise<{ proxy: Object3D; settle: () => Promise<void> }> {
    vi.resetModules();
    vi.doMock('./npc-model', async (original) => ({
      ...(await original<typeof import('./npc-model')>()),
      loadNpcModel: load,
    }));
    const { createCreatureProxy } = await import('./index');
    const proxy = createCreatureProxy({
      id: 'npc-ottilie',
      radius: 0.4,
      height: 1.8,
      armed: false,
      mesh: 'npc-ottilie',
    });
    return { proxy, settle: () => new Promise((resolve) => setTimeout(resolve, 0)) };
  }

  const visibleBody = (proxy: Object3D): Mesh | undefined => {
    let found: Mesh | undefined;
    proxy.traverse((o) => {
      if (o instanceof Mesh && o.name === 'body' && o.visible) found = o;
    });
    return found;
  };

  it('AC-2: the model replaces the capsule once loaded', async () => {
    const geometry = new BoxGeometry(1, 2, 1);
    geometry.translate(0, 1, 0);
    const { proxy, settle } = await proxyWith(() =>
      Promise.resolve({ geometry, material: new MeshStandardMaterial() }),
    );
    await settle();
    const model = proxy.getObjectByName('model');
    expect(model).toBeInstanceOf(Group);
    expect(model?.scale.y).toBeCloseTo(0.9);
    expect(proxy.getObjectByName('proxy-body')?.visible).toBe(false);
    expect(visibleBody(proxy)).toBeDefined();
  });

  it('AC-2: the capsule is kept when the model fails to load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { proxy, settle } = await proxyWith(() => Promise.reject(new Error('404')));
    await settle();
    expect(proxy.getObjectByName('model')).toBeUndefined();
    expect(visibleBody(proxy)).toBeDefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
