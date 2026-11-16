// The Wendmouth dock props (owner-approved Tripo models, 2026-11-15): barrels, kegs, a cask on its
// cradle, rope and hawser coils, the netted cargo crate on the Gilded Tern's hoist, the Tern's deck
// fittings (grating, companionway hutch, tiller, pin rail), its ship's lantern and three lockable
// chests. Each model replaces the greybox stand-in of the spawn that names it, once it loads (the
// stand-in stays if it never does), and is shared by every spawn that shows it.
//
// How a spawn picks its model: a prop by its testprop id (`PROP_MODELS`), a container by a tag
// (`CONTAINER_MODELS`), the lantern by its `ship-lantern` tag. A movable prop's model is scaled to its
// physics body's height and centred on it (the body is what moves); a fixed prop stands on its spawn
// point. Tripo leaves the fronts of the chests, the hutch, the tiller and the pin rail on +x and the
// lantern's wall plate on +z; the turns below put every front on +z, so a spawn's yaw faces it.
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage; the tables are
// checked against the runtime files and the harbour scene in tests/integration/dock-props.test.ts and
// the drawing by the Playwright harbour spec.

import { placeGeometry, readGlbMesh, type GlbModel, type Placement } from '../models/glb';
import { buildDeckGrating } from './deck-grating';

/** Where model `id` is served from. */
export const modelUrl = (id: string): string => `/assets/model/${id}.glb`;

/** A front on +x turned to +z. */
const FRONT_X: readonly [number, number, number] = [0, -90, 0];
const AS_IS: readonly [number, number, number] = [0, 0, 0];

/** How one prop is drawn: its model, the turn that faces it +z, and (fixed props) its height. */
export interface DockModel {
  readonly model: string;
  readonly rotateDeg: readonly [number, number, number];
  /** Height in metres for a fixed prop; a movable prop takes its body's height. */
  readonly height?: number;
  /** A wall-mounted prop hangs centred on its spawn point instead of standing on it. */
  readonly mounted?: boolean;
  /**
   * The model is taller than the body it rides on (the cargo crate's hook and load line above the
   * crate): its height, with the body at its foot.
   */
  readonly overall?: number;
  /** Drawn from boxes in code instead of the model (the grating: its model came out blobby). */
  readonly procedural?: 'deck-grating';
}

/** Testprop id → its dock model. */
export const PROP_MODELS: Readonly<Record<string, DockModel>> = {
  'barrel-weathered': { model: 'model-prop-barrel-weathered-01', rotateDeg: AS_IS },
  keg: { model: 'model-prop-keg-01', rotateDeg: AS_IS },
  'barrel-oil': { model: 'model-prop-barrel-oil-01', rotateDeg: AS_IS },
  'barrel-breakable': { model: 'model-prop-barrel-breakable-01', rotateDeg: AS_IS },
  'cask-cradle': { model: 'model-prop-cask-cradle-01', rotateDeg: AS_IS },
  'cargo-crate': { model: 'model-prop-cargo-net-load-01', rotateDeg: AS_IS, overall: 1.6 },
  'rope-coil': { model: 'model-prop-rope-coil-01', rotateDeg: AS_IS, height: 0.25 },
  'hawser-coil': { model: 'model-prop-hawser-coil-01', rotateDeg: AS_IS, height: 0.45 },
  'deck-grating': {
    model: 'model-prop-deck-grating-01',
    rotateDeg: AS_IS,
    height: 0.3,
    procedural: 'deck-grating',
  },
  'companion-hutch': { model: 'model-prop-companion-hutch-01', rotateDeg: FRONT_X, height: 1.6 },
  tiller: { model: 'model-prop-tiller-01', rotateDeg: FRONT_X, height: 0.9 },
  'pin-rail': { model: 'model-prop-pin-rail-01', rotateDeg: FRONT_X, height: 0.6, mounted: true },
};

