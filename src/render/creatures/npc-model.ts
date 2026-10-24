// The Briar Glen townsfolk's placeholder bodies (mw-ju8.34): one Tripo image-to-3D model per NPC (the
// two Watch guards share one), keyed on the creature's `presentation.mesh` so the capsule stays the
// fallback for any mesh id without a model here. Each is loaded once and shared by every creature
// wearing it. Creatures face +z (see index.ts) and the mesh arrives facing +x, so the body is turned
// −90° about y and stood on the ground.
//
// The pure lookup and the cache are unit-tested (npc-model.test.ts); reading a GLB needs a browser, so
// the real load is verified by the Playwright specs that walk the town.

import { readGlbMesh, turnAndGround, type GlbModel } from '../models/glb';

/** NPC mesh id (CreatureDef.presentation.mesh) to its model file under public/assets/model. */
export const NPC_MODEL_URLS: Readonly<Record<string, string>> = {
  'npc-ottilie': '/assets/model/model-npc-ottilie-01.glb',
  'npc-dot': '/assets/model/model-npc-dot-01.glb',
  'npc-hollis': '/assets/model/model-npc-hollis-01.glb',
  'npc-juniper': '/assets/model/model-npc-juniper-01.glb',
  'npc-oswin': '/assets/model/model-npc-oswin-01.glb',
  'npc-garrick': '/assets/model/model-npc-garrick-01.glb',
  'npc-rooke': '/assets/model/model-npc-rooke-01.glb',
  // Day and night watchmen are one model for now.
  'npc-watchman': '/assets/model/model-npc-watchman-01.glb',
};

/** The model file for creature mesh id `mesh`, or undefined when it has none (it stays a capsule). */
export function npcModelUrl(mesh: string | undefined): string | undefined {
  if (mesh === undefined) return undefined;
  return Object.hasOwn(NPC_MODEL_URLS, mesh) ? NPC_MODEL_URLS[mesh] : undefined;
}

/**
 * A loader that reads each url once through `read` and shares the result; a failed read is forgotten so
 * the next call tries again.
 */
export function createNpcModelLoader(
  read: (url: string) => Promise<GlbModel>,
): (url: string) => Promise<GlbModel> {
  const loading = new Map<string, Promise<GlbModel>>();
  return (url) => {
    const cached = loading.get(url);
    if (cached !== undefined) return cached;
    const pending = read(url).catch((error: unknown) => {
      loading.delete(url);
      throw error;
    });
    loading.set(url, pending);
    return pending;
  };
}

/** Reads an NPC model: turned to face +z and standing on the ground. */
async function readNpcModel(url: string): Promise<GlbModel> {
  const model = await readGlbMesh(url);
  turnAndGround(model.geometry, -90);
  return model;
}

/** Loads the NPC model at `url` once; every creature wearing it shares the result. */
export const loadNpcModel = createNpcModelLoader(readNpcModel);
