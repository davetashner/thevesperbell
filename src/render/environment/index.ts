// Outdoor environment of a scene (mw-ju8.1): flat sky colour, distance fog and a painted backdrop
// layer. The backdrop is one image on an open cylinder arc around the camera, drawn first with no
// depth test and no lighting, so it costs one draw call, two triangles per segment and one texture,
// whatever the level in front of it. It follows the camera in x/z (`follow`), so it never parallaxes
// at 1 and slides gently below 1. Not tiled: the image is stretched once over the arc, so there are
// no seams to hide, at the price of a fixed vista (docs/design/valley-spike.md).
//
// The card's bottom edge sits above the world's lowest rays (a camera over the floor's far edge
// looks down past it), where the flat sky colour used to show as a band between the painted ground
// and the floor. A skirt (`SKIRT_DEPTH` m of the same arc, hung from the card's bottom edge) draws
// the image's bottom row, stretched down, so the painting continues under the floor's edge.
//
// Backdrop images stay under assets/_incoming until the owner approves them, so they are not part
// of a production build. The layer therefore loads only in dev builds (`load: true`) and a missing
// or failing image leaves the flat sky colour: nothing throws.
//
// Render-only (needs a GPU context), so it is excluded from unit coverage and verified by the
// Playwright scene smoke (e2e/scenes.spec.ts) and the perf notes in docs/design/valley-spike.md.

import type { SceneBackdropDef, SceneEnvironmentDef } from '@content/index';
import { skyAt } from '../sky/model';
import { createSkyDome, type SkyDomeView } from '../sky';
import {
  Color,
  CylinderGeometry,
  DoubleSide,
  Fog,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  type PerspectiveCamera,
  type Scene,
} from 'three';

/** How far the skirt hangs below the card's bottom edge, m: past any ray the camera can look down. */
export const BACKDROP_SKIRT_DEPTH = 400;

/** Where dev serves the unapproved backdrop images from (Vite serves the project root). */
export const BACKDROP_DEV_ROOT = '/assets/_incoming/';

/** Sky colour a dome paints from when the scene names none (style bible `sky`). */
const DEFAULT_SKY = '#8FA8C8';
/** The minute a dome shows until the game clock sets it. */
const NOON = 720;

export interface EnvironmentView {
  /** The backdrop card once its image has loaded (undefined: none, still loading, or missing). */
  backdrop(): Mesh | undefined;
  /**
   * Shows the procedural sky dome (when the scene has one) at game `minute` for the blended sky colour
   * `sky` (#RRGGBB; undefined keeps the scene's own). No-op without a dome.
   */
  setSky(sky: string | undefined, minute: number): void;
  /** Removes the fog, backdrop and sky dome and frees their GPU resources. */
  dispose(): void;
}

export interface EnvironmentOptions {
  /** Load the backdrop image. False in production builds, where the unapproved images are absent. */
  readonly load: boolean;
  /** Overrides the image root (tests, a future approved-asset path). */
  readonly root?: string;
}

/** Applies `environment` to `scene`; the flat sky and fog are immediate, the backdrop follows its image. */
export function applyEnvironment(
  scene: Scene,
  environment: SceneEnvironmentDef | undefined,
  options: EnvironmentOptions,
): EnvironmentView {
  if (environment === undefined) {
    return { backdrop: () => undefined, setSky: () => undefined, dispose: () => undefined };
  }
  if (environment.sky !== undefined) scene.background = new Color(environment.sky);
  if (environment.fog !== undefined) {
    scene.fog = new Fog(environment.fog.color, environment.fog.near, environment.fog.far);
  }
  // The procedural dome (scenes that ask for one) paints over the flat sky colour; it starts at noon
  // and follows the game clock once the caller sets it.
  let dome: SkyDomeView | undefined;
  const settings = environment.dome;
  const baseSky = environment.sky ?? DEFAULT_SKY;
  if (settings !== undefined) {
    dome = createSkyDome();
    dome.update(skyAt(settings, baseSky, NOON));
    scene.add(dome.mesh);
  }
  let card: Mesh | undefined;
  let cancelled = false;
  if (options.load && environment.backdrop !== undefined) {
    const def = environment.backdrop;
    const texture = new TextureLoader().load(
      `${options.root ?? BACKDROP_DEV_ROOT}${def.image}`,
      (loaded) => {
        if (cancelled) {
          loaded.dispose();
          return;
        }
        card = backdropCard(def, loaded.image);
        (card.material as MeshBasicMaterial).map = loaded;
        (card.material as MeshBasicMaterial).needsUpdate = true;
        scene.add(card);
      },
      undefined,
      () => {
        console.info(`Backdrop ${def.image} not found; keeping the flat sky colour.`);
      },
    );
    texture.colorSpace = SRGBColorSpace;
    // Viewed from inside the cylinder, u runs right to left: mirror it back.
    texture.wrapS = RepeatWrapping;
    texture.repeat.x = -1;
    texture.offset.x = 1;
  }
  return {
    backdrop: () => card,
    setSky(sky, minute) {
      if (dome === undefined || settings === undefined) return;
      dome.update(skyAt(settings, sky ?? baseSky, minute));
    },
    dispose() {
      cancelled = true;
      scene.fog = null;
      dome?.dispose();
      dome = undefined;
      if (card !== undefined) {
        scene.remove(card);
        card.geometry.dispose();
        for (const child of card.children) (child as Mesh).geometry.dispose();
        (card.material as MeshBasicMaterial).map?.dispose();
        (card.material as MeshBasicMaterial).dispose();
        card = undefined;
      }
    },
  };
}

/** The card for `def`: an open cylinder arc sized so the image keeps its aspect ratio. */
function backdropCard(def: SceneBackdropDef, image: { width: number; height: number }): Mesh {
  const arc = MathUtils.degToRad(def.arc);
  const height = (def.radius * arc * image.height) / image.width;
  const start = MathUtils.degToRad(def.bearing) - arc / 2;
  const geometry = new CylinderGeometry(def.radius, def.radius, height, 32, 1, true, start, arc);
  const material = new MeshBasicMaterial({
    fog: false,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide, // faces the inside, whichever way the winding falls
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'backdrop';
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  mesh.add(backdropSkirt(def, material, height));
  mesh.position.y = def.centreY;
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    const view = camera as PerspectiveCamera;
    mesh.position.x = view.position.x * def.follow;
    mesh.position.z = view.position.z * def.follow;
    mesh.updateMatrixWorld();
  };
  return mesh;
}

/**
 * The skirt under the card: the same arc and material, every vertex mapped to the image's bottom row
 * (v = 0, clamped), so it extends the painted ground's last row downwards. A child of the card, so it
 * follows the camera with it and shares its texture and draw state.
 */
function backdropSkirt(def: SceneBackdropDef, material: MeshBasicMaterial, height: number): Mesh {
  const arc = MathUtils.degToRad(def.arc);
  const start = MathUtils.degToRad(def.bearing) - arc / 2;
  const geometry = new CylinderGeometry(
    def.radius,
    def.radius,
    BACKDROP_SKIRT_DEPTH,
    32,
    1,
    true,
    start,
    arc,
  );
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i += 1) uv.setY(i, 0);
  const skirt = new Mesh(geometry, material);
  skirt.name = 'backdrop-skirt';
  skirt.renderOrder = -1000;
  skirt.frustumCulled = false;
  skirt.position.y = -(height + BACKDROP_SKIRT_DEPTH) / 2;
  return skirt;
}