/** Container spawn tag → the chest it shows (the lock's plate matches the lock's tier). */
export const CONTAINER_MODELS: Readonly<Record<string, DockModel>> = {
  'sea-chest': { model: 'model-prop-sea-chest-01', rotateDeg: FRONT_X, height: 0.55 },
  'ditty-box': { model: 'model-prop-ditty-box-01', rotateDeg: FRONT_X, height: 0.35 },
  strongbox: { model: 'model-prop-strongbox-smuggler-01', rotateDeg: FRONT_X, height: 0.5 },
};

/** The tag of a light source drawn as the ship's lantern on its wall bracket. */
export const SHIP_LANTERN_TAG = 'ship-lantern';
/** The ship's lantern: its plate turned to −z, the flame (the spawn point) 0.45 m under its top. */
export const SHIP_LANTERN: DockModel = {
  model: 'model-prop-ship-lantern-01',
  rotateDeg: [0, 180, 0],
  height: 0.7,
};
const LANTERN_FLAME_BELOW_TOP = 0.45;

/** The container model for a spawn's tags, if one names a dock chest. */
export function containerModelFor(tags: readonly string[]): DockModel | undefined {
  for (const tag of tags) {
    const model = CONTAINER_MODELS[tag];
    if (model !== undefined) return model;
  }
  return undefined;
}

/** Where a fixed prop's model goes relative to its spawn point. */
function fixedPlacement(dock: DockModel): Placement {
  return {
    rotateDeg: dock.rotateDeg,
    length: dock.height ?? 1,
    anchor: dock.mounted === true ? 'centre' : 'bottom',
    offset: [0, 0, 0],
  };
}

/** Where a movable prop's model goes relative to its body's centre, `bodyHeight` metres tall. */
function bodyPlacement(dock: DockModel, bodyHeight: number): Placement {
  if (dock.overall !== undefined) {
    return {
      rotateDeg: dock.rotateDeg,
      length: dock.overall,
      anchor: 'bottom',
      offset: [0, -bodyHeight / 2, 0],
    };
  }
  return { rotateDeg: dock.rotateDeg, length: bodyHeight, anchor: 'centre', offset: [0, 0, 0] };
}

const loading = new Map<string, Promise<GlbModel>>();

/** Loads `dock` placed as `placement`, once per distinct request; a failure is forgotten so a retry can go. */
function load(key: string, dock: DockModel, placement: Placement): Promise<GlbModel> {
  const cached = loading.get(key);
  if (cached !== undefined) return cached;
  const url = modelUrl(dock.model);
  if (dock.procedural === 'deck-grating') {
    const built = Promise.resolve(buildDeckGrating());
    loading.set(key, built);
    return built;
  }
  const pending = readGlbMesh(url)
    .then((model) => {
      placeGeometry(model.geometry, placement, url);
      return model;
    })
    .catch((error: unknown) => {
      loading.delete(key);
      throw error;
    });
  loading.set(key, pending);
  return pending;
}

/** A fixed prop or a container standing on (or, mounted, centred on) its spawn point. */
export function loadFixedDockModel(dock: DockModel): Promise<GlbModel> {
  return load(`fixed:${dock.model}`, dock, fixedPlacement(dock));
}

/** A movable prop's model around its body's centre. */
export function loadBodyDockModel(dock: DockModel, bodyHeight: number): Promise<GlbModel> {
  return load(`body:${dock.model}:${String(bodyHeight)}`, dock, bodyPlacement(dock, bodyHeight));
}

/** The ship's lantern, its flame on the spawn point. */
export function loadShipLantern(): Promise<GlbModel> {
  return load('lantern', SHIP_LANTERN, {
    rotateDeg: SHIP_LANTERN.rotateDeg,
    length: SHIP_LANTERN.height ?? 0.7,
    anchor: 'top',
    offset: [0, LANTERN_FLAME_BELOW_TOP, 0],
  });
}
